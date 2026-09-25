/* =====================================================================
 *  内容广场逻辑：加载学生们的分享、点赞、下拉/按钮刷新
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var noticeEl = document.getElementById("notice");
  var feedEl = document.getElementById("feed");
  var refreshBtn = document.getElementById("refresh");
  var countEl = document.getElementById("feed-count");

  document.title = "同学们的分享 · " + C.SITE_NAME;
  C.markTabbar("feed");
  C.blockIfNotReady(noticeEl);

  var loading = false;

  function skeletonList() {
    var s = "";
    for (var i = 0; i < 3; i++) s += '<div class="skeleton skeleton-card"></div>';
    return s;
  }

  function load() {
    if (loading) return;
    loading = true;
    if (refreshBtn) refreshBtn.disabled = true;
    feedEl.innerHTML = skeletonList();

    C.listPosts(50).then(function (posts) {
      if (!posts.length) {
        if (countEl) countEl.textContent = "";
        feedEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">🌱</div>' +
            '<div class="empty-title">广场上还没有内容</div>' +
            '<div class="empty-text">每位同学的第一句话，都值得被看见。<br>不如从你开始？</div>' +
          "</div>" +
          '<a class="btn btn-primary btn-block mt-16" href="post.html">✏️ 我要分享</a>';
        return;
      }
      feedEl.innerHTML = posts.map(C.renderPostCard).join("");
      if (countEl) countEl.textContent = "共 " + posts.length + " 条分享";
    }).catch(function (err) {
      feedEl.innerHTML =
        '<div class="notice notice-error">加载失败：' + C.escapeHtml(err.message) + "</div>" +
        '<div class="text-center mt-16"><button class="btn btn-soft" id="retry">再试一次</button></div>';
      var retry = document.getElementById("retry");
      if (retry) retry.addEventListener("click", load);
    }).then(function () {
      loading = false;
      if (refreshBtn) refreshBtn.disabled = false;
    });
  }

  /* 点赞 */
  feedEl.addEventListener("click", function (e) {
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
      C.showNotice(noticeEl, "warn", err.message + "（可以先匿名进入或注册）");
      setTimeout(function () { C.hideNotice(noticeEl); }, 5000);
    }).then(function () {
      btn.disabled = false;
    });
  });

  if (refreshBtn) refreshBtn.addEventListener("click", load);

  if (!C.isReady()) {
    feedEl.innerHTML = C.setupCard();
    if (refreshBtn) refreshBtn.disabled = true;
  } else {
    load();
  }
})();
