// =====================================================================
//  校园拾光 · Edge Function：reset-password（密保问题自助找回密码）
//  ---------------------------------------------------------------------
//  这是「忘密码」的最后一环：用户未登录，凭手机号 + 密保答案换一个新密码。
//
//  部署步骤（Supabase Dashboard，不需要任何命令行）
//  ---------------------------------------------------------------------
//   1) Supabase Dashboard -> Edge Functions -> Create a new function，
//      名字填 reset-password（必须一致，前端按这个名字调）。
//   2) 把本文件内容整段粘贴进去 -> Deploy。
//   3) 关闭「Enforce JWT Verification」（对应配置 verify_jwt = false）：
//      忘密码的人此刻是**未登录**状态，没有也不该有 JWT；若开着校验，
//      请求会在进入函数之前就被网关用 401 挡掉。
//   4) 不需要手动配置密钥：平台会自动注入 SUPABASE_URL 与
//      SUPABASE_SERVICE_ROLE_KEY 两个环境变量（只在函数运行时可用，
//      不会进浏览器）。
//
//  前端怎么调
//  ---------------------------------------------------------------------
//   POST ${SUPABASE_URL}/functions/v1/reset-password
//   headers:
//     apikey: <anon key>
//     Authorization: Bearer <anon key>    // 未登录时也用 anon key 占位
//     Content-Type: application/json
//   body: { "phone", "answer", "new_password", "question_id"? }
//   （question_id 目前接收但不用 —— 答案只对本人已登记的那一行比对；
//     留着是为了前向兼容，前端可能带上它做展示。）
//
//  为什么这里用 service_role
//  ---------------------------------------------------------------------
//   改密码要走 Auth Admin API，只有 service_role 能调；service_role key
//   只在本函数运行时从环境变量读取，绝不进浏览器。浏览器能做的只是
//   「提交一次请求」，真正的校验与改密都在服务端完成。
//
//  红线与取舍（都写在下面代码旁）
//  ---------------------------------------------------------------------
//   * 手机号不存在 / 没登记密保 / 答案不对 —— 三种情况返回**完全相同**的响应，
//     防止有人拿一堆手机号来探测「谁注册过」。真实原因只写进 console.log。
//   * 不返回任何账号信息（不回显邮箱 / 昵称 / 学校）。
//   * 不做答案的二次归一化：归一化只在 SQL 里一处（security_answer_fingerprint），
//     避免两份实现走偏；这里的本地归一化只用于长度校验，不参与指纹。
//   * 锁定期（连错 5 次锁 15 分钟）会返回 429；这个响应确实会暴露
//     「该手机号有密保记录」—— 但它需要先连错 5 次才会触发，属于可接受的
//     取舍（换来的是对撞库的有效拦截）。
// =====================================================================

// 只用 Deno 内置能力：Deno.serve + fetch，不引入任何 npm 包。
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// 请求体上限（防被塞进超大 body；正常请求只有几百字节）。
const MAX_BODY_BYTES = 8 * 1024;

// Admin API 翻页：每页 200，最多翻 10 页（≈2000 个用户）。
// 局限：这是为了兼容不同版本的 Admin API（有的直接返回数组，有的包在
// { users: [...] } 里），只能「拉列表再匹配」。用户量上千时既慢又可能漏，
// 那时要换成更精确的查询（例如自建 手机号->user_id 映射表，或让用户先输账号）。
const ADMIN_PAGE_SIZE = 200;
const ADMIN_MAX_PAGES = 10;

// 伪邮箱域名必须与前端 assets/js/app.js 的 EMAIL_DOMAIN 完全一致。
const EMAIL_DOMAIN = "@students.local";

// CORS：前端在 GitHub Pages，与函数不同源，浏览器会先发 OPTIONS 预检。
// （业务逻辑仍然只处理 POST；OPTIONS 只是为了让浏览器放行这次跨域请求。）
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // x-client-info 是 supabase-js 自动带的头，不放行会被预检拦下。
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

// 手机号归一化：去空格 / 横线 / 括号（与前端 assets/js/app.js 的 normalizePhone 一致）。
function normalizePhone(raw: unknown): string {
  return String(raw ?? "").replace(/[\s\-()]/g, "");
}

// 答案归一化：去所有空白 + 转小写。**只用于长度校验，不参与指纹计算**。
function normalizeAnswer(raw: unknown): string {
  return String(raw ?? "").replace(/\s/g, "").toLowerCase();
}

// 打日志时用脱敏手机号，避免把完整 PII 写进函数日志。
function maskPhone(phone: string): string {
  return phone.length === 11 ? phone.slice(0, 3) + "****" + phone.slice(7) : "?";
}

function adminHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: "Bearer " + SERVICE_KEY,
    Accept: "application/json",
  };
}

