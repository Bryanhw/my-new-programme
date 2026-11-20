/* =====================================================================
 *  审核台（P1-7）v1
 *  ---------------------------------------------------------------------
 *  只有 profiles.is_admin = true 的人能用。四块：
 *    待审 / 被举报 / 申诉 / 日志
 *
 *  所有写操作都走 Supabase 的 RPC（staff_review / staff_resolve_appeal），
 *  由数据库再校验一次 is_staff —— 前端藏起来只是「看不见」，不是「做不到」。
 *  每一次通过 / 驳回都会写进 moderation_audit。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  if (!C) return;

  var noticeEl = document.getElementById("notice");
  var listEl = document.getElementById("mod-list");
  var emptyEl = document.getElementById("mod-empty");
  var loadingEl = document.getElementById("mod-loading");
  var gateEl = document.getElementById("mod-gate");
  var moreEl = document.getElementById("mod-more");
  var countEl = document.getElementById("mod-count");
  var tabs = document.querySelectorAll ? document.querySelectorAll(".nc-tab") : [];

  var VIEW = "pending";        /* pending | reported | appeals | audit */
  var PAGE = 10;
  var cursor = null;
  var busy = false;
  var staff = false;
  var rows = [];

  /* 驳回时给作者看的话。第一条最常用，所以放最前面。 */
  var REASONS = [
    "看不出在说什么，像是随手打的",
    "有脏话或者人身攻击",
    "像广告、引流或拉人进群",
    "涉及隐私（手机号、住址、真实姓名）",
    "图片不合适",
    "其他原因，我写在下面"
  ];

  document.title = "审核台 · " + (C.SITE_NAME || "校园拾光");
  C.markTabbar("");

  /* ---------------------------------------------------------------
   * 小工具
   * --------------------------------------------------------------- */
  function esc(s) { return C.escapeHtml(String(s == null ? "" : s)); }

  function when(iso) {
    return iso ? esc(C.timeAgo ? C.timeAgo(iso) : String(iso).slice(0, 10)) : "";
  }

  function humanError(err) {
    var msg = String((err && err.message) || err || "");
    if (/42501|permission denied|只有管理员/.test(msg)) return "只有管理员能做这件事。";
    if (/P0002|找不到/.test(msg)) return "这条内容已经不在了，刷新一下看看。";
    if (/23505|已经有一条申诉/.test(msg)) return "这条分享已经有一条申诉在处理了。";
    if (/22023/.test(msg)) return msg.replace(/^.*?:\s*/, "");
    if (/PGRST202|does not exist|schema cache/i.test(msg)) return "审核台的后端还没装好（缺函数），先在 Supabase 跑 docs/supabase-moderation.sql。";
    return msg || "操作没成功，再试一次。";
  }

  function rpc(name, args) {
    var c = C.client();
    if (!c) return Promise.reject(new Error("还没有配置后端"));
    return new Promise(function (resolve, reject) {
      c.rpc(name, args || {}).then(function (res) {
        if (res && res.error) reject(new Error(humanError(res.error)));
        else resolve(res ? res.data : null);
      }).catch(function (err) { reject(new Error(humanError(err))); });
    });
  }

  function say(kind, text) {
    if (C.showNotice) C.showNotice(noticeEl, kind, text);
  }

  function setBusy(on) {
    busy = on;
    if (moreEl) moreEl.disabled = on;
  }

  /* ---------------------------------------------------------------
   * 权限门：先问一句「我是不是管理员」
   * --------------------------------------------------------------- */
  function checkStaff() {
    return rpc("am_i_staff").then(function (v) {
      staff = v === true;
      return staff;
    }).catch(function (err) {
      staff = false;
      if (err && /请先登录|JWT|未授权|401/i.test(err.message)) {
        say("info", "审核台要登录自己的账号才能用。");
      }
      return false;
    });
  }

  function showGate() {
    if (loadingEl) loadingEl.hidden = true;
    if (gateEl) gateEl.hidden = false;
    if (moreEl) moreEl.hidden = true;
    if (countEl) countEl.textContent = "";
    if (listEl) listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = true;
  }

  /* ---------------------------------------------------------------
   * 渲染
   * --------------------------------------------------------------- */
  function badge(status) {
    if (status === "pending") return '<span class="mod-badge">待审</span>';
    if (status === "approved") return '<span class="mod-badge ok">已公开</span>';
    if (status === "rejected") return '<span class="mod-badge bad">未通过</span>';
    return "";
  }

  function queueCard(p) {
    var reps = p.report_open ? ' · <b>' + p.report_open + " 条待处理举报</b>" : "";
    var img = p.image_path
      ? '<img class="mod-img" src="' + esc(C.imageUrl ? C.imageUrl(p.image_path) : p.image_path) +
        '" alt="这条分享配的图" loading="lazy">'
      : "";

    return '<article class="card mod-card" data-post="' + esc(p.id) + '">' +
      '<div class="mod-head">' +
        '<span class="mod-who">' + esc(p.display_name || "一位同学") +
          (p.is_anonymous ? '<span class="mod-anon">匿名</span>' : "") + "</span>" +
        '<span class="mod-when">' + when(p.created_at) + "</span>" +
      "</div>" +
      '<p class="mod-body">' + esc((p.content || "").slice(0, 220)) + "</p>" +
      img +
      '<div class="mod-meta">' + badge(p.status) + reps +
        (p.reject_reason ? " · 上次驳回：" + esc(p.reject_reason) : "") +
      "</div>" +
      '<div class="mod-acts">' +
        '<button class="btn btn-soft btn-sm" type="button" data-act="approve">通过</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="reject">驳回</button>' +
        '<a class="btn btn-ghost btn-sm" href="detail.html?id=' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener">看整条</a>' +
      "</div>" +
      '<div class="mod-reasons" hidden>' +
        REASONS.map(function (r, i) {
          return '<button class="mod-chip" type="button" data-why="' + i + '">' + esc(r) + "</button>";
        }).join("") +
        '<label class="mod-why"><span class="hint">也可以自己写一句（最多 200 字）</span>' +
          '<textarea class="input" data-why-text rows="2" maxlength="200" placeholder="作者看到的就是这句话"></textarea>' +
        "</label>" +
        '<div class="mod-acts">' +
          '<button class="btn btn-danger btn-sm" type="button" data-act="reject-go">确认驳回</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-act="cancel">算了</button>' +
        "</div>" +
      "</div>" +
    "</article>";
  }

  function appealCard(a) {
    return '<article class="card mod-card" data-appeal="' + esc(a.id) + '">' +
      '<div class="mod-head">' +
        '<span class="mod-who">' + esc(a.author_name || "一位同学") + " 的申诉</span>" +
        '<span class="mod-when">' + when(a.created_at) + "</span>" +
      "</div>" +
      '<p class="mod-body">' + esc(a.body) + "</p>" +
      '<div class="mod-meta">被驳回的原文：' + esc((a.post_content || "").slice(0, 120)) + "</div>" +
      '<div class="mod-acts">' +
        '<button class="btn btn-soft btn-sm" type="button" data-act="accept">受理并放行</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="deny">维持原判</button>' +
        '<a class="btn btn-ghost btn-sm" href="detail.html?id=' + encodeURIComponent(a.post_id) + '" target="_blank" rel="noopener">看这条</a>' +
      "</div>" +
      '<div class="mod-reasons" hidden>' +
        '<label class="mod-why"><span class="hint">给作者的回复（可留空）</span>' +
          '<textarea class="input" data-reply rows="2" maxlength="200" placeholder="例如：改掉联系方式再发一次"></textarea>' +
        "</label>" +
        '<div class="mod-acts">' +
          '<button class="btn btn-soft btn-sm" type="button" data-act="deny-go">确认维持原判</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-act="cancel">算了</button>' +
        "</div>" +
      "</div>" +
    "</article>";
  }

  function auditRow(a) {
    var what = {
      approve: "通过", reject: "驳回", restore: "打回待审",
      appeal_submit: "提交申诉", appeal_accept: "受理申诉", appeal_reject: "驳回申诉"
    }[a.action] || a.action;
    return '<div class="mod-log">' +
      '<span class="mod-log-time">' + when(a.created_at) + "</span>" +
      '<span class="mod-log-what">' + esc(what) + "</span>" +
      '<span class="mod-log-by">' + esc(a.actor_name || "管理员") + "</span>" +
      (a.reason ? '<span class="mod-log-why">' + esc(a.reason) + "</span>" : "") +
    "</div>";
  }

  function render() {
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = "";
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = {
          pending: "没有待审的分享 —— 现在干净。",
          reported: "没有待处理的举报。",
          appeals: "没有待处理的申诉。",
          audit: "还没有操作记录。"
        }[VIEW];
      }
      if (moreEl) moreEl.hidden = true;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    if (VIEW === "audit") listEl.innerHTML = rows.map(auditRow).join("");
    else if (VIEW === "appeals") listEl.innerHTML = rows.map(appealCard).join("");
    else listEl.innerHTML = rows.map(queueCard).join("");

    if (countEl) {
      countEl.textContent = VIEW === "audit"
        ? "最近 " + rows.length + " 条"
        : rows.length + " 条";
    }
    if (moreEl) moreEl.hidden = rows.length < PAGE;
  }

  /* ---------------------------------------------------------------
   * 取数
   * --------------------------------------------------------------- */
  function fetchPage(reset) {
    if (busy || !staff) return Promise.resolve();
    setBusy(true);
    if (reset) {
      cursor = null;
      rows = [];
      if (loadingEl) loadingEl.hidden = false;
      if (emptyEl) emptyEl.hidden = true;
      if (listEl) listEl.innerHTML = "";
    }

    var before = reset ? null : cursor;
    var task;

    if (VIEW === "audit") {
      task = rpc("staff_audit", { p_limit: PAGE, p_before: before });
    } else if (VIEW === "appeals") {
      task = rpc("staff_appeals", { p_status: "open", p_limit: PAGE, p_before: before });
    } else {
      task = rpc("staff_queue", { p_scope: VIEW, p_limit: PAGE, p_before: before });
    }

    return task.then(function (data) {
      var list = Array.isArray(data) ? data : (data ? [data] : []);
      rows = reset ? list : rows.concat(list);
      var last = list.length ? list[list.length - 1] : null;
      cursor = last ? last.created_at : cursor;
      if (loadingEl) loadingEl.hidden = true;
      render();
    }).catch(function (err) {
      if (loadingEl) loadingEl.hidden = true;
      say("warn", err.message);
      if (!rows.length && emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = "没读出来：" + err.message;
      }
    }).then(function () { setBusy(false); });
  }

  /* ---------------------------------------------------------------
   * 动作
   * --------------------------------------------------------------- */
  function review(postId, status, reason) {
    return rpc("staff_review", {
      p_post_id: postId, p_status: status, p_reason: reason || null
    }).then(function () {
      say("info", status === "approved" ? "已通过，作者会收到提醒。" : "已驳回，理由会随提醒发给作者。");
      rows = rows.filter(function (r) { return r.id !== postId; });
      render();
    }).catch(function (err) { say("warn", err.message); });
  }

  function resolveAppeal(appealId, accept, reply) {
    return rpc("staff_resolve_appeal", {
      p_appeal_id: appealId, p_accept: accept, p_reply: reply || null
    }).then(function () {
      say("info", accept ? "已受理，这条分享已经放行。" : "已维持原判，回复会留在申诉记录里。");
      rows = rows.filter(function (r) { return r.id !== appealId; });
      render();
    }).catch(function (err) { say("warn", err.message); });
  }

  /* ---------------------------------------------------------------
   * 事件：一个委托，全部用 data-act
   * --------------------------------------------------------------- */
  function cardOf(node) {
    var el = node;
    while (el && el !== listEl) {
      if (el.getAttribute && (el.getAttribute("data-post") || el.getAttribute("data-appeal"))) return el;
      el = el.parentNode;
    }
    return null;
  }

  function panelOf(card) {
    return card.querySelector ? card.querySelector(".mod-reasons") : null;
  }

  if (listEl && listEl.addEventListener) {
    listEl.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var act = t.getAttribute("data-act");
      if (!act) return;
      var card = cardOf(t);
      if (!card) return;
      var postId = card.getAttribute("data-post");
      var appealId = card.getAttribute("data-appeal");
      var panel = panelOf(card);

      if (act === "approve") { review(postId, "approved", null); return; }
      if (act === "reject") {
        if (panel) panel.hidden = false;
        return;
      }
      if (act === "cancel") {
        if (panel) panel.hidden = true;
        return;
      }
      if (act === "reject-go") {
        if (!panel) return;
        var picked = panel.querySelector(".mod-chip.is-on");
        var box = panel.querySelector("[data-why-text]");
        var custom = box ? String(box.value || "").trim() : "";
        var reason = custom || (picked ? picked.textContent : "");
        if (!reason) { say("warn", "选一条理由，或者自己写一句。"); return; }
        if (reason.indexOf("其他原因") === 0 && !custom) {
          say("warn", "选了「其他原因」就把原因写在下面。");
          return;
        }
        review(postId, "rejected", reason);
        return;
      }
      if (act === "accept") { resolveAppeal(appealId, true, null); return; }
      if (act === "deny") {
        if (panel) panel.hidden = false;
        return;
      }
      if (act === "deny-go") {
        var replyBox = panel ? panel.querySelector("[data-reply]") : null;
        resolveAppeal(appealId, false, replyBox ? String(replyBox.value || "").trim() : "");
        return;
      }
    });

    listEl.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var idx = t.getAttribute("data-why");
      if (idx == null) return;
      var card = cardOf(t);
      var panel = card ? panelOf(card) : null;
      if (!panel) return;
      var chips = panel.querySelectorAll ? panel.querySelectorAll(".mod-chip") : [];
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.remove("is-on");
      }
      if (t.classList) t.classList.add("is-on");
    });
  }

  if (moreEl && moreEl.addEventListener) {
    moreEl.addEventListener("click", function () { fetchPage(false); });
  }

  /* 页签 */
  function setView(next) {
    if (next === VIEW) return;
    VIEW = next;
    cursor = null;
    rows = [];
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-view") === next;
      tabs[i].classList.toggle("is-on", on);
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    fetchPage(true);
  }

  for (var ti = 0; ti < tabs.length; ti++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        setView(tab.getAttribute("data-view"));
      });
    })(tabs[ti]);
  }

  /* ---------------------------------------------------------------
   * 启动
   * --------------------------------------------------------------- */
  if (loadingEl) loadingEl.hidden = false;
  if (gateEl) gateEl.hidden = true;

  /* 后端还没配置：先把缺什么说清楚（和其他页面同一个口径，别让人以为权限不够） */
  if (C.blockIfNotReady && C.blockIfNotReady(noticeEl)) {
    if (loadingEl) loadingEl.hidden = true;
    if (emptyEl) emptyEl.hidden = true;
    return;
  }

  checkStaff().then(function (ok) {
    if (!ok) { showGate(); return; }
    fetchPage(true);
  });
})();
