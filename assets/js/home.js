/* =====================================================================
 *  主页逻辑：问候语、身份状态、最新动态预览
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var noticeEl = document.getElementById("notice");
  var identityEl = document.getElementById("identity-line");
  var latestEl = document.getElementById("latest");

  /* 问候语 + 站点名 */
  var greet = document.getElementById("greeting");
  if (greet) greet.textContent = C.greeting() + "，欢迎回到校园";

  var siteName = document.getElementById("site-name");
  if (siteName) siteName.textContent = C.SITE_NAME;
  document.title = C.SITE_NAME + " · 分享今天的日常";

  var slogan = document.getElementById("site-slogan");
  if (slogan && window.CAMPUS_CONFIG && window.CAMPUS_CONFIG.SITE_SLOGAN) {
    slogan.textContent = window.CAMPUS_CONFIG.SITE_SLOGAN;
  }

  C.markTabbar("home");
  C.blockIfNotReady(noticeEl);

  /* ---------------------------------------------------------------
   * 身份提示
   * --------------------------------------------------------------- */
  function renderIdentity() {
    if (!C.isReady()) {
      identityEl.innerHTML = '<a href="login.html">先去设置</a>';
      return;
    }
    C.getIdentity().then(function (id) {
      if (!id.user) {
        identityEl.innerHTML = '还没登录 · <a href="login.html">登录 / 匿名进入</a>';
        return;
      }
      if (id.isAnonymous) {
        identityEl.innerHTML = '当前身份：<strong>匿名访客</strong> · <a href="login.html">注册账号</a>';
        return;
      }
      C.getProfile().then(function (p) {
        var label = (p && p.nickname) ? p.nickname : C.maskPhone(p && p.phone);
        var school = (p && p.school) ? " · " + C.escapeHtml(p.school) : "";
        identityEl.innerHTML = "你好，" + C.escapeHtml(label) + school;
      });
    });
  }

  /* ---------------------------------------------------------------
   * 最新动态预览（最多 3 条）
   * --------------------------------------------------------------- */
  function renderLatest() {
    if (!C.isReady()) {
      latestEl.innerHTML = C.setupCard();
      return;
    }
    C.listPosts(3).then(function (posts) {
      if (!posts.length) {
        latestEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">🍃</div>' +
            '<div class="empty-title">这里还很安静</div>' +
            '<div class="empty-text">成为第一个分享的人吧，<br>一句话、一张照片，都很好。</div>' +
          "</div>" +
          '<a class="btn btn-primary btn-block mt-16" href="post.html">✏️ 写下第一条</a>';
        return;
      }
      latestEl.innerHTML = posts.map(C.renderPostCard).join("") +
        '<a class="btn btn-ghost btn-block" href="feed.html">去看看更多同学的分享 →</a>';
      bindLikes(latestEl);
    }).catch(function (err) {
      latestEl.innerHTML =
        '<div class="notice notice-error">加载失败：' + C.escapeHtml(err.message) + "</div>";
    });
  }

  /* 点赞（预览区同样可点） */
  function bindLikes(root) {
    root.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-like]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-like");
      var liked = btn.classList.contains("liked");
      var countEl = btn.lastElementChild;
      btn.disabled = true;

      C.toggleLike(id, liked).then(function (nowLiked) {
        btn.classList.toggle("liked", nowLiked);
        btn.firstElementChild.textContent = nowLiked ? "🧡" : "🤍";
        countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) + (nowLiked ? 1 : -1));
      }).catch(function (err) {
        C.showNotice(noticeEl, "warn", err.message + "（可以先登录或匿名进入）");
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  renderIdentity();
  renderLatest();
})();
