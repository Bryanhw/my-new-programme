/* =====================================================================
 *  生日祝福横幅（第 58 轮）
 *  ---------------------------------------------------------------------
 *  职责：登录用户（含匿名访客）登记过生日、且今天就是生日当天时，
 *        在页面顶部渲染一条可关闭的祝福横幅。
 *
 *  设计要点：
 *   - 「今天是不是生日」由 app.js 的 isBirthdayToday 用本地时区月日比较；
 *   - 本会话只弹一次（sessionStorage 去重）。刷新页面不重复弹；
 *     因为你生日那天开多少遍页面，感情都到位一遍就够了；
 *   - 可关闭（×），关闭后本会话不再出现；
 *   - 关不掉也能读回：消息只做软提示，不做任何拦截。
 *
 *  使用方式：页面在 </body> 前引入本文件即可，自动执行。
 * ===================================================================== */

window.BirthdayWish = (function () {
  "use strict";

  var SESSION_KEY = "campus-birthday-wished";

  function hive() {
    try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  function markGreeted() {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) { /* 隐私模式等场合忽略 */ }
  }

  function closeBtn() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "birthday-wish-close";
    b.setAttribute("aria-label", "关闭生日祝福");
    b.textContent = "×";
    return b;
  }

  function render(name) {
    var wrap = document.createElement("aside");
    wrap.className = "birthday-wish";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");

    var emoji = document.createElement("span");
    emoji.className = "birthday-wish-cake";
    emoji.textContent = "🎂";

    var text = document.createElement("div");
    text.className = "birthday-wish-text";
    var main = document.createElement("p");
    main.className = "birthday-wish-main";
    main.textContent = name
      ? "生日快乐，" + name + "！"
      : "生日快乐！";
    var sub = document.createElement("p");
    sub.className = "birthday-wish-sub";
    sub.textContent = "今天也是普通的一天，但因为有你而特别。校园拾光愿你被光温柔包围。";
    text.appendChild(main);
    text.appendChild(sub);

    var btn = closeBtn();
    btn.addEventListener("click", function () {
      markGreeted();
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });

    wrap.appendChild(emoji);
    wrap.appendChild(text);
    wrap.appendChild(btn);

    document.body.insertBefore(wrap, document.body.firstChild);
  }

  function show() {
    if (hive()) return;                 // 本会话已送过
    var C = window.Campus;
    if (!C || typeof C.getProfile !== "function") return;

    C.getProfile().then(function (p) {
      if (!C.isBirthdayToday(p)) return;
      markGreeted();                     // 先记账再展示：下次进来不再判断
      render((p && p.nickname) || "");
    }).catch(function () {
      /* 读不到资料就不打扰：生日祝福是锦上添花，不是理所当然 */
    });
  }

  show();

  return { show: show };
})();
