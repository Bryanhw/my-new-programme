/* 校园拾光 · 分享详情页
 *
 * 一条分享的永久地址：detail.html?id=<uuid>
 *
 * 这里只做「取一条、画一张卡片、把评论区展开」三件事 —— 卡片本身用广场那套
 * renderPostCard，评论 / 举报 / 看原图 / 收藏 / 复制链接都交给 app.js 的全局委托，
 * 所以详情页和广场看到的是同一张卡片，不会各写一份、慢慢走样。
 *
 * 点赞与抱抱不在全局委托里（它们要就地改计数），这里补上。
 */
(function () {
  "use strict";

  var C = window.Campus;
  if (!C) return;

  var detailEl = document.getElementById("detail");
  var noticeEl = document.getElementById("notice");
  var stateEl = document.getElementById("detail-state");
  var titleEl = document.getElementById("detail-title");
  var timers = [];

  C.markTabbar("feed");
  document.title = "分享详情 · " + (C.SITE_NAME || "校园拾光");

  /* 后端还没配置好：先按 app.js 的统一口径说清楚差什么，
     不要让读者以为「这条分享被删了」。 */
  var blocked = false;
  if (C.blockIfNotReady) blocked = C.blockIfNotReady(noticeEl);

  function later(fn, ms) {
    var t = setTimeout(fn, ms);
    timers.push(t);
    return t;
  }

  function param(name) {
    var q = String(window.location.search || "");
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(q);
    return m ? decodeURIComponent(String(m[1]).replace(/\+/g, " ")) : "";
  }

  function warn(text) {
    if (C.showNotice) C.showNotice(noticeEl, "warn", text);
    later(function () {
      if (C.hideNotice) C.hideNotice(noticeEl);
    }, 6000);
  }

  function clip(text, max) {
    var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.length > max ? s.slice(0, max) + "…" : s;
  }

  function setMeta(selector, value) {
    var el = document.querySelector(selector);
    if (el) el.setAttribute("content", value);
  }

  /* 打开后把通用的分享卡片文案换成这一条的真实内容。
     爬虫按协议不会执行 JS，所以抓到的仍是页面里那份通用文案 —— 这是静态站能做到的上限。 */
  function applyMeta(post) {
    var name = post.is_anonymous ? "一位同学" : (post.display_name || "一位同学");
    var text = clip(post.content, 60) || (post.image_path ? "分享了一张图片" : "一条分享");
    var title = name + "：" + text;

    document.title = title + " · 校园拾光";
    if (titleEl) titleEl.textContent = title;
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', clip(post.content, 120) || "看看这条分享。");

    var img = C.imageUrl(post.image_path);
    if (img) setMeta('meta[property="og:image"]', img);
  }

  function state(text) {
    detailEl.setAttribute("aria-busy", "false");
    detailEl.innerHTML = "";
    stateEl.hidden = false;
    stateEl.textContent = text;
  }

  /* 评论是详情页的主角：卡片画好就把评论区展开，不用再点一下「💬」。
     直接调 app.js 导出的 toggleCommentZone —— 它自己会找 zone、自己判断开合，
     不依赖点击冒泡，也不要求这一页重复实现评论区的状态机。 */
  function openComments(postId) {
    if (C.toggleCommentZone) C.toggleCommentZone(postId);
  }

  function load() {
    if (blocked) {
      detailEl.setAttribute("aria-busy", "false");
      stateEl.hidden = true;
      return;
    }

    var id = param("id");
    if (!id) {
      state("这个地址里没有分享编号，回广场挑一条吧。");
      return;
    }

    C.getPostById(id).then(function (post) {
      if (!post) {
        state("这条分享可能已经被删除了，或者还没有通过审核。");
        return;
      }
      stateEl.hidden = true;
      detailEl.innerHTML = C.renderPostCard(post);
      detailEl.setAttribute("aria-busy", "false");
      applyMeta(post);

      C.attachEngagement([post]).then(function () {
        C.fillCountsInDom([post]);
        openComments(post.id);
      });
    }).catch(function (err) {
      state("打不开这条分享：" + (err && err.message ? err.message : "请稍后再试"));
    });
  }

  /* 点赞与抱抱：与广场同一套乐观更新，失败就把话说清楚 */
  detailEl.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var hug = t.closest("[data-hug]");
    if (hug) {
      var hugNum = hug.querySelector(".hug-count");
      var hugged = hug.classList.contains("hugged");
      hug.disabled = true;
      C.toggleHug(hug.getAttribute("data-hug"), hugged).then(function (nowHugged) {
        hug.classList.toggle("hugged", nowHugged);
        hug.firstElementChild.textContent = nowHugged ? "💞" : "🤗";
        hug.setAttribute("aria-pressed", nowHugged ? "true" : "false");
        var n = parseInt(hugNum.textContent, 10);
        hugNum.textContent = Math.max(0, (isNaN(n) ? 0 : n) + (nowHugged ? 1 : -1));
      }).catch(function (err) {
        warn(err.message);
      }).then(function () {
        hug.disabled = false;
      });
      return;
    }

    var like = t.closest("[data-like]");
    if (!like) return;

    var countEl = like.lastElementChild;
    var liked = like.classList.contains("liked");
    like.disabled = true;
    C.toggleLike(like.getAttribute("data-like"), liked).then(function (nowLiked) {
      like.classList.toggle("liked", nowLiked);
      like.firstElementChild.textContent = nowLiked ? "🧡" : "🤍";
      var n2 = parseInt(countEl.textContent, 10);
      countEl.textContent = Math.max(0, (isNaN(n2) ? 0 : n2) + (nowLiked ? 1 : -1));
    }).catch(function (err) {
      warn(err.message + "（可以先匿名进入或注册）");
    }).then(function () {
      like.disabled = false;
    });
  });

  load();
})();
