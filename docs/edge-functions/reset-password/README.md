# reset-password · 部署与自查（站主向）

「密保问题自助找回密码」的 Edge Function。忘密码的同学未登录，凭「手机号 + 密保答案」换一个新密码。
本函数持有 `service_role`，只在 Supabase 服务端运行，**密钥绝不进浏览器**。

## 一、部署步骤

1. 打开 Supabase Dashboard → Edge Functions → **Create a new function**，名字填 `reset-password`（必须一致，前端按这个名字调）。
2. 把同目录的 `index.ts` 内容整段粘贴进去 → **Deploy**。
3. 在本函数的设置里**关闭「Enforce JWT Verification」**（即 `verify_jwt = false`）。
   忘密码的人此刻是**未登录**状态，没有也不该有 JWT；开着校验会被网关在进入函数前用 401 挡掉。
4. **不需要手动配置密钥**：平台会自动注入 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，无需在别处粘贴。
5. 确认数据库迁移已执行：先在 SQL Editor 跑 `docs/supabase-security-question.sql`（或它的 flat 粘贴版），再部署本函数。顺序反了会导致核对 RPC 不存在。

前端调用地址形状：

```
POST ${SUPABASE_URL}/functions/v1/reset-password
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json
{"phone":"13800000000","answer":"某某小学","new_password":"newpass123"}
```

## 二、自查（curl）

**先跑自检**（不碰数据库、不改任何东西，只确认「函数活着 / 密钥在 / 请求体读得到」）：

```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/reset-password" \
  -H "apikey: <anon key>" \
  -H "Content-Type: application/json" \
  -d '{"ping":true}'
```

期望：`HTTP 200`，`{"ok":true,"code":"pong","diag":{"hasUrl":true,"hasKey":true,"bodyBytes":12,...}}`

- `hasUrl` / `hasKey` 都应为 `true`（密钥是平台自动注入的）
- 看到 `code":"pong"` 就说明部署成功、`verify_jwt` 也关对了
- 想收掉这个入口，删掉 `index.ts` 里的 `ping` 分支再部署即可，不影响其它逻辑

**再跑真实调用**（会真的改密码，用一个测试账号试）：

```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/reset-password" \
  -H "apikey: <anon key>" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","answer":"某某小学","new_password":"newpass123"}'
```

期望结果：

- 密码正确重置：`HTTP 200`，`{"ok":true,"message":"密码已重置，请用新密码登录"}`
- 手机号没注册 / 没登记密保 / 答案不对：都是 **同一条** `HTTP 400`，`{"ok":false,"code":"mismatch","message":"手机号或密保答案不对"}`（这是刻意的，防止探测某个手机号是否注册过）
- 连错 5 次：`HTTP 429`，`{"ok":false,"code":"locked","message":"试得有点多，请 15 分钟后再试"}`

## 三、看真实失败原因（函数日志）

对外响应为了防探测会「合并原因」，真实原因只写进函数日志：

1. Dashboard → Edge Functions → `reset-password` → **Logs**；
2. 日志里每条以 `[reset-password]` 开头，例如：
   - `手机号未找到账号：138****0000`
   - `校验未通过：138****0000 wrong`（或 `no_answer`）
   - `账号处于锁定期：138****0000 locked`
   - `调用校验 RPC 失败` / `改密码返回非 2xx`（说明后端出问题，需要排查）
3. 日志**不会**记录答案明文，也**不会**记录新密码；手机号是脱敏的，符合隐私边界。

## 四、常见报错对照

| 现象 | 多半是 | 怎么修 |
|---|---|---|
| `404` / `Function not found` | 函数还没部署，或名字不是 `reset-password` | 按第一节重新创建并 Deploy |
| `401` / `Unauthorized`（根本没进函数、日志也没有记录） | 忘了关「Enforce JWT Verification」 | 打开 `verify_jwt = false` 再试 |
| `500` `{"code":"server_error"}`，日志报「调用校验 RPC 失败」 | 数据库迁移没执行，`verify_security_answer` 不存在 | 在 SQL Editor 执行 `docs/supabase-security-question.sql` |
| `500` `{"code":"server_error"}`，日志报「查账号失败」 | 平台注入的 service key 失效/被轮换，或 Admin API 一时不通 | 看函数日志里的状态码；平台侧问题稍后重试，key 被轮换则重新部署函数 |
| `500` `{"code":"not_configured"}` | 平台没注入环境变量（极少见） | 确认函数在 Supabase 上运行，而不是本地手动启动 |
| `400` `{"code":"invalid_input"}`，提示「手机号格式不对」 | 手机号不是 11 位 / 不是 1 开头，或含多余字符 | 前端先归一化；确认真实手机号 |
| `400` 提示「答案长度不对（1~60 个字）」 | 答案空了或超过 60 字 | 让同学按登记时的答案填写 |
| `400` 提示「密码长度不对（6~72 位）」 | 新密码太短或太长 | 用 6~72 位的密码 |
| 裸 `500` `Internal Server Error`（`content-type: text/plain`、**没有 CORS 头**、`sb-error-code: EDGE_FUNCTION_ERROR`） | 函数里有异常冒到了运行时；浏览器读不到这个响应，前端只能显示「连不上服务器」 | 先看 **Logs** 里 `[reset-password]` 那几行定位；同时确认 Code 页粘贴的是**本目录最新的 `index.ts`**（旧版没有长度护栏、读 body 未兜异常），重新粘贴并 Deploy |
| 浏览器显示「连不上服务器，或者问一下站主…」 | 跨域被拦（预检没通过）或函数返回了不带 CORS 头的 5xx | 用上面的 `{"ping":true}` 确认函数可用；仍是 5xx 就看 Logs |

## 五、已知局限（够用，但要知道边界）

1. **查账号靠翻用户列表**：Admin API 没有「按邮箱精确查」的稳定参数，所以是每页 200 翻最多 10 页匹配邮箱。
   现在几十个用户毫无压力；**用户上千后要改成更精确的查询**（例如自建一张「手机号 → user_id」映射表，或让同学先输账号名）。
2. **没有按 IP 限流**：防撞库靠「同一账号连错 5 次锁 15 分钟」这一条，锁在数据库里（`security_answers.locked_until`），
   不依赖函数所在机器，重启也不丢。真要再加一层 IP 限流，得引入额外的存储（本项目刻意不引入）。
3. **锁定期的响应会暴露「这个手机号有密保记录」**：需要先连错 5 次才会触发，属于可接受的取舍（见 `index.ts` 注释）。
4. **答案空间小**：三选一问题 + 常见答案，理论上拿到盐就能离线枚举。所以指纹只用于「对不对」的比对，
   真正的闸门是失败锁定 —— 这一点在 `docs/supabase-security-question.sql` 顶部也写明了。

## 六、相关文件

- 数据库迁移：`docs/supabase-security-question.sql`（含验证查询与回滚）
- 扁平粘贴版：`docs/supabase-security-question-flat.sql`
- 本函数：`docs/edge-functions/reset-password/index.ts`
