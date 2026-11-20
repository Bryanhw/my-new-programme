/* 站内提醒中心（V5 第 68 轮）
 *
 * 一页看全：@ 提到 / 一起听 / 私信，按类型筛选、按时间往前翻页。
 * 只读自己的提醒；匿名身份与未登录都给一句人话，不假装有数据。
 */
(function () {
  "use strict";

  var C = window.Campus || {};
  document.title = "站内提醒 · " + (C.SITE_NAME || "校园拾光");
  if (C.markTabbar) C.markTabbar("notifications");
  if (!C.client) return;

  var listEl = document.getElementById("nc-list");
  var loadingEl = document.getElementById("nc-loading");
  var emptyEl = document.getElementById("nc-empty");
  var loginEl = document.getElementById("nc-login");
  var anonEl = document.getElementById("nc-anon");
  var readAllEl = document.getElementById("nc-read-all");
  var moreEl = document.getElementById("nc-more");
  var summaryEl = document.getElementById("nc-summary");
  var noticeEl = document.getElementById("notice");
  var TAB_DEFS = [
    { type: "",        id: "nc-tab-all" },
    { type: "social",  id: "nc-tab-social" },   /* comment + reply + like + hug */
    { type: "mention", id: "nc-tab-mention" },
    { type: "listen",  id: "nc-tab-listen" },
    { type: "dm",      id: "nc-tab-dm" },
    { type: "review",  id: "nc-tab-review" }
  ];
  var dmJumpEl = document.getElementById("nc-dm-jump");
  var tabs = [];
  for (var ti = 0; ti < TAB_DEFS.length; ti++) {
    var tabEl = document.getElementById(TAB_DEFS[ti].id);
    if (tabEl) tabs.push({ type: TAB_DEFS[ti].type, el: tabEl });
  }

  var PAGE = 20;
  var state = { type: "", before: null, loading: false, done: false, rows: [] };

  function esc(s) {
    var v = String(s == null ? "" : s);
    return C.escapeHtml ? C.escapeHtml(v) : v;
  }

  function ago(t) {
    return C.timeAgo ? C.timeAgo(t || "") : "";
  }

  function toast(msg) {
    if (C.toast) C.toast(msg);
    else if (noticeEl) { noticeEl.textContent = msg; noticeEl.hidden = false; }
  }

  /* 这三类的 body 本身就是一句完整的话（「3 人赞了你的分享」「你的分享已通过审核」），
     不再拼「谁 + 做了什么」，否则会出现「一位同学 赞了你的分享 / 3 人赞了你的分享」。 */
  function bodyOnly(n) {
    return n.type === "like" || n.type === "hug" || n.type === "review";
  }

  function lineOf(n) {
    if (n.type === "listen_invite") return "邀你一起听";
    if (n.type === "listen_accept") return "接受了一起听";
    if (n.type === "dm") return "给你发了一条私信";
    if (n.type === "comment") return "评论了你的分享";
    if (n.type === "reply") return "回复了你的评论";
    return "在评论里 @ 了你";
  }

  function fallbackOf(n) {
    if (n.type === "dm") return "点开去回一句";
    if (n.type === "listen_invite" || n.type === "listen_accept") return "点开去一起听";
    if (n.type === "like" || n.type === "hug" || n.type === "review") return "点开看看这条分享";
    return "点开看看这条评论";
  }

  /* 评论 / 回复 / 赞 / 抱抱 / 审核都落在同一条分享上，直接去它的详情页。
     详情页会打开评论区，比广场的「滚过去并高亮」更贴近提醒的意图。 */
  function hrefOf(n) {
    if (n.type === "listen_invite" || n.type === "listen_accept") {
      return "music.html?r=" + Date.now();
    }
    if (n.type === "dm") {
      return "messages.html" + (n.from_uid
        ? "?with=" + encodeURIComponent(String(n.from_uid))
        : "?r=" + Date.now());
    }
    var pid = n.post_id
      || ((n.type === "like" || n.type === "hug" || n.type === "review") ? n.ref_id : "");
    return pid
      ? "detail.html?id=" + encodeURIComponent(String(pid))
      : "feed.html";
  }

  function renderItem(n) {
    var who = n.from_nick || "一位同学";
    var body = String(n.body || "");
    var only = bodyOnly(n);
    var head = only
      ? "<strong>" + esc(body || fallbackOf(n)) + "</strong>"
      : "<strong>" + esc(who) + "</strong> " + lineOf(n);
    return '<div class="notice-item' + (n.read_at ? "" : " is-unread") + '">' +
      '<div class="notice-item-top">' +
        head +
        "<span>" + esc(ago(n.created_at)) + "</span>" +
      "</div>" +
      '<a class="notice-item-body" href="' + esc(hrefOf(n)) + '">' +
        esc(only ? fallbackOf(n) : (body || fallbackOf(n))) +
      "</a>" +
      "</div>";
  }

  function showLoggedOut(identity) {
    if (loadingEl) loadingEl.hidden = true;
    if (readAllEl) readAllEl.hidden = true;
    if (moreEl) moreEl.hidden = true;
    if (!identity || !identity.user) {
      if (loginEl) loginEl.hidden = false;
      return;
    }
    if (identity.isAnonymous && anonEl) anonEl.hidden = false;
  }

  function paintEmpty() {
    if (emptyEl) emptyEl.hidden = state.rows.length > 0;
    if (state.rows.length === 0 && loadingEl) loadingEl.hidden = true;
  }

  function paintReadAll() {
    if (!readAllEl) return;
    var unread = state.rows.some(function (r) { return !r.read_at; });
    readAllEl.hidden = !unread || state.rows.length === 0;
  }

  function paintMore() {
    if (!moreEl) return;
    moreEl.hidden = state.done || state.rows.length === 0;
  }

  function append(rows) {
    var html = rows.map(renderItem).join("");
    if (html) listEl.insertAdjacentHTML("beforeend", html);
  }

  function load() {
    if (state.loading || state.done) return;
    state.loading = true;
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = state.rows.length ? "再看更早的…" : "正在读取…";
    }

    var params = { p_limit: PAGE };
    if (state.type) params.p_type = state.type;
    if (state.before) params.p_before = state.before;

    C.client().rpc("my_notifications", params).then(function (res) {
      state.loading = false;
      if (loadingEl) loadingEl.hidden = true;

      if (res && res.error) {
        // 迁移还没跑：不假装空，给一句安静的解释
        if (loadingEl) {
          loadingEl.hidden = false;
          loadingEl.textContent = "提醒还没开启，站点更新后再来看看。";
        }
        return;
      }

      var rows = (res && res.data) || [];
      if (!rows.length) {
        state.done = true;
        if (state.rows.length === 0) {
          state.rows = [];
          paintEmpty();
        }
        paintMore();
        paintReadAll();
        return;
      }

      state.rows = state.rows.concat(rows);
      state.before = rows[rows.length - 1].created_at;
      if (rows.length < PAGE) state.done = true;
      append(rows);
      paintEmpty();
      paintMore();
      paintReadAll();
      paintSummary();
    }).catch(function () {
      state.loading = false;
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.textContent = "没读到提醒，稍后再试一次。";
      }
    });
  }

  function paintSummary() {
    if (!summaryEl) return;
    var unread = state.rows.filter(function (r) { return !r.read_at; }).length;
    summaryEl.textContent = state.rows.length
      ? (unread ? unread + " 条未读" : "都读过了")
      : "";
  }

  function loadUnread() {
    C.client().rpc("my_unread_counts").then(function (res) {
      var rows = (res && !res.error && res.data) || [];
      var total = rows.reduce(function (n, r) { return n + Number(r.n || 0); }, 0);
      if (summaryEl && total && !state.rows.length) summaryEl.textContent = total + " 条未读";
    }).catch(function () { /* 角标拿不到就不显示，不影响正文 */ });
  }

  function switchType(type) {
    if (state.type === type) return;
    state.type = type;
    if (dmJumpEl) dmJumpEl.hidden = type !== "dm";
    state.before = null;
    state.done = false;
    state.loading = false;
    state.rows = [];
    if (listEl) listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = true;
    if (summaryEl) summaryEl.textContent = "";

    tabs.forEach(function (t) {
      var on = t.type === type;
      t.el.classList.toggle("is-on", on);
      t.el.setAttribute("aria-selected", on ? "true" : "false");
    });
    load();
  }

  tabs.forEach(function (t) {
    t.el.addEventListener("click", function () { switchType(t.type); });
  });

  if (moreEl) moreEl.addEventListener("click", load);

  if (readAllEl) {
    readAllEl.addEventListener("click", function () {
      readAllEl.disabled = true;
      var params = { p_type: state.type || null };
      C.client().rpc("mark_notifications_read", params).then(function (res) {
        readAllEl.disabled = false;
        if (res && res.error) { toast("没标成功，稍后再试"); return; }
        var now = new Date().toISOString();
        state.rows = state.rows.map(function (r) {
          return r.read_at ? r : Object.assign({}, r, { read_at: now });
        });
        if (listEl) listEl.innerHTML = state.rows.map(renderItem).join("");
        paintReadAll();
        paintSummary();
        if (C.refreshNotifBadge) C.refreshNotifBadge();
        toast("已标为已读");
      }).catch(function () {
        readAllEl.disabled = false;
        toast("没标成功，稍后再试");
      });
    });
  }

  /* 启动：先确认身份，再决定是读数据还是说人话 */
  function boot() {
    if (C.blockIfNotReady && C.blockIfNotReady(noticeEl)) return;
    var identity = C.getIdentity ? C.getIdentity() : null;
    if (identity && identity.then) {
      identity.then(go, function () { go(null); });
      return;
    }
    go(identity);
  }

  function go(identity) {
    if (!identity || !identity.user || identity.isAnonymous) {
      showLoggedOut(identity);
      return;
    }
    state.before = null;
    state.done = false;
    load();
    loadUnread();
  }

  boot();
})();