// 在 Admin API 里按邮箱找用户；确认「翻完了没有这个人」时返回 null。
// 注意要把「没这个人」和「平台出错」分开：平台出错直接抛出，由调用方回 500 ——
// 否则基础设施一抖，同学会看到「手机号或密保答案不对」而白折腾好几轮。
async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= ADMIN_MAX_PAGES; page++) {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${ADMIN_PAGE_SIZE}`;
    const res = await fetch(url, { headers: adminHeaders() });
    if (!res.ok) {
      throw new Error("admin users 列表请求失败：" + res.status);
    }
    const data = await res.json();
    // 不同版本的 Admin API 可能直接返回数组，或包在 { users: [...] } 里。
    const users: Array<{ id?: string; email?: string }> = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.users) ? data.users : []);
    const hit = users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit && hit.id) return { id: hit.id };
    // 这一页没满，说明已经是最后一页，不用再翻。
    if (users.length < ADMIN_PAGE_SIZE) break;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  // 跨域预检：只放行浏览器，不执行业务。
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // 只接受 POST，其它方法一律 405。
  if (req.method !== "POST") {
    return json(405, { ok: false, code: "method_not_allowed", message: "只支持 POST" });
  }

  // 密钥缺失：给出清晰的状态码与错误码，而不是抛栈。
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log("[reset-password] 缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    return json(500, { ok: false, code: "not_configured" });
  }

  // 请求体大小上限：先看 Content-Length，读出来后再兜一次。
  const declaredLen = Number(req.headers.get("content-length") || "0");
  if (declaredLen > MAX_BODY_BYTES) {
    return json(400, { ok: false, code: "invalid_input", message: "请求体过大" });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json(400, { ok: false, code: "invalid_input", message: "请求体过大" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: "invalid_input", message: "请求格式不对" });
  }

  const phone = normalizePhone(payload.phone);
  const answer = String(payload.answer ?? "");
  const newPassword = String(payload.new_password ?? "");

  // 校验：
  //  手机号归一化后必须匹配 ^1\d{10}$（11 位、1 开头）；
  //  答案归一化后 1~60 字；
  //  新密码 6~72 字节（bcrypt 只取前 72 字节，超了等于被截断）。
  if (!/^1\d{10}$/.test(phone)) {
    return json(400, { ok: false, code: "invalid_input", message: "手机号格式不对" });
  }
  const answerLen = Array.from(normalizeAnswer(answer)).length;
  if (answerLen < 1 || answerLen > 60) {
    return json(400, { ok: false, code: "invalid_input", message: "答案长度不对（1~60 个字）" });
  }
  const pwdBytes = new TextEncoder().encode(newPassword).length;
  if (pwdBytes < 6 || pwdBytes > 72) {
    return json(400, { ok: false, code: "invalid_input", message: "密码长度不对（6~72 位）" });
  }

  const email = phone + EMAIL_DOMAIN; // 与前端 phoneToEmail 同一套规则

  let user: { id: string } | null = null;
  try {
    user = await findUserByEmail(email);
  } catch (e) {
    // 查账号这一步本身失败：这是平台侧的问题，不能装成「答案不对」。
    console.log("[reset-password] 查账号失败：", String(e));
    return json(500, { ok: false, code: "server_error" });
  }

  // 防探测：手机号不存在、没登记密保、答案不对 —— 三者响应必须**完全一致**。
  const MISMATCH = { ok: false, code: "mismatch", message: "手机号或密保答案不对" };
  if (!user) {
    console.log("[reset-password] 手机号未找到账号：", maskPhone(phone));
    return json(400, MISMATCH);
  }

  // 交给数据库比对：归一化 / 失败计数 / 锁定都在 SQL 里，服务端不重复实现。
  // 把**原始 answer** 原样发过去，让 SQL 里那一处归一化说了算。
  let verifyRes: Response;
  try {
    verifyRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_security_answer`, {
      method: "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_user_id: user.id, p_answer: answer }),
    });
  } catch (e) {
    console.log("[reset-password] 调用校验 RPC 失败：", String(e));
    return json(500, { ok: false, code: "server_error" });
  }

  if (!verifyRes.ok) {
    console.log("[reset-password] 校验 RPC 返回非 2xx：", verifyRes.status);
    return json(500, { ok: false, code: "server_error" });
  }

  const verify = await verifyRes.json();
  const result = String((verify && verify.result) || "");

  if (result === "locked" || result === "locked_now") {
    // 取舍：这个响应会暴露「该手机号有密保记录」，但需要先连错 5 次才会触发；
    // 换来的是对撞库的有效拦截，值得。真实原因（locked / locked_now）只进日志。
    console.log("[reset-password] 账号处于锁定期：", maskPhone(phone), result);
    return json(429, { ok: false, code: "locked", message: "试得有点多，请 15 分钟后再试" });
  }

  if (result !== "ok") {
    // wrong / no_answer 都按「手机号或密保答案不对」对外；真实原因只进日志。
    console.log("[reset-password] 校验未通过：", maskPhone(phone), result);
    return json(400, MISMATCH);
  }

  // 核对通过：用 Admin API 改密码（service key 只在服务端出现）。
  let putRes: Response;
  try {
    putRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
  } catch (e) {
    console.log("[reset-password] 改密码请求失败：", String(e));
    return json(500, { ok: false, code: "server_error" });
  }

  if (!putRes.ok) {
    console.log("[reset-password] 改密码返回非 2xx：", putRes.status);
    return json(500, { ok: false, code: "server_error" });
  }

  // 成功：不回显任何账号信息（邮箱 / 昵称 / 学校一律不返回）。
  return json(200, { ok: true, message: "密码已重置，请用新密码登录" });
});
