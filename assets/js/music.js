/* =====================================================================
 *  一起听（音乐专区）页逻辑 —— V5-M4
 *
 *  边界（PLAN_SCOPE_v5.md §6 / §13.5）：
 *   * 只放白名单平台（网易云 / QQ 音乐 / B 站）的官方嵌入卡片或跳转，
 *     不在前端抓歌名、封面（零运维，也不引入额外第三方请求）。
 *   * 「一起听」= 共享同一首歌 + 邀约，不做房间 / 实时音频同步。
 *   * 读写全走 security definer RPC（publish_music / music_feed /
 *     invite_to_listen / respond_listen_invite / my_listen_invites /
 *     delete_music），不裸读 music_posts / music_invites。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var noticeEl = document.getElementById("notice");
  var publishCard = document.getElementById("publish-card");
  var urlInput = document.getElementById("music-url");
  var noteInput = document.getElementById("music-note");
  var sendBtn = document.getElementById("music-send");
  var invitesCard = document.getElementById("invites-card");
  var invitesEl = document.getElementById("invites");
  var feedEl = document.getElementById("music-feed");
  var feedEmptyEl = document.getElementById("feed-empty");
  var feedLoadingEl = document.getElementById("feed-loading");
  var feedCountEl = document.getElementById("feed-count");
  var refreshBtn = document.getElementById("refresh");

  document.title = "一起听 · " + C.SITE_NAME;
  C.blockIfNotReady(noticeEl);

  var esc = C.escapeHtml;
  var PLATFORMS = {
    netease: { label: "网易云", cls: "p-netease" },
    qq: { label: "QQ 音乐", cls: "p-qq" },
    bilibili: { label: "B 站", cls: "p-bilibili" }
  };

  var me = "";              // 我的公开 UID（匿名 / 未登录为空）
  var items = [];           // 最近一次 music_feed 结果
  var invites = [];         // my_listen_invites 结果
  var mutual = null;        // { list: [...], failed: bool }（互关候选缓存）
  var pickFor = "";         // 当前展开候选的音乐帖 id
  var busy = false;

  function client() { return C.client(); }

  function failText(res, fallback) {
    var err = res && res.error;
    if (err && (err.code === "PGRST202" || err.code === "42883" || /does not exist/i.test(String(err.message || "")))) {
      return "一起听功能还没开启（站点刚更新，稍后再试）";
    }
    if (err && err.message) return String(err.message);
    return fallback || "没成功，再试一次";
  }

  /* ---------------- 播放卡片 ---------------- */

  function qqUrl(trackId) {
    return "https://y.qq.com/n/ryqq/songDetail/" + encodeURIComponent(String(trackId));
  }

  function embedHtml(item) {
    var id = String(item.track_id || "");
    if (item.platform === "bilibili") {
      var src = id.indexOf("BV") === 0
        ? "https://player.bilibili.com/player.html?bvid=" + encodeURIComponent(id) + "&page=1&high_quality=1&danmaku=0&autoplay=0"
        : "https://player.bilibili.com/player.html?aid=" + encodeURIComponent(id.replace(/^av/, "")) + "&page=1&autoplay=0";
      return '<div class="music-embed music-embed-video">' +
        '<iframe src="' + src + '" loading="lazy" referrerpolicy="no-referrer" ' +
        'scrolling="no" frameborder="0" allowfullscreen title="B 站播放器"></iframe></div>';
    }
    if (item.platform === "netease") {
      return '<div class="music-embed music-embed-audio">' +
        '<iframe src="https://music.163.com/outchain/player?type=2&id=' + encodeURIComponent(id) +
        '&auto=0&height=66" loading="lazy" referrerpolicy="no-referrer" ' +
        'frameborder="no" width="100%" height="86" title="网易云音乐播放器"></iframe></div>';
    }
    return '<a class="music-jump" href="' + esc(qqUrl(id)) + '" target="_blank" rel="noopener noreferrer">' +
      '在 QQ 音乐里打开 ↗</a>';
  }

  function cardHtml(item) {
    var plat = PLATFORMS[item.platform] || { label: item.platform, cls: "" };
    var listeners = Number(item.listeners) || 1;
    var listenTag = listeners > 1
      ? '<span class="music-listeners">🎧 ' + listeners + " 人在一起听</span>"
      : '<span class="music-listeners is-idle">🎧 一个人听</span>';
    var mineTag = "";
    if (item.mine === "pending") mineTag = '<span class="music-state">邀约待回应</span>';
    else if (item.mine === "accepted") mineTag = '<span class="music-state is-on">你们在一起听</span>';

    var actions = "";
    if (me) {
      actions += '<button class="btn btn-soft btn-sm" type="button" data-act="invite" data-id="' +
        esc(item.id) + '">邀请一起听</button>';
      if (item.user_uid === me) {
        actions += '<button class="btn btn-ghost btn-sm" type="button" data-act="delete" data-id="' +
          esc(item.id) + '">删除</button>';
      }
    }

    return '<article class="music-card" data-music="' + esc(item.id) + '">' +
      '<div class="music-card-head">' +
        '<span class="music-badge ' + plat.cls + '">' + esc(plat.label) + "</span>" +
        '<a class="music-author" href="profile.html?uid=' + encodeURIComponent(item.user_uid || "") + '">@' +
          esc(item.user_uid || "同学") + "</a>" +
        '<span class="music-time">' + esc(C.timeAgo(item.created_at)) + "</span>" +
      "</div>" +
      '<p class="music-note">' + esc(item.note) + "</p>" +
      embedHtml(item) +
      '<div class="music-foot">' + listenTag + mineTag +
        '<div class="music-actions">' + actions + "</div>" +
      "</div>" +
      '<div class="music-pick" data-pick="' + esc(item.id) + '" hidden></div>' +
      "</article>";
  }

  function renderFeed() {
    if (!items.length) {
      feedEl.innerHTML = "";
      feedEmptyEl.hidden = false;
      feedCountEl.textContent = "";
      return;
    }
    feedEmptyEl.hidden = true;
    feedCountEl.textContent = items.length + " 首";
    feedEl.innerHTML = items.map(cardHtml).join("");
    if (pickFor) paintPick(pickFor);
  }

  /* ---------------- 选人 ---------------- */

  function paintPick(musicId) {
    var box = feedEl.querySelector('.music-pick[data-pick="' + cssSafe(musicId) + '"]');
    if (!box) return;
    box.hidden = false;
    if (!mutual) {
      box.innerHTML = '<span class="music-pick-note">正在找和你互相关注的人…</span>';
      return;
    }
    if (mutual.failed) {
      box.innerHTML = '<span class="music-pick-note">一起听还没开启（站点刚更新，稍后再试）。</span>';
      return;
    }
    if (!mutual.list.length) {
      box.innerHTML = '<span class="music-pick-note">还没有互相关注的人 —— 先互相关注，才能邀请一起听。</span>';
      return;
    }
    box.innerHTML = '<span class="music-pick-note">选一个同学：</span>' +
      mutual.list.map(function (p) {
        return '<button class="music-chip" type="button" data-act="pick" data-music="' + esc(musicId) +
          '" data-uid="' + esc(p.public_uid) + '">@' + esc(p.public_uid) + "</button>";
      }).join("");
  }

  function cssSafe(s) {
    return String(s || "").replace(/["\\]/g, "");
  }

  function closePicks() {
    pickFor = "";
    var boxes = feedEl.querySelectorAll(".music-pick");
    for (var i = 0; i < boxes.length; i++) boxes[i].hidden = true;
  }

  function loadMutual() {
    if (mutual) return Promise.resolve(mutual);
    return client().rpc("my_mutual_follows").then(function (res) {
      if (res && res.error) {
        mutual = { list: [], failed: true };   // 不缓存失败，重开页面还能再试
        return mutual;
      }
      mutual = { list: (res && res.data) || [], failed: false };
      return mutual;
    }).catch(function () {
      return { list: [], failed: true };
    });
  }

  /* ---------------- 邀约 ---------------- */

  function renderInvites() {
    var pending = invites.filter(function (i) { return i.direction === "in" && i.status === "pending"; });
    if (!pending.length) {
      invitesCard.hidden = true;
      invitesEl.innerHTML = "";
      return;
    }
    invitesCard.hidden = false;
    invitesEl.innerHTML = pending.map(function (i) {
      var plat = PLATFORMS[i.platform] || { label: i.platform, cls: "" };
      return '<div class="invite-card">' +
        '<p class="invite-line"><strong>@' + esc(i.other_uid) + "</strong> 邀你一起听 " +
          '<span class="music-badge ' + plat.cls + '">' + esc(plat.label) + "</span></p>" +
        '<p class="invite-song">' + esc(i.note) + "</p>" +
        '<div class="invite-actions">' +
          '<button class="btn btn-primary btn-sm" type="button" data-act="accept" data-id="' + esc(i.invite_id) + '">一起听</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-act="decline" data-id="' + esc(i.invite_id) + '">这次不了</button>' +
        "</div></div>";
    }).join("");
  }

  /* ---------------- 读取 ---------------- */

  function loadFeed() {
    feedLoadingEl.hidden = false;
    return client().rpc("music_feed", { p_limit: 30 }).then(function (res) {
      feedLoadingEl.hidden = true;
      if (res && res.error) {
        items = [];
        renderFeed();
        C.toast(failText(res, "音乐专区还没开启"));
        return;
      }
      items = (res && res.data) || [];
      renderFeed();
    }).catch(function () {
      feedLoadingEl.hidden = true;
      C.toast("音乐专区读取失败，检查网络后再试");
    });
  }

  function loadInvites() {
    if (!me) { invites = []; renderInvites(); return Promise.resolve(); }
    return client().rpc("my_listen_invites").then(function (res) {
      invites = (res && !res.error && res.data) || [];
      renderInvites();
    }).catch(function () {
      invites = [];
      renderInvites();
    });
  }

  /* ---------------- 动作 ---------------- */

  function publish() {
    if (busy) return;
    var url = String(urlInput.value || "").trim();
    var note = String(noteInput.value || "").trim();
    if (!url) { C.toast("先粘贴一条歌曲或视频链接"); urlInput.focus(); return; }
    if (!note) { C.toast("写一句话吧，让同学知道为什么想听"); noteInput.focus(); return; }

    busy = true;
    sendBtn.disabled = true;
    client().rpc("publish_music", { p_url: url, p_note: note }).then(function (res) {
      busy = false;
      sendBtn.disabled = false;
      if (res && res.error) {
        C.toast(failText(res, "没发出去，再试一次"));
        return;
      }
      urlInput.value = "";
      noteInput.value = "";
      C.toast("发出去了，等同学来一起听");
      loadFeed();
    }).catch(function () {
      busy = false;
      sendBtn.disabled = false;
      C.toast("网络不太顺，再试一次");
    });
  }

  function invite(musicId, uid) {
    if (busy) return;
    busy = true;
    client().rpc("invite_to_listen", { p_music_id: musicId, p_invitee_uid: uid }).then(function (res) {
      busy = false;
      if (res && res.error) {
        C.toast(failText(res, "邀请没发出去"));
        return;
      }
      closePicks();
      C.toast("已经发出邀请，等对方回应");
      loadFeed();
      loadInvites();
    }).catch(function () {
      busy = false;
      C.toast("网络不太顺，再试一次");
    });
  }

  function respond(inviteId, accept) {
    if (busy) return;
    busy = true;
    client().rpc("respond_listen_invite", { p_invite_id: inviteId, p_accept: !!accept }).then(function (res) {
      busy = false;
      if (res && res.error) {
        C.toast(failText(res, "没处理成功"));
        return;
      }
      C.toast(accept ? "好，你们在一起听这首歌了" : "已经婉拒了");
      loadFeed();
      loadInvites();
    }).catch(function () {
      busy = false;
      C.toast("网络不太顺，再试一次");
    });
  }

  function remove(musicId) {
    if (busy) return;
    if (!window.confirm("删除这条音乐帖？已经成立的「一起听」也会一起收起。")) return;
    busy = true;
    client().rpc("delete_music", { p_music_id: musicId }).then(function (res) {
      busy = false;
      if (res && res.error) {
        C.toast(failText(res, "没删掉"));
        return;
      }
      C.toast("已经删掉了");
      loadFeed();
    }).catch(function () {
      busy = false;
      C.toast("网络不太顺，再试一次");
    });
  }

  /* ---------------- 事件 ---------------- */

  feedEl.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "invite") {
      var id = el.getAttribute("data-id");
      if (pickFor === id) { closePicks(); return; }
      closePicks();
      pickFor = id;
      paintPick(id);
      loadMutual().then(function () {
        if (pickFor === id) paintPick(id);
      });
    } else if (act === "pick") {
      invite(el.getAttribute("data-music"), el.getAttribute("data-uid"));
    } else if (act === "delete") {
      remove(el.getAttribute("data-id"));
    }
  });

  invitesEl.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!el) return;
    var act = el.getAttribute("data-act");
    var id = el.getAttribute("data-id");
    if (act === "accept") respond(id, true);
    else if (act === "decline") respond(id, false);
  });

  sendBtn.addEventListener("click", publish);
  urlInput.addEventListener("keydown", function (ev) { if (ev.key === "Enter") publish(); });
  noteInput.addEventListener("keydown", function (ev) { if (ev.key === "Enter") publish(); });
  refreshBtn.addEventListener("click", function () {
    mutual = null;
    loadFeed();
    loadInvites();
  });

  /* ---------------- 启动 ---------------- */

  function boot() {
    C.getIdentity().then(function (id) {
      if (id && id.user && !id.isAnonymous) {
        return C.getProfile().then(function (p) {
          me = (p && p.public_uid) || "";
          publishCard.hidden = !me;
          if (!me) {
            C.toast("这个账号还没有公开 UID，先在「我的」完善资料再发歌");
          }
          return null;
        });
      }
      me = "";
      publishCard.hidden = true;   // 匿名 / 未登录：可看不可发
      return null;
    }).then(function () {
      return Promise.all([loadFeed(), loadInvites()]);
    }).catch(function () {
      feedLoadingEl.hidden = true;
      C.toast("页面初始化失败，刷新一下再试");
    });
  }

  boot();
})();
