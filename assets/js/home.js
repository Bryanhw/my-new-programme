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
   * 城市圈（B5）：选一个片区 + 看本圈热词
   *
   * 圈子只改「看的顺序」：内容仍是全站的，本圈排前面。
   *    - 选完当场生效（记在本机），下面的「最新分享」立刻换成本圈优先；
   *    - 热词只挑本圈、近 14 天、至少两个人提到的词；不排名、不计数；
   *    - 没加载 circles.js 的页面（或没圈子可选）整块不显示，别的照旧。
   * --------------------------------------------------------------- */
  var circleSection = document.getElementById("circle-section");
  var circleSelect = document.getElementById("circle-select");
  var circleHot = document.getElementById("circle-hot");
  var circleSuggest = document.getElementById("circle-suggest");
  var circleMore = document.getElementById("circle-more");

  function currentCircle() { return C.getCircle(); }

  function renderCirclePicker() {
    var circles = C.listCircles();
    if (!circleSection || !circleSelect || !circles.length) return false;

    var html = '<option value="">不限（看全部）</option>';
    for (var i = 0; i < circles.length; i++) {
      html += '<option value="' + C.escapeHtml(circles[i].id) + '">' +
        C.escapeHtml(circles[i].emoji + " " + circles[i].name) + "</option>";
    }
    circleSelect.innerHTML = html;
    circleSelect.value = currentCircle();
    circleSection.hidden = false;

    /* 没选过圈时，看看注册资料里的学校能不能认出圈 —— 只做建议，不替用户选 */
    if (!currentCircle()) {
      C.myCircle().then(function (id) {
        if (!id || currentCircle()) return;
        var name = C.circleName(id);
        if (!name) return;
        circleSuggest.hidden = false;
        circleSuggest.innerHTML = "你的学校看起来在 <strong>" + C.escapeHtml(name) +
          "</strong> —— <button class=\"link-plain\" type=\"button\" id=\"circle-take\">就选它</button>";
        var take = document.getElementById("circle-take");
        if (take) take.addEventListener("click", function () { applyCircle(id); });
      });
    }
    return true;
  }

  function applyCircle(id) {
    C.setCircle(id);
    if (circleSelect) circleSelect.value = currentCircle();
    if (circleSuggest) circleSuggest.hidden = true;
    renderCircleHot();
    renderLatest();
  }

  /* 热词 chips：点一下带着这个词去广场（广场只筛已加载的分享，那边会写明） */
  function renderCircleHot() {
    if (!circleHot) return;
    var id = currentCircle();
    if (!id) { circleHot.hidden = true; circleHot.innerHTML = ""; return; }

    circleHot.hidden = false;
    circleHot.innerHTML = '<p class="text-sm text-muted circle-hot-title">' +
      C.escapeHtml(C.circleName(id)) + "的同学最近提到：</p>" +
      '<div class="chips" id="circle-chips"><span class="text-sm text-muted">正在看……</span></div>';

    C.listCircleHotwords(id).then(function (words) {
      var box = document.getElementById("circle-chips");
      if (!box) return;
      if (!words || !words.length) {
        // 冷启动本来就该这样：人还少的时候，没有词比硬凑一个词更诚实
        box.innerHTML = '<span class="text-sm text-muted">还没有哪个词被两位以上同学提到 —— 再等等，或者你先说一句。</span>';
        return;
      }
      var html = "";
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        html += '<a class="chip" href="feed.html?circle=' + encodeURIComponent(id) +
          "&q=" + encodeURIComponent(w) + '">' + C.escapeHtml(w) + "</a>";
      }
      box.innerHTML = html;
    });
  }

  if (circleSelect) {
    circleSelect.addEventListener("change", function () { applyCircle(circleSelect.value); });
  }
  if (circleMore) circleMore.href = "feed.html";

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
        identityEl.innerHTML = '还没登录';
        return;
      }
      if (id.isAnonymous) {
        identityEl.innerHTML = '当前身份：<strong>匿名访客</strong>';
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
   * 最新动态预览（最多 3 条；选了圈子就本圈优先）
   * --------------------------------------------------------------- */
  var latestSeq = 0;         // 每次刷新自增：晚到的计数不许回填到新的一轮里
  var latestTouched = false; // 这批卡片用户已经动过：不再整体重画

  function paintLatest(posts) {
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
  }

  function renderLatest() {
    if (!C.isReady()) {
      latestEl.innerHTML = C.setupCard();
      return;
    }
    var mySeq = ++latestSeq;
    latestTouched = false;
    var circleId = currentCircle();
    var load = (circleId && C.listFeedPosts)
      ? C.listFeedPosts({ limit: 3, circleId: circleId })
      : C.listPosts(3);

    // 先画卡片，点赞数 / 评论数回来后再补一次（理由见 app.js 的 attachEngagement）：
    // 首页只是三张预览，更不该为了两个数字一直空着。
    // 用户已经动过这批卡片、或期间又刷新过，就跳过重画。
    load.then(function (posts) {
      if (mySeq !== latestSeq) return;
      var rows = posts || [];
      paintLatest(rows);
      if (!rows.length || !C.attachEngagement) return;
      C.attachEngagement(rows).then(function () {
        if (mySeq !== latestSeq || latestTouched) return;
        paintLatest(rows);
      });
    }).catch(function (err) {
      if (mySeq !== latestSeq) return;
      latestEl.innerHTML =
        '<div class="notice notice-error">加载失败：' + C.escapeHtml(err.message) + "</div>";
    });
  }

  /* 点赞（预览区同样可点） */
  function bindLikes(root) {
    root.addEventListener("click", function (e) {
      // 用户动过预览区了（点赞 / 展开评论 / 看图）：计数回来时不再整体重画
      latestTouched = true;
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
  // 点赞的监听只挂一次（卡片会整块重画，挂在容器上才不会被重画弄丢，
  // 也避免每重画一次就多叠一个监听 → 点一下加两次赞）
  bindLikes(latestEl);
  renderLatest();
  if (renderCirclePicker()) renderCircleHot();
})();
