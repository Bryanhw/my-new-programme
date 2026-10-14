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
  var myPostSeq  = 0;      // 每次刷新自增：晚到的计数不许回填到新的一轮里
  var mineTouched = false; // 这批卡片用户已经动过（删过 / 展开过评论）：不再整体重画

  var reportsCard = document.getElementById("reports-card");
  var reportsEl   = document.getElementById("reports-list");

  /* F2：三格（我的发布 / 我的评论 / 我的收藏） */
  var mineTabs    = document.getElementById("mine-tabs");
  var countPosts  = document.getElementById("mine-count-posts");
  var countComments = document.getElementById("mine-count-comments");
  var countSaves  = document.getElementById("mine-count-saves");
  var panelPosts  = document.getElementById("mine-panel-posts");
  var panelComments = document.getElementById("mine-panel-comments");
  var panelSaves  = document.getElementById("mine-panel-saves");
  var commentsEl  = document.getElementById("mine-comments-list");
  var savesEl     = document.getElementById("mine-saves-list");

  var mineTab        = "posts";   // 当前在哪一格
  var commentsLoaded = false;     // 我的评论：第一次点开才去读（省一次请求）
  var savesLoaded    = false;     // 我的收藏：同上，收藏变了要重新读
  var savesDirty     = false;     // 期间收藏有变化（比如在别处点了 🔖）
  var lastMissing    = [];        // 上一次渲染时「读不到」的收藏 id（清掉按钮只认这些）

  var signOutBtn = document.getElementById("signout");
  var anonTip    = document.getElementById("anon-tip");

  var secCard    = document.getElementById("security-card");
  var secStatus  = document.getElementById("sec-status");
  var secForm    = document.getElementById("sec-form");
  var secQuestion = document.getElementById("sec-question");
  var secAnswer  = document.getElementById("sec-answer");
  var secSave    = document.getElementById("sec-save");
  var secEdit    = document.getElementById("sec-edit");

  var currentUser = null;
  var currentProfile = null;
  var currentIsAnon = false;
  var currentSecurityQuestion = null;

  /* 密保问题下拉：选项来自 app.js 的单一来源（id 与数据库 CHECK 对齐） */
  if (secQuestion && C.securityQuestions) {
    var secPh = document.createElement("option");
    secPh.value = "";
    secPh.textContent = "选一个问题";
    secQuestion.appendChild(secPh);

    var secQs = C.securityQuestions();
    for (var sq = 0; sq < secQs.length; sq++) {
      var secOpt = document.createElement("option");
      secOpt.value = secQs[sq].id;
      secOpt.textContent = secQs[sq].text;
      secQuestion.appendChild(secOpt);
    }
  }

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
      if (secCard) secCard.classList.add("hidden");
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
        if (secCard) secCard.classList.add("hidden");
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
      loadSecurity();

      // F2：收藏只存本机，数字立刻就能显示；地址里带 #saves / #comments 就直接停在那格
      paintCounts();
      setMineTab(tabFromHash());
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

  function paintMyPosts(posts) {
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
  }

  function loadMyPosts() {
    C.listMyPosts().then(function (posts) {
      var rows = posts || [];
      myPostSeq += 1;
      var mySeq = myPostSeq;
      mineTouched = false;

      statPosts.textContent = rows.length;
      if (countPosts) countPosts.textContent = rows.length ? String(rows.length) : "";

      var anonCount = 0;
      rows.forEach(function (p) { if (p.is_anonymous) anonCount++; });
      statLikes.textContent = anonCount;

      // 先画卡片，点赞数 / 评论数回来后再补一次（理由见 app.js 的 attachEngagement）。
      // 用户已经动过（删过一条 / 展开过评论）或期间又刷新过，就跳过重画。
      paintMyPosts(rows);
      if (!rows.length || !C.attachEngagement) return;
      C.attachEngagement(rows).then(function () {
        if (mySeq !== myPostSeq || mineTouched) return;
        paintMyPosts(rows);
      });
    }).catch(function (err) {
      mineEl.innerHTML = '<div class="notice notice-error">加载失败：' + C.escapeHtml(err.message) + "</div>";
    });
  }

  /* ---------------------------------------------------------------
   * F2：三格：我的发布 / 我的评论 / 我的收藏
   *
   *  发布与评论来自服务器（前者走 my_posts 视图、后者走 post_comments 视图的 is_mine），
   *  收藏只存在本机 —— 所以收藏这一格不需要登录也能用，但页面上要说明它只在这台设备上。
   * --------------------------------------------------------------- */

  /** 空态块：三格共用一套写法（图标 + 一句 + 一个出路） */
  function emptyBlock(icon, title, text, ctaHtml) {
    return '<div class="empty">' +
      '<div class="empty-icon">' + icon + "</div>" +
      '<div class="empty-title">' + title + "</div>" +
      '<div class="empty-text">' + text + "</div>" +
      "</div>" + (ctaHtml || "");
  }

  /** 数字挂在格子上（拿不到就留空，不印 0 —— 和卡片计数的道理一样） */
  function paintCounts() {
    if (!countSaves) return;
    var n = C.savedPostCount ? C.savedPostCount() : 0;
    countSaves.textContent = n ? String(n) : "";
    // 读屏听到的是一句完整的话，而不是一个光秃秃的数字
    if (countSaves.parentNode && countSaves.parentNode.setAttribute) {
      countSaves.parentNode.setAttribute("aria-label", "我的收藏" + (n ? "，" + n + " 条" : ""));
    }
  }

  function setMineTab(name) {
    var want = (name === "comments" || name === "saves") ? name : "posts";
    mineTab = want;

    var chips = (mineTabs && mineTabs.querySelectorAll) ? mineTabs.querySelectorAll("[data-mine-tab]") : [];
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute("data-mine-tab") === want;
      chips[i].className = "chip" + (on ? " chip-on" : "");
      chips[i].setAttribute("aria-selected", on ? "true" : "false");
    }

    if (panelPosts)    panelPosts.hidden    = (want !== "posts");
    if (panelComments) panelComments.hidden = (want !== "comments");
    if (panelSaves)    panelSaves.hidden    = (want !== "saves");

    if (want === "comments" && !commentsLoaded) loadMyComments();
    if (want === "saves" && (!savesLoaded || savesDirty)) loadMySaves();

    // 顺手把地址记下来：刷新之后还停在这一格（分享链接 profile.html#saves 也认）
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", want === "posts" ? "#" : "#" + want);
      }
    } catch (e) {}
  }

  /** 地址栏里的 #saves / #comments（只在进入页面时读一次） */
  function tabFromHash() {
    var raw = "";
    try { raw = String((window.location && window.location.hash) || ""); } catch (e) { raw = ""; }
    raw = raw.replace(/^#/, "").toLowerCase();
    return (raw === "saves" || raw === "comments") ? raw : "posts";
  }

  /** 我的评论：读公开视图 post_comments，服务端按 auth.uid() 标出 is_mine */
  function loadMyComments() {
    commentsEl.innerHTML = '<p class="text-sm on-gold mb-16">正在读取…</p>';
    C.listMyComments().then(function (rows) {
      commentsLoaded = true;
      if (countComments) countComments.textContent = rows.length ? String(rows.length) : "";
      if (!rows.length) {
        commentsEl.innerHTML = emptyBlock("💬", "还没有评论过",
          "在广场里点开一条分享下面的「💬」，就能在下面说两句。",
          '<a class="btn btn-primary btn-block mt-16" href="feed.html">去广场看看</a>');
        return;
      }
      commentsEl.innerHTML = rows.map(renderMyComment).join("");
    }).catch(function () {
      // 评论迁移还没跑、或这个库还没有评论区：给一句人话，不报红
      commentsEl.innerHTML = '<p class="receipt-empty">' +
        "暂时读不到你的评论（这个站点可能还没开启评论区）。" +
        "</p>";
    });
  }

  function renderMyComment(c) {
    // 署名走 app.js 的统一口径：匿名评论一律「匿名同学」（评论没有洞号）
    var parts = [C.escapeHtml(C.commentAuthorName(c)), C.escapeHtml(C.timeAgo(c.created_at))];
    if (c.school) parts.splice(1, 0, C.escapeHtml(c.school));
    return '<div class="my-comment">' +
      '<div class="my-comment-top">' +
        parts.map(function (t) { return "<span>" + t + "</span>"; }).join("<span>·</span>") +
        '<a class="my-comment-go" href="feed.html?post=' + encodeURIComponent(String(c.post_id)) +
          '">去看这条 →</a>' +
      "</div>" +
      '<div class="my-comment-text">' + C.escapeHtml(c.content) + "</div>" +
      "</div>";
  }

  /** 我的收藏：本地只有 id，内容按 id 回读 —— 读不到的就是删了 / 没过审 */
  function loadMySaves() {
    var ids = C.savedPostIds ? C.savedPostIds() : [];
    paintCounts();
    savesLoaded = true;
    savesDirty = false;

    if (!ids.length) {
      savesEl.innerHTML = emptyBlock("🔖", "还没有收藏",
        "卡片右下角的 🔖 点一下，那条就会存到这台设备上，方便以后回来找。",
        '<a class="btn btn-primary btn-block mt-16" href="feed.html">去广场看看</a>');
      return;
    }

    savesEl.innerHTML = '<p class="text-sm on-gold mb-16">正在读取…</p>';
    C.listPostsByIds(ids).then(function (posts) {
      var byId = {};
      (posts || []).forEach(function (p) { byId[p.id] = p; });
      // 按「收藏的先后」显示（新存的在最前），而不是服务器返回的顺序
      var ordered = ids.map(function (id) { return byId[id]; }).filter(Boolean);
      var missing = ids.filter(function (id) { return !byId[id]; });

      paintSaves(ordered, missing);

      if (!ordered.length || !C.attachEngagement) return;
      C.attachEngagement(ordered).then(function () {
        if (mineTab !== "saves") return;      // 人已经走开了就别再动 DOM
        paintSaves(ordered, missing);
      });
    }).catch(function (err) {
      savesEl.innerHTML = '<div class="notice notice-error">加载失败：' +
        C.escapeHtml(err.message) + "</div>";
    });
  }

  function paintSaves(posts, missing) {
    var html = "";
    lastMissing = missing.slice();     // 记住是哪几条读不到，供「清掉」按钮用

    // 读不到的那几条：明说，不假装还在；也给一个一键清掉的口子
    if (missing.length) {
      html += '<div class="saves-missing">' +
        "有 <b>" + missing.length + "</b> 条收藏现在看不到了 —— 多半是作者删掉了、或者没过审核。" +
        "<br>" +
        '<button class="link-plain" type="button" data-drop-saves="1">' +
        "把这些看不见的清掉</button>" +
        "</div>";
    }

    html += posts.map(function (p) { return C.renderPostCard(p); }).join("");

    if (!posts.length && missing.length) {
      html += '<p class="receipt-empty">收藏里剩下的都还在，只是暂时读不到那 ' +
        missing.length + " 条。</p>";
    }

    savesEl.innerHTML = html;
  }

  /** 收藏变了（在任何地方点了 🔖）就跟着刷新数字；正停在收藏格就顺手重画 */
  if (C.onSavedChange) {
    C.onSavedChange(function () {
      savesDirty = true;
      paintCounts();
      if (mineTab === "saves") loadMySaves();
    });
  }

  if (mineTabs) {
    mineTabs.addEventListener("click", function (e) {
      var btn = (e.target && e.target.closest) ? e.target.closest("[data-mine-tab]") : null;
      if (btn) setMineTab(btn.getAttribute("data-mine-tab"));
    });
  }

  // 「把这些看不见的清掉」：只清读不到的那几条，别的收藏一条都不能动
  if (savesEl) {
    savesEl.addEventListener("click", function (e) {
      var btn = (e.target && e.target.closest) ? e.target.closest("[data-drop-saves]") : null;
      if (!btn) return;
      if (!lastMissing.length) return;
      C.hideNotice(noticeEl);
      C.dropSavedPosts(lastMissing);      // 变化会经由 onSavedChange 触发本格重画
      C.showNotice(noticeEl, "ok", "已清掉 " + lastMissing.length + " 条看不见的收藏");
      setTimeout(function () { C.hideNotice(noticeEl); }, 2500);
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

  /* ---------------------------------------------------------------
   * 密保问题：忘密码后唯一能自助找回的东西，所以在这里给个显眼的入口
   * --------------------------------------------------------------- */
  function loadSecurity() {
    if (!secCard) return;
    secCard.classList.remove("hidden");

    if (currentIsAnon) {
      // 匿名访客没有密码，也就没有「忘记密码」这回事
      secStatus.textContent =
        "你是匿名访客，没有密码 —— 所以换个设备就找不回这些内容了。" +
        "注册一个账号（注册时会让你选一个密保问题），以后忘了密码还能自己重设。";
      secForm.classList.add("hidden");
      secEdit.classList.add("hidden");
      return;
    }

    secForm.classList.add("hidden");
    secEdit.classList.add("hidden");
    secStatus.textContent = "正在读取…";

    C.getSecurityQuestion().then(function (row) {
      currentSecurityQuestion = (row && row.question_id) || null;
      if (currentSecurityQuestion) {
        secStatus.textContent = "已经设置的密保问题：" +
          (C.securityQuestionText(currentSecurityQuestion) || currentSecurityQuestion);
        secEdit.textContent = "换一个问题 / 改答案";
      } else {
        secStatus.textContent =
          "还没有设置密保问题 —— 现在忘了密码就真的找不回来了，建议花 10 秒设一个。";
        secEdit.textContent = "设置密保";
      }
      secEdit.classList.remove("hidden");
    });
  }

  /* 删除自己的帖子 */
  mineEl.addEventListener("click", function (e) {
    // 用户动过这批卡片了：计数回来时不再整体重画（免得刚点开的评论被收回去）
    mineTouched = true;
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
        var name = (saved && saved.name) ? saved.name : "";
        currentProfile = currentProfile || {};
        currentProfile.nickname = name || null;

        var msg = name ? "昵称已更新为「" + name + "」" : "已清空昵称";
        if (saved && typeof saved.synced === "number" && saved.synced > 0) {
          msg += "，历史署名也同步了 " + saved.synced + " 条";
        }
        C.showNotice(noticeEl, "ok", msg);
        renderHero({ isAnonymous: currentIsAnon }, currentProfile);
        loadMyPosts();   // 历史帖子换上了新署名，刷新「我的发布」
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
   * 密保：打开表单 / 保存
   * --------------------------------------------------------------- */
  if (secEdit) {
    secEdit.addEventListener("click", function () {
      C.hideNotice(noticeEl);
      secForm.classList.remove("hidden");
      secEdit.classList.add("hidden");
      // 已经设过的就把问题选上，用户只需要重新填答案（答案读不回来）
      if (secQuestion && !secQuestion.value && currentSecurityQuestion) {
        secQuestion.value = currentSecurityQuestion;
      }
      secAnswer.value = "";
      (secQuestion && secQuestion.value ? secAnswer : secQuestion || secAnswer).focus();
    });
  }

  if (secSave) {
    secSave.addEventListener("click", function () {
      C.hideNotice(noticeEl);

      var q = secQuestion ? secQuestion.value : "";
      var a = secAnswer ? secAnswer.value : "";

      if (!q) {
        C.showNotice(noticeEl, "warn", "先选一个密保问题");
        if (secQuestion) secQuestion.focus();
        return;
      }
      if (!a.replace(/\s/g, "")) {
        C.showNotice(noticeEl, "warn", "填一下密保答案");
        secAnswer.focus();
        return;
      }

      secSave.disabled = true;
      secSave.innerHTML = '<span class="spinner"></span>';

      C.saveSecurityAnswer(q, a).then(function () {
        secAnswer.value = "";
        C.showNotice(noticeEl, "ok", "密保已保存。以后忘了密码，就用这个答案重设一个新密码。");
        loadSecurity();
      }).catch(function (err) {
        C.showNotice(noticeEl, "error",
          "密保没存上：" + ((err && err.message) || "请稍后重试"));
        secForm.classList.remove("hidden");
        secEdit.classList.add("hidden");
      }).then(function () {
        secSave.disabled = false;
        secSave.textContent = "保存密保";
      });
    });
  }

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
