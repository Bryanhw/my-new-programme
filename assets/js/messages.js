/* =====================================================================
 *  私信页逻辑：会话列表 + 一对一对话 + 写给某个洞号
 *
 *  M2 数据红线：本页所有读写都走 security definer RPC
 *    （list_rooms / list_messages / send_message / report_message /
 *      send_drift_letter），不裸读 direct_messages / message_reports /
 *      drift_letters 三张表。公开主页昵称只从 public_profiles 拿。
 *
 *  直达参数：
 *    messages.html            -> 会话列表
 *    messages.html?with=<uid> -> 直接打开和 <uid> 的那场对话
 *    messages.html?hole=<code>-> 写给这个洞号（匿名投递，不露身份）
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var noticeEl = document.getElementById("notice");
  var roomsEl = document.getElementById("rooms");
  var roomsEmptyEl = document.getElementById("rooms-empty");
  var roomsTitleEl = document.getElementById("rooms-title");
  var threadEl = document.getElementById("thread");
  var threadBackBtn = document.getElementById("thread-back");
  var threadTitleEl = document.getElementById("thread-title");
  var messagesEl = document.getElementById("messages");
  var threadEmptyEl = document.getElementById("thread-empty");
  var composerEl = document.getElementById("composer");
  var bodyInput = document.getElementById("dm-body");
  var sendBtn = document.getElementById("dm-send");
  var holeEl = document.getElementById("hole");
  var holeBody = document.getElementById("hole-body");
  var holeSendBtn = document.getElementById("hole-send");
  var holeNoteEl = document.getElementById("hole-note");
  var refreshBtn = document.getElementById("refresh");

  document.title = "私信 · " + C.SITE_NAME;
  C.blockIfNotReady(noticeEl);

  /* 地址栏直达参数 */
  var params = (function () {
    var out = { with: "", hole: "" };
    var qs = String(window.location.search || "").replace(/^\?/, "");
    var pairs = qs ? qs.split("&") : [];
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split("=");
      var k = decodeURIComponent(kv[0] || "");
      if (k !== "with" && k !== "hole") continue;
      var v = "";
      try { v = decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); } catch (e) { v = ""; }
      out[k] = v;
    }
    return out;
  })();

  /* 我自己（公开账号才有 public_uid；匿名 / 未登录约等于不可用） */
  var me = "";
  var currentOther = "";   // 当前打开着的那场对话的对端
  var nickCache = {};       // public_uid -> nickname（会话列表一次拉全）
  var loading = false;
  var pollTimer = null;

  /* 举报原因白名单：与 message_reports_reason_check 一致 */
  var REPORT_REASONS_MESSAGE = [
    { v: "illegal",  t: "违法内容" },
    { v: "porn",     t: "色情低俗" },
    { v: "ad",       t: "广告或推销" },
    { v: "abuse",    t: "人身攻击" },
    { v: "privacy",  t: "泄露他人隐私" },
    { v: "other",    t: "其他" }
  ];

  /* 登录门禁：私信只对「登录的公开账号」开放。匿名访客在这里拿到明确的下一步 */
  function requirePublicAccount() {
    return C.getIdentity().then(function (id) {
      if (!id.user) {
        renderNotAllowed("还没有登录。私信需要登录公开账号才能用，先登录 / 注册吧。", "login.html");
        return null;
      }
      if (id.isAnonymous) {
        renderNotAllowed("匿名访客暂时用不了私信 —— 登录公开账号就能私信同学了。", "login.html");
        return null;
      }
      return id;
    });
  }

  function renderNotAllowed(text, href) {
    roomsEl.innerHTML =
      '<div class="empty">' +
        '<div class="empty-icon">🔒</div>' +
        '<div class="empty-title">' + C.escapeHtml(text) + "</div>" +
        '<a class="btn btn-primary btn-block mt-16" href="' + C.escapeHtml(href) + '">去登录 / 注册</a>' +
      "</div>";
    roomsTitleEl.textContent = "私信";
  }

  function waitForMyUid() {
    if (me) return Promise.resolve(me);
    return C.client().rpc("my_public_uid").then(function (mres) {
      me = (mres && mres.data) || "";
      return me;
    });
  }

  /* 会话列表：list_rooms 只给 other_uid，昵称从 public_profiles 补一次查全 */
  function resolveNicknames(uids) {
    var want = [];
    var need = [];
    for (var i = 0; i < uids.length; i++) {
      if (nickCache[uids[i]] !== undefined) continue;
      want.push(uids[i]);
      if (nickCache[uids[i]] === undefined) need.push(uids[i]);
    }
    if (!need.length) return Promise.resolve();
    return C.client().from("public_profiles")
      .select("public_uid, nickname")
      .in("public_uid", need)
      .then(function (res) {
        var rows = (res && res.data) || [];
        for (var j = 0; j < rows.length; j++) {
          if (rows[j]) nickCache[rows[j].public_uid] = rows[j].nickname || "";
        }
        for (var k = 0; k < need.length; k++) {
          if (nickCache[need[k]] === undefined) nickCache[need[k]] = "";
        }
      })
      .catch(function () {
        for (var k2 = 0; k2 < need.length; k2++) {
          if (nickCache[need[k2]] === undefined) nickCache[need[k2]] = "";
        }
      });
  }

  function nickOf(uid) {
    var n = nickCache[uid];
    return (n && String(n).trim()) ? String(n).trim() : ("@" + uid);
  }

  function renderRooms(rooms) {
    roomsEl.innerHTML = "";
    if (!rooms || !rooms.length) {
      roomsEmptyEl.hidden = false;
      return;
    }
    roomsEmptyEl.hidden = true;
    var uids = [];
    for (var i = 0; i < rooms.length; i++) {
      uids.push(rooms[i].other_uid);
    }
    resolveNicknames(uids).then(function () {
      var html = [];
      for (var j = 0; j < rooms.length; j++) {
        var r = rooms[j];
        var unread = r.unread_count || 0;
        var last = String(r.last_body || "");
        if (r.last_sender_uid === me) last = "我：" + last;
        html.push(
          '<a class="card room-card" href="messages.html?with=' + C.escapeHtml(r.other_uid) + '">' +
            '<span class="room-avatar">' + C.escapeHtml(C.initial(nickOf(r.other_uid))) + '</span>' +
            '<span class="room-main">' +
              '<span class="room-top">' +
                '<b class="room-name">' + C.escapeHtml(nickOf(r.other_uid)) + '</b>' +
                '<small class="room-time">' + C.escapeHtml(C.timeAgo(r.last_at || "")) + "</small>" +
              "</span>" +
              '<span class="room-last">' + C.escapeHtml(last) + "</span>" +
            "</span>" +
            (unread ? '<span class="room-unread">' + unread + "</span>" : "") +
          "</a>"
        );
      }
      roomsEl.innerHTML = html.join("");
    });
  }

  function loadRooms() {
    if (loading) return;
    loading = true;
    C.client().rpc("list_rooms").then(function (res) {
      loading = false;
      if (res && res.error) { C.toast("会话没拉起来：" + res.error.message); return; }
      renderRooms(res && res.data);
    }).catch(function () {
      loading = false;
      roomsEl.innerHTML = '<div class="notice notice-error" role="status">会话列表加载失败，点右上角刷新重试。</div>';
    });
  }

  /* ------------------------------------------------
   * 打开一场对话
   * ------------------------------------------------ */
  function openThread(other) {
    if (!other) return;
    currentOther = other;
    roomsEl.parentNode.style.display = "none";
    holeEl.hidden = true;
    threadEl.hidden = false;
    threadTitleEl.textContent = nickOf(other);
    messagesEl.innerHTML = "";
    threadEmptyEl.hidden = true;
    loadMessages();
  }

  function bubble(row) {
    var mine = row.sender_uid === me;
    var cls = mine ? "dm-row dm-mine" : "dm-row dm-theirs";
    var body = String(row.body || "");
    var time = C.escapeHtml(C.timeAgo(row.created_at || ""));
    var html = '<div class="' + cls + '">' +
      '<div class="dm-bubble">' +
        '<div class="dm-text">' + C.escapeHtml(body) + "</div>" +
        '<div class="dm-meta">' +
          time +
          (mine ? "" : '<button type="button" class="dm-report btn-link-pure" data-mid="' +
            C.escapeHtml(row.id || "") + '">举报</button>') +
        "</div>" +
      "</div>" +
    "</div>";
    return html;
  }

  function loadMessages() {
    if (!currentOther) return;
    C.client().rpc("list_messages", { p_other_uid: currentOther }).then(function (res) {
      if (res && res.error) { C.toast("消息没拉起来：" + res.error.message); return; }
      var rows = (res && res.data) || [];
      if (!rows.length) {
        messagesEl.innerHTML = "";
        threadEmptyEl.hidden = false;
        return;
      }
      threadEmptyEl.hidden = true;
      messagesEl.innerHTML = rows.map(bubble).join("");
      if (messagesEl.scrollTop === undefined || (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 120) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }).catch(function () {
      C.toast("消息加载失败，点刷新重试。");
    });
  }

  function sendMessage() {
    var body = String(bodyInput.value || "");
    if (!currentOther) return;
    if (!body.replace(/^\s+|\s+$/g, "")) { C.toast("先说点什么吧。"); return; }
    sendBtn.disabled = true;
    C.client().rpc("send_message", { p_recipient_uid: currentOther, p_body: body })
      .then(function (res) {
        sendBtn.disabled = false;
        if (res && res.error) { C.toast("没发出去：" + res.error.message); return; }
        bodyInput.value = "";
        loadMessages();
      })
      .catch(function () {
        sendBtn.disabled = false;
        C.toast("发送失败，请重试。");
      });
  }

  /* -------------------------
   * 举报（只能举报收到的私信：只在对方那条气泡上给入口）
   * ------------------------- */
  function openReport(mid) {
    if (!mid) return;
    var reasons = REPORT_REASONS_MESSAGE.map(function (o) {
      return '<option value="' + C.escapeHtml(o.v) + '">' + C.escapeHtml(o.t) + "</option>";
    }).join("");
    var mask = document.createElement("div");
    mask.className = "dm-mask";
    mask.innerHTML =
      '<div class="dm-sheet" role="dialog" aria-modal="true">' +
        '<h3 class="section-title">举报这条私信</h3>' +
        '<p class="text-sm on-gold">请说明原因。重复举报同一内容不会叠加处理。</p>' +
        '<select class="dm-field" id="report-reason">' + reasons + "</select>" +
        '<textarea class="dm-field" id="report-detail" rows="3" maxlength="200" placeholder="补充说明（200 字以内，可不填）"></textarea>' +
        '<div class="row" style="gap:10px">' +
          '<button type="button" class="btn btn-ghost" id="report-cancel">取消</button>' +
          '<button type="button" class="btn btn-primary" id="report-ok">提交举报</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(mask);
    var reasonEl = mask.querySelector("#report-reason");
    var detailEl = mask.querySelector("#report-detail");
    var close = function () { if (mask.parentNode) mask.parentNode.removeChild(mask); };
    mask.addEventListener("click", function (e) {
      if (e.target === mask) close();
    });
    mask.querySelector("#report-cancel").onclick = close;
    mask.querySelector("#report-ok").onclick = function () {
      var reason = reasonEl.value || "other";
      var detail = String(detailEl.value || "").trim();
      mask.querySelector("#report-ok").disabled = true;
      C.client().rpc("report_message", {
        p_message_id: mid, p_reason: reason, p_detail: detail
      }).then(function (res) {
        if (res && res.error) { C.toast("没提交上：" + res.error.message); return; }
        close();
        C.toast("已收到，我们正在处理。");
      }).catch(function () {
        C.toast("提交失败，请重试。");
      });
    };
  }

  /* -------------------------
   * 写给这个洞号（?hole=）：匿名投递，界面不出现任何账号身份
   * ------------------------- */
  function openHole(code) {
    if (!code) return;
    roomsEl.parentNode.style.display = "none";
    threadEl.hidden = true;
    holeEl.hidden = false;
    holeBody.value = "";
    holeNoteEl.hidden = true;
  }

  function sendHoleLetter() {
    var body = String(holeBody.value || "");
    if (!body.replace(/^\s+|\s+$/g, "")) { C.toast("写点什么再寄吧。"); return; }
    var code = params.hole || "";
    if (!code) { C.toast("地址里没有洞号。"); return; }
    holeSendBtn.disabled = true;
    C.client().rpc("send_drift_letter", { p_to_anon: code, p_body: body }).then(function (res) {
      holeSendBtn.disabled = false;
      if (res && res.error) { C.toast("没寄出：" + res.error.message); return; }
      holeBody.value = "";
      holeNoteEl.hidden = false;
      holeNoteEl.textContent = "寄出了。这封信会匿名送达；对方只能看到洞号和你的字。";
    }).catch(function () {
      holeSendBtn.disabled = false;
      C.toast("寄送失败，请重试。");
    });
  }

  /* 20s 轻轮询：只在页面可见时走，避免和多页签打架 */
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      if (!threadEl.hidden && currentOther) loadMessages();
      else loadRooms();
    }, 20000);
  }

  /* -------------------------
   * 启动
   * ------------------------- */
  function boot() {
    if (C.blockIfNotReady(noticeEl)) return;

    requirePublicAccount().then(function (id) {
      if (!id) return;
      waitForMyUid().then(function () {
        if (params.hole) { openHole(params.hole); startPolling(); return; }
        if (params.with) {
          resolveNicknames([params.with]).then(function () { openThread(params.with); });
        } else {
          loadRooms();
        }
        startPolling();
      });
    });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", function () {
    window.location.reload();
  });
  if (threadBackBtn) threadBackBtn.addEventListener("click", function () {
    window.location.replace("messages.html");
  });
  if (composerEl) composerEl.addEventListener("submit", function (e) {
    e.preventDefault();
    sendMessage();
  });
  if (holeSendBtn) holeSendBtn.addEventListener("click", sendHoleLetter);
  if (messagesEl) messagesEl.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".dm-report") : null;
    if (btn) openReport(btn.getAttribute("data-mid"));
  });

  boot();
})();
