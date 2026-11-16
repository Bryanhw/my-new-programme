/* =====================================================================
 *  漂流祝福页逻辑 —— V5-M7（M6 里程碑）
 *
 *  边界（PLAN_SCOPE_v5.md §9 / §13.6）：
 *   * 一天一条：服务端用主键 (user_id, day) 记住今天拆到哪只，
 *     重复调用只把同一条再念一遍，前端不记状态。
 *   * 前端对 drift_notes / drift_reads / drift_thanks 三张表零权限，
 *     读写只走 4 个 definer RPC：post_drift_note / draw_drift_note /
 *     thank_drift_note / unthank_drift_note。
 *   * 祝福不带作者：接口返回体里没有 author_id，也没有昵称，
 *     想反查「这句话是谁写的」在前端没有任何路径。
 *   * 圈来自 profile.school → circles.js 的映射；认不出来就提示去补学校。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var noticeEl = document.getElementById("notice");
  var loadingEl = document.getElementById("drift-loading");
  var paperEl = document.getElementById("drift-body");
  var textEl = document.getElementById("drift-text");
  var actionsEl = document.getElementById("drift-actions");
  var thankBtn = document.getElementById("drift-thank");
  var thanksEl = document.getElementById("drift-thanks");
  var emptyEl = document.getElementById("drift-empty");
  var nocircleEl = document.getElementById("drift-nocircle");
  var loginEl = document.getElementById("drift-login");
  var circleEl = document.getElementById("drift-circle");
  var writeCard = document.getElementById("write-card");
  var inputEl = document.getElementById("drift-input");
  var sendBtn = document.getElementById("drift-send");
  var quotaEl = document.getElementById("drift-quota");

  document.title = "漂流祝福 · " + C.SITE_NAME;
  if (C.blockIfNotReady(noticeEl)) return;

  var DAILY_LIMIT = 3;
  var state = { circle: "", note: null, busy: false, posted: 0 };

  function client() { return C.client(); }

  function failText(err, fallback) {
    if (err && (err.code === "PGRST202" || err.code === "42883" ||
                /does not exist/i.test(String(err.message || "")))) {
      return "漂流祝福还没开启（站点刚更新，稍后再试）";
    }
    if (err && err.message) return String(err.message);
    return fallback || "没成功，再试一次";
  }

  function isNotLogged(err) {
    var m = String((err && err.message) || "");
    return /请先登录|not authenticated|JWT/i.test(m);
  }

  /* ---------------- 圈子 ---------------- */

  function loadCircle() {
    return C.getProfile().then(function (p) {
      var cid = C.circleOfSchool((p && p.school) || "");
      state.circle = cid || "";
      circleEl.textContent = cid ? C.circleName(cid) : "";
      return state.circle;
    }).catch(function () { return ""; });
  }

  /* ---------------- 今天的瓶子 ---------------- */

  function setThanks(n, mine) {
    thankBtn.setAttribute("aria-pressed", mine ? "true" : "false");
    thankBtn.className = "btn btn-soft btn-sm" + (mine ? " is-thanked" : "");
    thankBtn.textContent = mine ? "💛 已谢谢" : "💛 谢谢";
    thanksEl.textContent = n > 0 ? n + " 人谢谢过" : "";
  }

  function render(note) {
    loadingEl.hidden = true;
    state.note = note || null;

    /* 三种状态互斥，显式收一遍 —— 也顺手覆盖空池之后又投了一只的切换。 */
    paperEl.hidden = !note;
    actionsEl.hidden = !note;
    if (!note) {
      emptyEl.hidden = false;
      return;
    }

    textEl.textContent = note.body;
    setThanks(note.thanks_count || 0, note.thanked_by_me === true);
  }

  function draw() {
    client().rpc("draw_drift_note", { p_circle: state.circle }).then(function (res) {
      if (res && res.error) {
        loadingEl.hidden = true;
        if (isNotLogged(res.error)) { loginEl.hidden = false; return; }
        if (res.error.code === "PGRST202" || res.error.code === "42883") {
          emptyEl.hidden = false;
          emptyEl.textContent = "漂流祝福还没开启（站点刚更新，稍后再试）。";
          return;
        }
        emptyEl.hidden = false;
        C.toast(failText(res.error, "读取失败"));
        return;
      }
      var row = res && res.data && res.data[0];
      render(row || null);
      if (row && row.is_new) C.toast("捞到今天的第一只瓶子");
    }).catch(function (err) {
      loadingEl.hidden = true;
      emptyEl.hidden = false;
      C.toast(failText(err, "读取失败"));
    });
  }

  /* ---------------- 谢谢 ---------------- */

  thankBtn.addEventListener("click", function () {
    if (!state.note || state.busy) return;
    state.busy = true;
    var mine = thankBtn.getAttribute("aria-pressed") === "true";
    var fn = mine ? "unthank_drift_note" : "thank_drift_note";
    client().rpc(fn, { p_note_id: state.note.note_id }).then(function (res) {
      state.busy = false;
      if (res && res.error) {
        C.toast(failText(res.error, "没成功"));
        return;
      }
      setThanks(res.data || 0, !mine);
    }).catch(function (err) {
      state.busy = false;
      C.toast(failText(err, "没成功"));
    });
  });

  /* ---------------- 投一只 ---------------- */

  function updateQuota() {
    var left = Math.max(0, DAILY_LIMIT - state.posted);
    if (state.posted === 0) {
      // 页面刚打开时并不知道服务端今天已经投了几只，所以先给上限，
      // 不冒充「还剩 3 只」；真的投满了服务端会明确拒绝。
      quotaEl.textContent = "每天最多 " + DAILY_LIMIT + " 只";
    } else if (left > 0) {
      quotaEl.textContent = "今天还能投 " + left + " 只";
    } else {
      quotaEl.textContent = "今天投满了，明天再来";
    }
    sendBtn.disabled = left <= 0;
  }

  sendBtn.addEventListener("click", function () {
    var body = String(inputEl.value || "").trim();
    if (!state.circle) { C.toast("先去我的资料里选一下学校"); return; }
    if (body.length < 4) { C.toast("再多写几个字吧，至少 4 个字"); return; }
    if (body.length > 120) { C.toast("有点长，120 字以内更好漂流"); return; }

    sendBtn.disabled = true;
    client().rpc("post_drift_note", { p_body: body, p_circle: state.circle })
      .then(function (res) {
        if (res && res.error) {
          sendBtn.disabled = false;
          if (isNotLogged(res.error)) { loginEl.hidden = false; return; }
          C.toast(failText(res.error, "没投出去"));
          return;
        }
        inputEl.value = "";
        state.posted++;
        updateQuota();
        C.toast("投进海里了，谢谢你的这句话");
        if (!emptyEl.hidden) {
          emptyEl.textContent = "瓶子已经投进去了。今天的海里暂时还没有别人的，明天再来捞。";
        }
      })
      .catch(function (err) {
        sendBtn.disabled = false;
        C.toast(failText(err, "没投出去"));
      });
  });

  /* ---------------- 启动 ---------------- */

  updateQuota();

  loadCircle().then(function (cid) {
    if (!cid) {
      loadingEl.hidden = true;
      nocircleEl.hidden = false;
      writeCard.hidden = true;
      return;
    }
    writeCard.hidden = false;
    draw();
  });
})();
