/*
 *  首屏诊断条（第 63 轮的功能，第 79 轮从 profile.html 里搬出来）
 *  ------------------------------------------------------------------
 *  原来这段是写在页面里的内联脚本，第 79 轮加了 CSP（script-src 'self'），
 *  内联脚本会被拦，所以移到这里，页面用 <script src> 引。
 *
 *  正常打开不会有任何可见变化；只有真出问题时才在页面顶部冒出一条黄色提示。
 */

/* 第 63 轮：公开主页卡在「正在读取…」时，把真实原因直接写到页面上。
 正常打开不会有任何可见变化；只有真出问题时才冒出一条黄色提示。 */
(function () {
function paint(msg) {
  var bar = document.getElementById("boot-diag");
  if (!bar) return;
  bar.classList.remove("hidden");
  bar.textContent = msg;
}
window.addEventListener("error", function (e) {
  if (!e || !e.message) return;
  var file = String(e.filename || "").split("/").pop() || "?";
  paint("脚本出错：" + e.message + "（" + file + " 第 " + (e.lineno || "?") + " 行）");
});
window.addEventListener("unhandledrejection", function (e) {
  var r = e && e.reason;
  paint("请求失败没兜住：" + ((r && r.message) || String(r || "")));
});
var netNote = "网络自检还没结果";
/* 直接用一条干净的 fetch 探一下 Supabase：能把「网络不通」和「代码问题」分开。 */
window.setTimeout(function () {
  var cfg = window.CAMPUS_CONFIG || {};
  if (!cfg.SUPABASE_URL) { netNote = "config.js 没配地址"; return; }
  var t0 = Date.now();
  fetch(String(cfg.SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/", {
    headers: { apikey: cfg.SUPABASE_ANON_KEY || "" },
    cache: "no-store"
  }).then(function (r) {
    netNote = "Supabase 可达（HTTP " + r.status + "，" + (Date.now() - t0) + " ms）";
  }).catch(function (e) {
    netNote = "连不上 Supabase（" + (Date.now() - t0) + " ms，" +
      String((e && e.message) || e) + "）";
  });
}, 2500);

window.setTimeout(function () {
  var name = document.getElementById("public-name");
  if (!name || !/正在读取/.test(name.textContent || "")) return;
  var uid = (location.search.match(/[?&]uid=([^&]+)/) || [])[1] || "?";
  var hasClient = !!(window.Campus && typeof window.Campus.client === "function" && window.Campus.client());
  paint("9 秒了还没拿到资料 · uid=" + uid + " · " + netNote +
    " · 后端客户端：" + (hasClient ? "已创建" : "没创建") + " · 页面版本：63b");
}, 9000);
})();
