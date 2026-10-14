/* =====================================================================
 *  内容广场逻辑：加载学生们的分享、点赞、下拉/按钮刷新
 *
 *  B5 加了三件事，都不改「仍是一个广场」这件事：
 *    1. 城市圈：选了圈 → 本圈排前面（内容一条不少）/ 勾「只看本圈」才是过滤；
 *    2. 圈内热词：本圈近 14 天被至少两位同学提到的词，点一下筛帖；
 *    3. 一词筛帖：**纯前端**筛选当前已加载的那批 —— 界面上如实写明这一点，
 *       不能让人以为搜了全站。
 * ===================================================================== */
(function () {
  "use strict";

  var C = window.Campus;
  var noticeEl = document.getElementById("notice");
  var feedEl = document.getElementById("feed");
  var refreshBtn = document.getElementById("refresh");
  var countEl = document.getElementById("feed-count");
  var barEl = document.getElementById("circle-bar");
  var selectEl = document.getElementById("circle-select");
  var onlyEl = document.getElementById("circle-only");
  var noteEl = document.getElementById("circle-note");
  var hotEl = document.getElementById("circle-hot");
  var filterEl = document.getElementById("feed-filter");
  var topicBarEl = document.getElementById("topic-bar");
  var topicChipsEl = document.getElementById("topic-chips");
  var topicNoteEl = document.getElementById("topic-note");

  document.title = "同学们的分享 · " + C.SITE_NAME;
  C.markTabbar("feed");
  C.blockIfNotReady(noticeEl);

  var loading = false;
  var loaded = [];     // 已经拿到的那批（筛词只在这批里找）
  var keyword = "";    // 当前筛的词（空 = 不筛）
  var topic = "";      // 当前筛的话题（空 = 全部；不带话题的分享也在「全部」里）
  var seq = 0;         // 每次 load 自增：晚到的计数不许回填到新的一轮里
  var touched = false; // 这批卡片用户已经动过（点赞/展开评论）：不再整体重画

  /* 地址栏带来的圈子、词与「分享过来的那一条」：首页的热词 chips 和
     卡片上的「复制链接」就是这么跳过来的 */
  var params = (function () {
    var out = { circle: "", q: "", post: "", topic: "" };
    var qs = String(window.location.search || "").replace(/^\?/, "");
    var pairs = qs ? qs.split("&") : [];
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split("=");
      var k = decodeURIComponent(kv[0] || "");
      if (k !== "circle" && k !== "q" && k !== "post" && k !== "topic") continue;
      var v = "";
      try { v = decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); } catch (e) { v = ""; }
      out[k] = v;
    }
    return out;
  })();

  if (params.circle && C.listCircles().length) C.setCircle(params.circle);
  keyword = params.q || "";
  topic = params.topic || "";

  /* F1/B4：分享直链 feed.html?post=<id> —— 打开后滚到那条并高亮。
     站点没有帖子详情页（post.html 是发布页），所以这里只做「至少高亮」这件事：
     给那条卡片多戴一个 class，滚过去，并说清它是被人分享进来的。 */
  var targetId = params.post || "";
  var targetScrolled = false;

  /** 给分享进来的那条卡片多戴一个 class（高亮交给 CSS） */
  function markTarget(html) {
    return html.indexOf('<article class="card post"') === 0
      ? html.replace('<article class="card post"', '<article class="card post post-target"')
      : html;
  }

  /** 提示 + 滚动。找不到时如实说明原因，不假装高亮过了。 */
  function noteTarget(found) {
    if (found) {
      C.showNotice(noticeEl, "info", "这条是同学分享给你的，已经高亮。");
    } else {
      C.showNotice(noticeEl, "info",
        "分享链接里的那条现在看不到了 —— 可能已经下架，或者还没通过审核。");
    }
    if (targetScrolled) return;
    var el = feedEl.querySelector ? feedEl.querySelector(".post-target") : null;
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "center" });
      targetScrolled = true;
    }
  }

  function circleId() { return C.getCircle(); }
  function onlyCircle() { return !!(onlyEl && onlyEl.checked); }

  /** 分享链接那条不在这批里（更早、或被圈子挡住）时：按 id 单独问一次服务端，
   *  取到就补进这批的最前面，跟正常卡片一起画 —— 这样高亮、滚动、计数都走同一条路。
   *  取不到就是真的看不到（下架 / 没通过审核），由 noteTarget 如实说，不再两头猜。 */
  function ensureTargetLoaded() {
    if (!targetId) return Promise.resolve();
    var i;
    for (i = 0; i < loaded.length; i++) {
      if (loaded[i] && loaded[i].id === targetId) return Promise.resolve();
    }
    if (!C.getPostById) return Promise.resolve();
    return C.getPostById(targetId).then(function (post) {
      if (post) loaded = [post].concat(loaded);
    }).catch(function () {});
  }

  /* ---------------------------------------------------------------
   * 话题标签（C3）：按话题筛当前这批；**不带话题的分享仍在「全部」里**
   *   筛选条只在「这批里真的有人打过标签」时才出现，免得点进去是一条空流。
   * --------------------------------------------------------------- */
  function topicOf(post) { return C.normalizeTopics(post && post.topics); }

  function filterByTopic(posts) {
    if (!topic) return posts;
    return posts.filter(function (p) { return topicOf(p).indexOf(topic) >= 0; });
  }

  /** 这批里出现过的话题（按约定顺序）+ 当前选中的那个（外部链接带来的也算） */
  function topicsInBatch() {
    var out = [];
    var all = C.TOPICS || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] === topic) { out.push(all[i]); continue; }
      for (var j = 0; j < loaded.length; j++) {
        if (topicOf(loaded[j]).indexOf(all[i]) >= 0) { out.push(all[i]); break; }
      }
    }
    if (topic && out.indexOf(topic) < 0) out.unshift(topic);
    return out;
  }

  function renderTopics() {
    if (!topicBarEl || !topicChipsEl) return;
    var list = topicsInBatch();
    if (!list.length) {
      topicBarEl.hidden = true;
      topicChipsEl.innerHTML = "";
      if (topicNoteEl) topicNoteEl.hidden = true;
      return;
    }
    var html = '<button class="chip' + (topic ? "" : " chip-on") +
      '" type="button" data-topic-pick="">全部</button>';
    for (var i = 0; i < list.length; i++) {
      html += '<button class="chip' + (list[i] === topic ? " chip-on" : "") +
        '" type="button" data-topic-pick="' + C.escapeHtml(list[i]) + '">#' +
        C.escapeHtml(list[i]) + "</button>";
    }
    topicChipsEl.innerHTML = html;
    topicBarEl.hidden = false;
    if (topicNoteEl) {
      if (topic) {
        topicNoteEl.hidden = false;
        topicNoteEl.textContent = "正在看「#" + topic + "」：在已加载的 " + loaded.length +
          " 条里找到 " + filterByTopic(loaded).length + " 条 —— 没打话题的分享在「全部」里。";
      } else {
        topicNoteEl.hidden = true;
        topicNoteEl.textContent = "";
      }
    }
  }

  /** 当前地址（去掉来源与主机）：只有 path + query + hash 三截，够用来拼新地址 */
  function nowUrl() {
    var loc = window.location || {};
    return String(loc.pathname || "") + String(loc.search || "") + String(loc.hash || "");
  }

  /** 「换成话题 next 之后地址栏该长什么样」：其余参数（圈子、词、分享进来的那条）
      原样留着，只重写 topic 这一项；next 为空就把这一项摘掉。 */
  function topicUrl(next) {
    var href = nowUrl();
    var hash = "";
    var cut = href.indexOf("#");
    if (cut >= 0) { hash = href.slice(cut); href = href.slice(0, cut); }
    cut = href.indexOf("?");
    var path = cut >= 0 ? href.slice(0, cut) : href;
    var pairs = cut >= 0 ? href.slice(cut + 1).split("&") : [];
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var k = "";
      try { k = decodeURIComponent(pairs[i].split("=")[0] || ""); } catch (e) { k = ""; }
      if (!k || k === "topic") continue;
      out.push(pairs[i]);
    }
    if (next) out.push("topic=" + encodeURIComponent(next));
    return path + (out.length ? "?" + out.join("&") : "") + hash;
  }

  /** 切话题时把地址栏同步上：这条链能分享出去，刷新 / 收藏后还筛着同一个话题。
      用 replaceState 而不是 pushState —— 返回键该用来离开这一页，不该被
      「点过几个话题」一层层拦住。改不动地址栏时（file:// 直接打开、或被嵌在
      别的页面里）安静跳过：筛选本身不能因为地址栏写不了就坏掉。 */
  function syncTopicUrl(next) {
    if (!window.history || !window.history.replaceState) return;
    var url = topicUrl(next);
    if (!url || url === nowUrl()) return;
    try { window.history.replaceState(null, "", url); } catch (e) {}
  }

  /** 切换话题：就地重画，不重新加载；地址栏跟着走（见 syncTopicUrl） */
  function setTopic(next) {
    topic = next || "";
    syncTopicUrl(topic);
    renderTopics();
    renderAll();
  }

  function skeletonList() {
    var s = "";
    for (var i = 0; i < 3; i++) s += '<div class="skeleton skeleton-card"></div>';
    return s;
  }

  /* ---------------------------------------------------------------
   * 圈子条：选圈 / 只看本圈 / 热词
   * --------------------------------------------------------------- */
  function renderBar() {
    if (!barEl || !selectEl) return;
    var circles = C.listCircles();
    if (!circles.length) { barEl.hidden = true; return; }

    var html = '<option value="">不限（看全部）</option>';
    for (var i = 0; i < circles.length; i++) {
      html += '<option value="' + C.escapeHtml(circles[i].id) + '">' +
        C.escapeHtml(circles[i].emoji + " " + circles[i].name) + "</option>";
    }
    selectEl.innerHTML = html;
    selectEl.value = circleId();
    barEl.hidden = false;
    renderNote();
    renderHot();
  }

  /** 把「现在这条流是怎么排的」讲清楚，避免「我的帖子去哪了」这种困惑 */
  function renderNote() {
    if (!noteEl) return;
    var id = circleId();
    if (!id) { noteEl.hidden = true; noteEl.textContent = ""; return; }
    noteEl.hidden = false;
    noteEl.textContent = onlyCircle()
      ? "只看「" + C.circleName(id) + "」：其他片区的内容暂时藏起来了。"
      : "已经是全站内容，只是把「" + C.circleName(id) + "」的分享排在了前面。";
  }

  function renderHot() {
    if (!hotEl) return;
    var id = circleId();
    if (!id) { hotEl.hidden = true; hotEl.innerHTML = ""; return; }

    hotEl.hidden = false;
    hotEl.innerHTML = '<span class="text-sm text-muted" id="hot-wait">正在看这个词……</span>';

    C.listCircleHotwords(id).then(function (words) {
      if (circleId() !== id || !hotEl) return;   // 期间换了圈：结果作废
      if (!words || !words.length) {
        hotEl.innerHTML = '<span class="text-sm text-muted">本圈还没有被两位以上同学提到的词。</span>';
        return;
      }
      var html = "";
      for (var i = 0; i < words.length; i++) {
        var on = words[i] === keyword ? " chip-on" : "";
        html += '<button class="chip' + on + '" type="button" data-term="' +
          C.escapeHtml(words[i]) + '">' + C.escapeHtml(words[i]) + "</button>";
      }
      hotEl.innerHTML = html;
    });
  }

  /* ---------------------------------------------------------------
   * 筛词条：说清楚筛的是什么范围
   * --------------------------------------------------------------- */
  function renderFilter() {
    if (!filterEl) return;
    if (!keyword) { filterEl.hidden = true; filterEl.innerHTML = ""; return; }
    var hit = C.filterPostsByTerm(loaded, keyword).length;
    filterEl.hidden = false;
    filterEl.innerHTML =
      '<div class="filter-bar">' +
        "<span>正在找提到「<strong>" + C.escapeHtml(keyword) + "</strong>」的分享：在已加载的 " +
        loaded.length + " 条里找到 " + hit + " 条</span>" +
        '<button class="link-plain" type="button" id="clear-term">清掉这个词</button>' +
      "</div>";
    var clear = document.getElementById("clear-term");
    if (clear) {
      clear.addEventListener("click", function () {
        keyword = "";
        renderAll();
      });
    }
  }

  /* ---------------------------------------------------------------
   * 列表
   * --------------------------------------------------------------- */
  function renderList(posts) {
    if (!posts.length) {
      if (countEl) countEl.textContent = "";
      if (keyword) {
        feedEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">🔍</div>' +
            '<div class="empty-title">已加载的分享里没有提到「' + C.escapeHtml(keyword) + "」的</div>" +
            '<div class="empty-text">这里只筛当前已经加载出来的那几条，' +
              "不是全站搜索 —— 清掉这个词就能看回全部。</div>" +
          "</div>";
        return;
      }
      if (topic) {
        feedEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">🏷</div>' +
            '<div class="empty-title">已加载的分享里还没有 #' + C.escapeHtml(topic) + "</div>" +
            '<div class="empty-text">这里只筛当前已经加载出来的那几条，不是全站搜索 —— ' +
              "看看「全部」就知道大家最近在聊什么。</div>" +
          "</div>" +
          '<button class="btn btn-soft btn-block mt-16" type="button" data-clear-topic>看看全部</button>';
        return;
      }
      if (onlyCircle() && circleId()) {
        feedEl.innerHTML =
          '<div class="empty">' +
            '<div class="empty-icon">🌱</div>' +
            '<div class="empty-title">「' + C.escapeHtml(C.circleName(circleId())) + "」还很安静</div>" +
            '<div class="empty-text">本圈暂时没有分享。你可以先发一条，' +
              "也可以先看看全站的内容。</div>" +
          "</div>" +
          '<button class="btn btn-primary btn-block mt-16" type="button" id="show-all">看看全站的内容</button>' +
          '<a class="btn btn-ghost btn-block" href="post.html">✏️ 我先发一条</a>';
        var all = document.getElementById("show-all");
        if (all) {
          all.addEventListener("click", function () {
            if (onlyEl) onlyEl.checked = false;
            load();
          });
        }
        return;
      }
      feedEl.innerHTML =
        '<div class="empty">' +
          '<div class="empty-icon">🌱</div>' +
          '<div class="empty-title">广场上还没有内容</div>' +
          '<div class="empty-text">每位同学的第一句话，都值得被看见。<br>不如从你开始？</div>' +
        "</div>" +
        '<a class="btn btn-primary btn-block mt-16" href="post.html">✏️ 我要分享</a>';
      return;
    }
    var hit = false;
    feedEl.innerHTML = posts.map(function (p) {
      var card = C.renderPostCard(p);
      if (!targetId || p.id !== targetId) return card;
      hit = true;
      return markTarget(card);
    }).join("");
    if (targetId) noteTarget(hit);
    if (countEl) {
      var id = circleId();
      countEl.textContent = "共 " + posts.length + " 条分享" +
        (topic ? "（#" + topic + "）" : "") +
        (id && !onlyCircle() ? "（" + C.circleName(id) + "的在前面）" : "");
    }
  }

  function renderAll() {
    renderFilter();
    renderList(filterByTopic(C.filterPostsByTerm(loaded, keyword)));
  }

  function load() {
    if (loading) return;
    loading = true;
    touched = false;
    var mySeq = ++seq;
    setRefreshLoading(true);
    feedEl.innerHTML = skeletonList();

    var id = circleId();
    var load$ = (id && C.listFeedPosts)
      ? C.listFeedPosts({ limit: 50, circleId: id, onlyCircle: onlyCircle() })
      : C.listPosts(50);

    // 第一步：只等帖子本身，先让卡片出现。
    load$.then(function (posts) {
      loaded = posts || [];
      // 分享直链：那条可能不在这批里 → 先补进来再画，省得先画一遍再插一条
      return ensureTargetLoaded();
    }).then(function () {
      renderBar();
      renderTopics();
      renderAll();

      // 第二步（不挡渲染）：点赞数 / 评论数回来后再补一次。
      //   体检实测：三个请求串行约 0.9 秒，帖子本身只占 ~0.25 秒 ——
      //   先画卡片能让内容早到三分之二的时间，数字晚半拍出现。
      //   用户已经动过这批卡片就跳过重画（免得把他刚点开的评论收起来）；
      //   期间又刷新过（seq 变了）也跳过，新的一轮会自己补。
      if (C.attachEngagement) {
        C.attachEngagement(loaded).then(function () {
          if (mySeq !== seq || touched) return;
          renderAll();
        });
      }
    }).catch(function (err) {
      feedEl.innerHTML =
        '<div class="notice notice-error">加载失败：' + C.escapeHtml(err.message) + "</div>" +
        '<div class="text-center mt-16"><button class="btn btn-soft" id="retry">再试一次</button></div>';
      var retry = document.getElementById("retry");
      if (retry) retry.addEventListener("click", load);
    }).then(function () {
      // 注意：这里只等「帖子」那一步 —— 统计请求还在路上不该让刷新按钮一直转圈
      loading = false;
      setRefreshLoading(false);
    });
  }

  /* 刷新按钮：加载中变成转圈的线性图标（CSS 里 .is-loading 驱动动画） */
  function setRefreshLoading(on) {
    if (!refreshBtn) return;
    refreshBtn.disabled = on;
    refreshBtn.classList.toggle("is-loading", on);
  }

  /* ---------------------------------------------------------------
   * 交互
   * --------------------------------------------------------------- */
  if (selectEl) {
    selectEl.addEventListener("change", function () {
      C.setCircle(selectEl.value);
      keyword = "";
      load();
    });
  }
  if (onlyEl) {
    onlyEl.addEventListener("change", function () {
      renderNote();
      load();
    });
  }
  if (hotEl) {
    hotEl.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-term]") : null;
      if (!btn) return;
      var term = btn.getAttribute("data-term") || "";
      keyword = (term === keyword) ? "" : term;   // 再点一下 = 取消
      renderFilter();
      renderList(C.filterPostsByTerm(loaded, keyword));
      renderHot();
    });
  }

  if (topicChipsEl) {
    topicChipsEl.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-topic-pick]") : null;
      if (!btn) return;
      setTopic(btn.getAttribute("data-topic-pick") || "");
    });
  }

  /* 点赞 */
  feedEl.addEventListener("click", function (e) {
    // 用户已经动过这批卡片（点赞 / 展开评论 / 看图）：计数回来时不要再整体重画，
    // 否则刚点开的评论会被收回去。点完这一下，数字留在原地就够了。
    touched = true;

    // 卡片上的 #话题：在广场里就地切换筛选，不重新加载页面（其它页面上它就是个
    // 普通链接，跳到 feed.html?topic=…）。切完地址栏也换成同一个样子，
    // 所以「就地切」和「点链接跳进来」最后停在同一个地址上。
    // 只接管普通的左键单击，中键 / Ctrl+点击该开新标签页就让它开。
    var tag = (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.target.closest)
      ? e.target.closest("[data-topic]") : null;
    if (tag && e.preventDefault) {
      e.preventDefault();
      setTopic(tag.getAttribute("data-topic") || "");
      return;
    }

    // 话题空态里的「看看全部」
    var clearTopic = e.target.closest ? e.target.closest("[data-clear-topic]") : null;
    if (clearTopic) {
      setTopic("");
      return;
    }

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
