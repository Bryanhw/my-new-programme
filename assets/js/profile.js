/* =====================================================================
 *  「我的」页逻辑：昵称设置、我的发布、退出登录
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;

  var noticeEl   = document.getElementById("notice");
  var heroEl     = document.getElementById("profile-hero");
  var avatarEl   = document.getElementById("profile-avatar");
  var nameEl     = document.getElementById("profile-name");
  var subEl      = document.getElementById("profile-sub");
  var statPosts  = document.getElementById("stat-posts");
  var statLikes  = document.getElementById("stat-likes");
  var statDays   = document.getElementById("stat-days");

  var nickCard   = document.getElementById("nickname-card");
  var nickForm   = document.getElementById("nickname-form");
  var nickInput  = document.getElementById("nickname-input");
  var nickBtn    = document.getElementById("nickname-submit");

  var mineCard   = document.getElementById("mine-card");
  var mineEl     = document.getElementById("mine-list");

  var reportsCard = document.getElementById("reports-card");
  var reportsEl   = document.getElementById("reports-list");

  var signOutBtn = document.getElementById("signout");
  var anonTip    = document.getElementById("anon-tip");

  var currentUser = null;
  var currentProfile = null;
  var currentIsAnon = false;

  document.title = "我的 · " + C.SITE_NAME;
  C.markTabbar("profile");
  C.blockIfNotReady(noticeEl);

  /* ---------------------------------------------------------------
   * 加载
   * --------------------------------------------------------------- */
  function boot() {
    if (!C.isReady()) {
      heroEl.innerHTML = C.setupCard();
      nickCard.classList.add("hidden");
      mineCard.classList.add("hidden");
      reportsCard.classList.add("hidden");
      signOutBtn.classList.add("hidden");
      return;
    }

    C.getIdentity().then(function (id) {
      if (!id.user) {
        heroEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">👋</div>' +
            '<div class="empty-title">还没有登录</div>' +
            '<div class="empty-text">登录后可以设置昵称、管理自己发布的内容。</div>' +
          "</div>" +
          '<a class="btn btn-primary btn-block mt-16" href="login.html">去登录 / 注册</a>';
        nickCard.classList.add("hidden");
        mineCard.classList.add("hidden");
        reportsCard.classList.add("hidden");
        signOutBtn.classList.add("hidden");
        return;
      }

      currentUser = id.user;
      currentIsAnon = !!id.isAnonymous;

      // 匿名访客也能设置昵称：设置后，没有勾选匿名的分享就会用这个名字署名
      if (id.isAnonymous) anonTip.classList.remove("hidden");
      else anonTip.classList.add("hidden");
      nickCard.classList.remove("hidden");

      C.getProfile().then(function (p) {
        currentProfile = p;
        renderHero(id, p);
        nickInput.value = (p && p.nickname) || "";
      });

      loadMyPosts();
      loadMyReports();
    });
  }

  function renderHero(id, p) {
    var nick = (p && p.nickname) || "";
    var label;
    if (id.isAnonymous) label = nick ? nick + "（匿名访客）" : "匿名访客";
    else label = nick || "还没设置昵称";

    avatarEl.textContent = (id.isAnonymous && !nick) ? "🌙" : C.initial(nick || label);
    nameEl.textContent = label;

    var parts = [];
    if (p && p.school) parts.push(C.escapeHtml(p.school));
    if (p && p.phone) parts.push(C.maskPhone(p.phone));
    if (!parts.length) parts.push("欢迎来到 " + C.SITE_NAME);

    subEl.innerHTML = parts.join(" · ");

    if (p && p.created_at) {
      var days = Math.max(1, Math.ceil((Date.now() - new Date(p.created_at).getTime()) / 86400000));
      statDays.textContent = days;
    } else {
      statDays.textContent = "1";
    }
  }

  function loadMyPosts() {
    C.listMyPosts().then(function (posts) {
      statPosts.textContent = posts.length;

      var anonCount = 0;
      posts.forEach(function (p) { if (p.is_anonymous) anonCount++; });
      statLikes.textContent = anonCount;

      if (!posts.length) {
        mineEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">📮</div>' +
            '<div class="empty-title">还没有发布过内容</div>' +
            '<div class="empty-text">写下第一句话，或者分享一张今天的照片。</div>' +
          "</div>" +
          '<a class="btn btn-primary btn-block mt-16" href="post.html">去分享</a>';
        return;
      }

      mineEl.innerHTML = posts.map(function (p) {
        return C.renderPostCard(p) +
          '<div class="text-center mb-16" style="margin-top:-8px">' +
            '<button class="link-plain" data-del="' + C.escapeHtml(p.id) + '">删除这条</button>' +
          "</div>";
      }).join("");
    }).catch(function (err) {
      mineEl.innerHTML = '<div class="notice notice-error">加载失败：' + C.escapeHtml(err.message) + "</div>";
    });
  }

  /* 我举报过的内容：没有就整块藏起来，免得没用过的同学看着奇怪 */
  function loadMyReports() {
    C.listMyReports().then(function (reports) {
      if (!reports.length) {
        reportsCard.classList.add("hidden");
        return;
      }
      reportsCard.classList.remove("hidden");
      reportsEl.innerHTML = reports.map(function (r) {
        return C.renderReportReceipt(r);
      }).join("");
    }).catch(function () {
      // 读不到举报记录不该影响「我的」页其他部分：给一句轻提示，不报红
      reportsCard.classList.remove("hidden");
      reportsEl.innerHTML = '<p class="receipt-empty">暂时读不到举报记录，稍后再看看。</p>';
    });
  }

  /* 删除自己的帖子 */
  mineEl.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-del]") : null;
    if (!btn) return;

    if (!confirm("确定要删除这条分享吗？删掉就不能恢复了。")) return;

    var id = btn.getAttribute("data-del");
    btn.disabled = true;
    btn.textContent = "正在删除…";

    C.client().from("posts").select("id, image_path").eq("id", id).maybeSingle()
      .then(function (res) {
        var post = (res && res.data) || { id: id };
        return C.deletePost(post);
      })
      .then(function () {
        C.showNotice(noticeEl, "ok", "已删除");
        loadMyPosts();
        setTimeout(function () { C.hideNotice(noticeEl); }, 2500);
      })
      .catch(function (err) {
        C.showNotice(noticeEl, "error", err.message);
        btn.disabled = false;
        btn.textContent = "删除这条";
      });
  });

  /* ---------------------------------------------------------------
   * 修改昵称
   * --------------------------------------------------------------- */
  nickForm.addEventListener("submit", function (e) {
    e.preventDefault();
    C.hideNotice(noticeEl);

    var value = nickInput.value.trim();
    if (value.length > 20) {
      C.showNotice(noticeEl, "warn", "昵称最多 20 个字");
      return;
    }

    nickBtn.disabled = true;
    nickBtn.innerHTML = '<span class="spinner"></span>';

    C.saveNickname(value)
      .then(function (saved) {
        currentProfile = currentProfile || {};
        currentProfile.nickname = saved || null;
        C.showNotice(noticeEl, "ok", saved ? "昵称已更新为「" + saved + "」" : "已清空昵称");
        renderHero({ isAnonymous: currentIsAnon }, currentProfile);
      })
      .catch(function (err) {
        C.showNotice(noticeEl, "error", "保存失败：" + err.message);
      })
      .then(function () {
        nickBtn.disabled = false;
        nickBtn.textContent = "保存昵称";
      });
  });

  /* ---------------------------------------------------------------
   * 退出登录
   * --------------------------------------------------------------- */
  signOutBtn.addEventListener("click", function () {
    if (!confirm("确定要退出登录吗？")) return;
    C.signOut().then(function () {
      window.location.href = "index.html";
    });
  });

  boot();
})();
