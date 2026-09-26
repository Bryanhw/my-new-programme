/* =====================================================================
 *  校园拾光 · 共享模块
 *  ---------------------------------------------------------------------
 *  职责：
 *   1. 初始化 Supabase 客户端
 *   2. 维护「当前身份」（已注册 / 匿名 / 未登录）
 *   3. 提供发帖、取流、点赞、图片上传等数据操作
 *   4. 提供时间格式化、HTML 转义、底部导航等 UI 小工具
 *
 *  页面中通过 window.Campus.xxx 调用。
 * ===================================================================== */

window.Campus = (function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 0. 配置与环境
   * ------------------------------------------------------------------ */
  var cfg = window.CAMPUS_CONFIG || {};

  var EMAIL_DOMAIN = "@students.local"; // 手机号会被包装成伪邮箱，避免真实短信
  var PHONE_RE = /^1[3-9]\d{9}$/;       // 中国大陆手机号

  var SITE_NAME = cfg.SITE_NAME || "校园拾光";
  var BUCKET = cfg.BUCKET || "post-images";

  var client = null;
  var configError = null;

  (function initClient() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      configError = "尚未填写 Supabase 配置：请打开 assets/js/config.js，填入你的 Project URL 和 anon key。";
      return;
    }
    if (/your-project-ref|your-anon-public-key/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
      configError = "config.js 里还是示例值：请把 SUPABASE_URL 和 SUPABASE_ANON_KEY 换成你 Supabase 项目的真实配置。";
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      configError = "Supabase SDK 未加载成功：请确认 assets/vendor/supabase.js 文件存在且可访问。";
      return;
    }
    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    } catch (e) {
      configError = "创建 Supabase 客户端失败：" + (e && e.message ? e.message : String(e));
    }
  })();

  function isReady() { return client !== null; }
  function getConfigError() { return configError; }

  /* ------------------------------------------------------------------
   * 1. 会话与身份
   * ------------------------------------------------------------------ */

  /** 取当前会话（未登录返回 null） */
  function getSession() {
    if (!client) return Promise.resolve(null);
    return client.auth.getSession().then(function (res) {
      return (res && res.data && res.data.session) || null;
    }).catch(function () { return null; });
  }

  /**
   * 取当前用户与身份类型
   * 返回 { session, user, isAnonymous, isRegistered }
   */
  function getIdentity() {
    return getSession().then(function (session) {
      var user = session ? session.user : null;
      return {
        session: session,
        user: user,
        isAnonymous: !!(user && user.is_anonymous),
        isRegistered: !!(user && !user.is_anonymous)
      };
    });
  }

  /** 取当前用户的资料（profiles 一行），未登录/无资料返回 null */
  function getProfile() {
    if (!client) return Promise.resolve(null);
    return getIdentity().then(function (id) {
      if (!id.user) return null;
      return client.from("profiles").select("*").eq("id", id.user.id).maybeSingle()
        .then(function (res) {
          if (res.error) return null;
          return res.data || null;
        })
        .catch(function () { return null; });
    });
  }

  function onAuthChange(cb) {
    if (!client) return function () {};
    var sub = client.auth.onAuthStateChange(function (event, session) {
      cb(event, session);
    });
    return function () {
      try { sub.data.subscription.unsubscribe(); } catch (e) { /* ignore */ }
    };
  }

  /* ------------------------------------------------------------------
   * 2. 手机号 <-> 伪邮箱
   * ------------------------------------------------------------------ */

  function normalizePhone(raw) {
    return String(raw || "").replace(/[\s\-()]/g, "");
  }

  function isValidPhone(raw) {
    return PHONE_RE.test(normalizePhone(raw));
  }

  function phoneToEmail(raw) {
    return normalizePhone(raw) + EMAIL_DOMAIN;
  }

  /** 手机号脱敏：138****8888 */
  function maskPhone(raw) {
    var p = normalizePhone(raw);
    if (p.length !== 11) return p;
    return p.slice(0, 3) + "****" + p.slice(7);
  }

  /* ------------------------------------------------------------------
   * 3. 注册 / 登录 / 匿名 / 退出
   * ------------------------------------------------------------------ */

  /**
   * 注册（手机号 + 密码 + 学校）
   * 说明：不需要真实短信，手机号只用于登录标识与身份展示。
   */
  function signUp(phone, password, school, nickname) {
    if (!client) return Promise.reject(new Error(configError));
    phone = normalizePhone(phone);
    if (!isValidPhone(phone)) return Promise.reject(new Error("请输入 11 位手机号"));
    if (!password || password.length < 6) return Promise.reject(new Error("密码至少 6 位"));
    if (!school || !school.trim()) return Promise.reject(new Error("请填写学校名称"));

    return client.auth.signUp({
      email: phoneToEmail(phone),
      password: password,
      options: {
        data: {
          phone: phone,
          school: school.trim(),
          nickname: nickname && nickname.trim() ? nickname.trim() : null
        }
      }
    }).then(function (res) {
      if (res.error) throw new Error(friendlyAuthError(res.error.message));
      // 若项目仍开启了「确认邮箱」，这里不会返回 session，用户将无法直接登录
      if (!res.data.session) {
        throw new Error(
          "注册已提交，但项目开启了「Confirm email」导致无法直接登录。" +
          "请在 Supabase 后台 Authentication -> Providers -> Email 中关闭 Confirm email。"
        );
      }
      return res.data;
    });
  }

  /** 登录（手机号 + 密码） */
  function signIn(phone, password) {
    if (!client) return Promise.reject(new Error(configError));
    phone = normalizePhone(phone);
    if (!isValidPhone(phone)) return Promise.reject(new Error("请输入 11 位手机号"));
    if (!password) return Promise.reject(new Error("请输入密码"));

    return client.auth.signInWithPassword({
      email: phoneToEmail(phone),
      password: password
    }).then(function (res) {
      if (res.error) throw new Error(friendlyAuthError(res.error.message));
      return res.data;
    });
  }

  /** 匿名进入（无需注册即可发布与浏览） */
  function signInAnonymously() {
    if (!client) return Promise.reject(new Error(configError));
    return client.auth.signInAnonymously().then(function (res) {
      if (res.error) {
        throw new Error(
          friendlyAuthError(res.error.message) +
          "（如果提示未开启，请到 Supabase 后台 Authentication -> Sign In / Providers 打开 Anonymous sign-ins）"
        );
      }
      return res.data;
    });
  }

  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut().then(function () { /* ignore */ });
  }

  /** 把 Supabase 的英文报错翻译成好懂的中文 */
  function friendlyAuthError(msg) {
    var m = String(msg || "");
    if (/Invalid login credentials/i.test(m)) return "手机号或密码不正确";
    if (/User already registered/i.test(m)) return "这个手机号已经注册过了，直接登录试试";
    if (/Password should be at least/i.test(m)) return "密码太短了，至少 6 位";
    if (/Anonymous sign-ins are disabled/i.test(m)) return "项目未开启匿名登录";
    if (/Email not confirmed/i.test(m)) return "账号尚未确认，请在 Supabase 后台关闭 Confirm email";
    if (/rate limit|too many/i.test(m)) return "操作太频繁了，稍等一会儿再试";
    return m || "操作失败，请稍后重试";
  }

  /* ------------------------------------------------------------------
   * 4. 帖子
   * ------------------------------------------------------------------ */

  /**
   * 发布一条帖子
   * @param {Object} o { content, file, isAnonymous }
   */
  function createPost(o) {
    if (!client) return Promise.reject(new Error(configError));
    o = o || {};

    var content = (o.content || "").trim();
    var isAnonymous = !!o.isAnonymous;

    if (!content && !o.file) return Promise.reject(new Error("写点什么，或者选一张图片吧"));

    return getIdentity().then(function (id) {
      if (!id.user) throw new Error("请先登录或选择匿名进入，再发布内容");

      // 匿名访客也可能设过昵称（见 saveNickname / 发帖弹窗），所以一律取一次资料
      var profilePromise = getProfile();

      return profilePromise.then(function (profile) {
        var school = (profile && profile.school) || "";
        var nickname = (profile && profile.nickname) || "";

        var displayName;
        if (isAnonymous) {
          displayName = "匿名同学";
        } else if (nickname) {
          displayName = nickname;
        } else if (id.isAnonymous) {
          displayName = "路过的同学";
        } else {
          displayName = "同学" + String(id.user.id).slice(0, 4);
        }

        var upload = o.file
          ? uploadImage(o.file, id.user.id)
          : Promise.resolve(null);

        return upload.then(function (imagePath) {
          var row = {
            author_id: id.user.id,
            is_anonymous: isAnonymous,
            display_name: displayName,
            school: school || null,
            content: content || null,
            image_path: imagePath,
            // 新内容一律进待审核：数据库里 RLS 的 posts_insert_self
            // 也只接受 status = 'pending'，自己改不成 approved。
            status: "pending"
          };
          return client.from("posts").insert(row).select().single().then(function (res) {
            if (res.error) throw new Error("发布失败：" + res.error.message);
            return res.data;
          });
        });
      });
    });
  }

  // 前端只取「需要展示」的字段：故意不返回 author_id，
  // 避免匿名帖的身份通过接口被直接读取（见 README「关于匿名的边界」）。
  // status 用来显示「审核中 / 未通过」角标：只有本人看得见自己的待审核内容。
  var POST_COLUMNS = "id, is_anonymous, display_name, school, content, image_path, created_at, status";

  /** 给一批帖子补上点赞数与「我是否点过」 */
  function attachLikes(posts) {
    if (!posts.length) return Promise.resolve(posts);

    var ids = posts.map(function (p) { return p.id; });

    return client.from("likes").select("post_id, user_id").in("post_id", ids)
      .then(function (lres) {
        var counts = {};
        var mine = {};
        var rows = (lres && lres.data) || [];

        return getIdentity().then(function (id) {
          var uid = id.user ? id.user.id : null;
          rows.forEach(function (r) {
            counts[r.post_id] = (counts[r.post_id] || 0) + 1;
            if (uid && r.user_id === uid) mine[r.post_id] = true;
          });
          posts.forEach(function (p) {
            p.like_count = counts[p.id] || 0;
            p.liked_by_me = !!mine[p.id];
          });
          return posts;
        });
      })
      .catch(function () {
        posts.forEach(function (p) { p.like_count = 0; p.liked_by_me = false; });
        return posts;
      });
  }

  /** 取内容流（最新在前） */
  function listPosts(limit) {
    if (!client) return Promise.reject(new Error(configError));
    return client.from("posts")
      .select(POST_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit || 30)
      .then(function (res) {
        if (res.error) throw new Error("加载失败：" + res.error.message);
        return attachLikes(res.data || []);
      });
  }

  /** 取某个用户发过的帖子（author_id 仅用于服务端过滤，不返回给前端） */
  function listMyPosts(userId, limit) {
    if (!client) return Promise.reject(new Error(configError));
    return client.from("posts")
      .select(POST_COLUMNS)
      .eq("author_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit || 50)
      .then(function (res) {
        if (res.error) throw new Error("加载失败：" + res.error.message);
        return attachLikes(res.data || []);
      });
  }

  function deletePost(post) {
    if (!client) return Promise.reject(new Error(configError));
    return client.from("posts").delete().eq("id", post.id).then(function (res) {
      if (res.error) throw new Error("删除失败：" + res.error.message);
      if (post.image_path) {
        return client.storage.from(BUCKET).remove([post.image_path]).catch(function () {});
      }
    });
  }

  /* ------------------------------------------------------------------
   * 5. 点赞
   * ------------------------------------------------------------------ */

  function toggleLike(postId, currentlyLiked) {
    if (!client) return Promise.reject(new Error(configError));
    return getIdentity().then(function (id) {
      if (!id.user) throw new Error("登录后才能回应");
      if (currentlyLiked) {
        return client.from("likes").delete()
          .eq("post_id", postId).eq("user_id", id.user.id)
          .then(function (res) {
            if (res.error) throw new Error(res.error.message);
            return false;
          });
      }
      return client.from("likes").insert({ post_id: postId, user_id: id.user.id })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return true;
        });
    });
  }

  /* ------------------------------------------------------------------
   * 6. 图片上传
   * ------------------------------------------------------------------ */

  function uploadImage(file, userId) {
    if (!client) return Promise.reject(new Error(configError));
    if (!file) return Promise.resolve(null);

    if (file.size > 5 * 1024 * 1024) {
      return Promise.reject(new Error("图片有点大，请选择 5MB 以内的图片"));
    }
    if (file.type && file.type.indexOf("image/") !== 0) {
      return Promise.reject(new Error("请选择图片文件"));
    }

    var ext = extOf(file.name, file.type);
    var path = userId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;

    return client.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg"
    }).then(function (res) {
      if (res.error) {
        throw new Error("图片上传失败：" + res.error.message +
          "（请确认已在 Supabase 执行 docs/supabase-setup.sql 建好 post-images 存储桶）");
      }
      return path;
    });
  }

  function extOf(name, type) {
    var m = /\.([a-zA-Z0-9]+)$/.exec(name || "");
    if (m) return m[1].toLowerCase();
    if (type === "image/png") return "png";
    if (type === "image/gif") return "gif";
    if (type === "image/webp") return "webp";
    return "jpg";
  }

  /** 拼接图片公开地址（含缓存失效兜底） */
  function imageUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    if (!client) return "";
    var res = client.storage.from(BUCKET).getPublicUrl(path);
    return (res && res.data && res.data.publicUrl) || "";
  }

  /* ------------------------------------------------------------------
   * 6.5 举报（看到违规内容时上报给站点主人）
   *     · 只能以自己的身份举报（数据库 RLS：reporter_id = auth.uid()）
   *     · 同一条内容只能举报一次（数据库唯一约束，重复提交会给出友好提示）
   *     · 举报提交后自己改不了也删不掉，处理与否由站点主人在后台决定
   * ------------------------------------------------------------------ */

  var REPORT_REASONS = [
    { key: "illegal", label: "违法违规", hint: "涉政、诈骗、赌博、毒品等" },
    { key: "porn",    label: "色情低俗", hint: "露骨的图片或文字" },
    { key: "ad",      label: "广告营销", hint: "拉群、兼职、卖号、刷单" },
    { key: "abuse",   label: "人身攻击", hint: "辱骂、挂人、歧视" },
    { key: "privacy", label: "隐私泄露", hint: "泄露他人姓名、照片、联系方式" },
    { key: "other",   label: "其他",     hint: "说不清是哪一类就选这个" }
  ];

  /** 举报原因的中文名（后台展示与提示文案用） */
  function reportReasonLabel(key) {
    for (var i = 0; i < REPORT_REASONS.length; i++) {
      if (REPORT_REASONS[i].key === key) return REPORT_REASONS[i].label;
    }
    return "其他";
  }

  /**
   * 提交一条举报
   * @param {string} postId 被举报的帖子 id
   * @param {string} reason 原因 key（见 REPORT_REASONS）
   * @param {string} [detail] 补充说明，最多 200 字
   */
  function reportPost(postId, reason, detail) {
    if (!client) return Promise.reject(new Error(configError));
    if (!postId) return Promise.reject(new Error("没找到要举报的内容，刷新一下再试"));

    var key = String(reason || "");
    var known = false;
    for (var i = 0; i < REPORT_REASONS.length; i++) {
      if (REPORT_REASONS[i].key === key) known = true;
    }
    if (!known) return Promise.reject(new Error("请先选择举报原因"));

    var text = String(detail == null ? "" : detail).trim();
    if (text.length > 200) text = text.slice(0, 200);

    return getIdentity().then(function (id) {
      if (!id.user) throw new Error("请先登录或匿名进入，再举报");

      return client.from("reports").insert({
        post_id: postId,
        reporter_id: id.user.id,
        reason: key,
        detail: text || null,
        status: "open"
      }).then(function (res) {
        if (!res.error) return { reason: key, detail: text };

        var msg = String(res.error.message || "");
        var duplicate = res.error.code === "23505" || /duplicate|unique/i.test(msg);
        if (duplicate) throw new Error("你已经举报过这条内容了，我们正在处理中");
        throw new Error("举报没提交上：" + (msg || "请稍后重试"));
      });
    });
  }

  /* ---------------- 举报弹窗（由 app.js 动态生成，六个页面通用） ---------------- */

  var reportPostId = null;
  var reportWrap = null;

  function reportModalHtml() {
    var options = "";
    for (var i = 0; i < REPORT_REASONS.length; i++) {
      var r = REPORT_REASONS[i];
      options +=
        '<label class="report-option">' +
          '<input type="radio" name="report-reason" value="' + r.key + '">' +
          '<span class="report-option-body">' +
            '<span class="report-option-label">' + escapeHtml(r.label) + "</span>" +
            '<span class="report-option-hint">' + escapeHtml(r.hint) + "</span>" +
          "</span>" +
        "</label>";
    }

    return '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">' +
        '<h3 class="modal-title" id="report-modal-title">举报这条分享</h3>' +
        '<p class="modal-text">' +
          "举报会直接送到站点管理员那里，由人工核查。<br>" +
          "恶意举报同样会被处理，所以请如实选择。" +
        "</p>" +
        '<div class="report-reasons">' + options + "</div>" +
        '<textarea class="modal-input report-detail" id="report-detail" rows="3" maxlength="200" ' +
          'placeholder="补充说明（选填，最多 200 字）"></textarea>' +
        '<p class="modal-hint" id="report-hint" hidden></p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary btn-block" type="button" id="report-submit">提交举报</button>' +
          '<button class="link-plain modal-link" type="button" id="report-cancel">算了，不举报了</button>' +
        "</div>" +
      "</div>";
  }

  /** 弹窗里的各个元素（页面里没有真实 DOM 时会拿到空集合，逻辑会安全跳过） */
  function reportEls(wrap) {
    return {
      wrap: wrap,
      radios: wrap && wrap.querySelectorAll ? wrap.querySelectorAll("input") : [],
      detail: document.getElementById("report-detail"),
      hint: document.getElementById("report-hint"),
      submit: document.getElementById("report-submit")
    };
  }

  function checkedReason(radios) {
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      if (r && r.name === "report-reason" && r.checked) return r.value;
    }
    return "";
  }

  function closeReportDialog() {
    if (reportWrap) reportWrap.hidden = true;
    reportPostId = null;
    if (document.body) document.body.classList.remove("modal-open");
  }

  /** 第一次用到举报时才把弹窗建出来（六个页面共用，所以放在 app.js 里） */
  function ensureReportDialog() {
    if (reportWrap) return reportWrap;
    if (!document.body) return null;

    var wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.id = "report-modal";
    wrap.hidden = true;
    wrap.innerHTML = reportModalHtml();
    document.body.appendChild(wrap);
    reportWrap = wrap;

    wrap.addEventListener("click", function (e) {
      // 点半透明背景、或点「算了」都算取消
      var el = e.target;
      var cancel = el && el.closest ? el.closest("#report-cancel") : null;
      if (cancel || el === wrap) closeReportDialog();
    });

    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && reportWrap && !reportWrap.hidden) {
        closeReportDialog();
      }
    });

    var els = reportEls(wrap);
    if (els.submit) {
      els.submit.addEventListener("click", function () {
        var cur = reportEls(wrap);
        var reason = checkedReason(cur.radios);

        if (!reason) {
          showNotice(cur.hint, "warn", "先选一个举报原因吧");
          return;
        }

        cur.submit.disabled = true;
        cur.submit.innerHTML = '<span class="spinner"></span><span>正在提交…</span>';

        reportPost(reportPostId, reason, cur.detail ? cur.detail.value : "")
          .then(function (r) {
            showNotice(cur.hint, "ok",
              "已收到你的举报（" + reportReasonLabel(r.reason) + "），我们会尽快核查。");
            setTimeout(function () {
              closeReportDialog();
              var pageNotice = document.getElementById("notice");
              if (pageNotice) {
                showNotice(pageNotice, "ok", "举报已提交，感谢你帮忙维护这里的氛围。");
                setTimeout(function () { hideNotice(pageNotice); }, 4000);
              }
            }, 900);
          })
          .catch(function (err) {
            showNotice(cur.hint, "error", err.message);
          })
          .then(function () {
            cur.submit.disabled = false;
            cur.submit.textContent = "提交举报";
          });
      });
    }

    return wrap;
  }

  /**
   * 打开举报弹窗
   * @param {string} postId 被举报的帖子 id
   * @returns {boolean} 是否成功打开
   */
  function openReportDialog(postId) {
    if (blockIfNotReady(document.getElementById("notice"))) return false;

    var wrap = ensureReportDialog();
    if (!wrap) return false;

    reportPostId = postId;

    // 每次打开都清掉上一次的选择
    var els = reportEls(wrap);
    for (var i = 0; i < els.radios.length; i++) els.radios[i].checked = false;
    if (els.detail) els.detail.value = "";
    if (els.hint) hideNotice(els.hint);
    if (els.submit) { els.submit.disabled = false; els.submit.textContent = "提交举报"; }

    wrap.hidden = false;
    if (document.body) document.body.classList.add("modal-open");
    return true;
  }

  /* 卡片上的「举报」按钮统一在这里接管，各页面不用再写一遍 */
  document.addEventListener("click", function (e) {
    var el = e.target;
    var btn = el && el.closest ? el.closest("[data-report]") : null;
    if (!btn) return;
    openReportDialog(btn.getAttribute("data-report"));
  });

  /* ------------------------------------------------------------------
   * 6.6 我的举报回执（在「我的」页看自己举报过的内容处理得怎样了）
   *     · 数据库只允许读到自己的举报（RLS：reporter_id = auth.uid()）
   *     · 被举报的内容若已删除或不再公开，关联结果就是 null，这里照样显示状态
   * ------------------------------------------------------------------ */

  var REPORT_COLUMNS = "id, reason, detail, status, created_at, " +
    "posts(content, display_name, is_anonymous, status, created_at, image_path)";

  var REPORT_STATE = {
    open:     { label: "处理中", className: "tag-review", note: "我们已经收到，正在核查。" },
    resolved: { label: "已处理", className: "tag-done",   note: "谢谢你的反馈，这条内容已经被处理。" },
    ignored:  { label: "未违规", className: "tag-quiet",  note: "我们核查过了，这条内容暂时没有发现问题。" }
  };

  /** 举报状态的中文名（认不出的状态按「处理中」显示，不吓人） */
  function reportStatusLabel(status) {
    var s = REPORT_STATE[String(status || "open")];
    return s ? s.label : REPORT_STATE.open.label;
  }

  function reportStatusClass(status) {
    var s = REPORT_STATE[String(status || "open")];
    return s ? s.className : REPORT_STATE.open.className;
  }

  function reportStatusNote(status) {
    var s = REPORT_STATE[String(status || "open")];
    return s ? s.note : REPORT_STATE.open.note;
  }

  /**
   * 取我提交过的举报（最新在前），没登录时返回空数组
   * @param {number} [limit] 默认 30
   */
  function listMyReports(limit) {
    if (!client) return Promise.reject(new Error(configError));

    return getIdentity().then(function (id) {
      if (!id.user) return [];

      return client.from("reports")
        .select(REPORT_COLUMNS)
        .eq("reporter_id", id.user.id)
        .order("created_at", { ascending: false })
        .limit(limit || 30)
        .then(function (res) {
          if (res.error) throw new Error("加载失败：" + res.error.message);
          return res.data || [];
        });
    });
  }

  /** 被举报内容现在的样子（已经看不到的就直说，不猜） */
  function reportedExcerpt(post) {
    if (!post) return "这条内容现在看不到了（可能已被删除或下架）";

    var text = String(post.content == null ? "" : post.content).trim();
    if (text.length > 40) text = text.slice(0, 40) + "…";

    var who = post.is_anonymous ? "匿名同学" : (String(post.display_name || "").trim() || "同学");
    if (!text) return "「" + who + "」发的一张图片";
    return "「" + who + "」：" + text;
  }

  /**
   * 一条举报回执
   * @param {object} report listMyReports() 里的一行
   */
  function renderReportReceipt(report) {
    var r = report || {};

    return '<div class="receipt">' +
        '<div class="receipt-top">' +
          '<span class="tag ' + reportStatusClass(r.status) + '">' +
            escapeHtml(reportStatusLabel(r.status)) + "</span>" +
          '<span class="receipt-time">' + escapeHtml(timeAgo(r.created_at)) + "</span>" +
        "</div>" +
        '<div class="receipt-quote">' + escapeHtml(reportedExcerpt(r.posts)) + "</div>" +
        '<div class="receipt-meta">举报原因：' + escapeHtml(reportReasonLabel(r.reason)) +
          (r.detail ? " · 你写的说明：" + escapeHtml(r.detail) : "") +
        "</div>" +
        '<div class="receipt-note">' + escapeHtml(reportStatusNote(r.status)) + "</div>" +
      "</div>";
  }

  /* ------------------------------------------------------------------
   * 7. UI 工具
   * ------------------------------------------------------------------ */

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 6月1日 */
  function timeAgo(iso) {
    if (!iso) return "";
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var diff = Math.floor((Date.now() - t) / 1000);
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
    var d = new Date(t);
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  /** 按时段问候 */
  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return "夜深了";
    if (h < 11) return "早上好";
    if (h < 14) return "中午好";
    if (h < 18) return "下午好";
    if (h < 23) return "晚上好";
    return "夜深了";
  }

  /** 昵称首字（用于头像） */
  function initial(name) {
    var s = String(name || "?").trim();
    if (!s) return "?";
    return s.slice(0, 1).toUpperCase();
  }

  function avatarHtml(post) {
    if (post.is_anonymous) {
      return '<div class="avatar anon" aria-hidden="true">🌙</div>';
    }
    return '<div class="avatar" aria-hidden="true">' + escapeHtml(initial(post.display_name)) + "</div>";
  }

  /** 审核状态角标：只有本人看得到自己的待审核 / 未通过内容，所以角标也基本只有本人可见 */
  function statusTag(status) {
    if (status === "pending") {
      return '<span class="tag tag-review">审核中</span>';
    }
    if (status === "rejected") {
      return '<span class="tag tag-reject">未通过</span>';
    }
    return "";
  }

  /** 渲染单条帖子卡片 */
  function renderPostCard(post) {
    var url = imageUrl(post.image_path);
    var name = post.is_anonymous ? "匿名同学" : (post.display_name || "一位同学");

    var meta = [];
    if (post.school) meta.push(escapeHtml(post.school));
    meta.push(timeAgo(post.created_at));

    var html = '<article class="card post" data-post-id="' + escapeHtml(post.id) + '">';

    html += '<div class="post-head">';
    html += avatarHtml(post);
    html += '<div class="post-meta">';
    html += '<div class="post-name">' + escapeHtml(name);
    if (post.is_anonymous) html += '<span class="tag">匿名</span>';
    html += statusTag(post.status);
    html += "</div>";
    html += '<div class="post-sub">' + meta.map(function (x) { return "<span>" + x + "</span>"; }).join("<span>·</span>") + "</div>";
    html += "</div></div>";

    if (post.content) {
      html += '<div class="post-body">' + escapeHtml(post.content) + "</div>";
    }
    if (url) {
      html += '<div class="post-image"><img src="' + escapeHtml(url) + '" alt="分享的图片" loading="lazy"></div>';
    }

    html += '<div class="post-foot">';
    html += '<button class="like-btn' + (post.liked_by_me ? " liked" : "") + '" data-like="' + escapeHtml(post.id) + '">';
    html += "<span>" + (post.liked_by_me ? "🧡" : "🤍") + "</span>";
    html += "<span>" + (post.like_count || 0) + "</span>";
    html += "</button>";
    html += '<span class="post-time">' + escapeHtml(timeAgo(post.created_at)) + "</span>";
    html += '<button class="link-plain report-btn" type="button" data-report="' + escapeHtml(post.id) +
      '">举报</button>';
    html += "</div></article>";

    return html;
  }

  /** 表单/页面提示条 */
  function showNotice(el, type, text) {
    if (!el) return;
    el.hidden = false;
    el.className = "notice notice-" + (type || "info");
    el.textContent = text;
  }

  function hideNotice(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  /** 底部导航当前高亮（藏在二级菜单里的页面，会把一级入口「更多」点亮） */
  function markTabbar(active) {
    var items = document.querySelectorAll(".tabbar-item");
    var matched = false;
    for (var i = 0; i < items.length; i++) {
      var key = items[i].getAttribute("data-tab");
      if (key === active) { items[i].classList.add("active"); matched = true; }
      else items[i].classList.remove("active");
    }

    var more = document.getElementById("tab-more");
    if (!more) return;
    more.classList.remove("tabbar-active");
    var inner = more.querySelectorAll(".menu-item");
    for (var j = 0; j < inner.length; j++) {
      var innerKey = inner[j].getAttribute("data-tab");
      if (!matched && innerKey === active) {
        inner[j].classList.add("active");
        more.classList.add("tabbar-active");
      } else {
        inner[j].classList.remove("active");
      }
    }
  }

  /* 二级菜单：点面板外面、或按 Esc 就收起来（details 本身做不到） */
  function bindMoreMenu() {
    function close() {
      var more = document.getElementById("tab-more");
      if (more && more.open) more.open = false;
    }
    document.addEventListener("click", function (e) {
      var more = document.getElementById("tab-more");
      if (more && more.open && !more.contains(e.target)) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") close();
    });
  }
  bindMoreMenu();

  /** 配置相关的排查步骤（配置未就绪时给用户看的） */
  function setupHint() {
    return (configError || "") +
      " 配置步骤：① 打开 supabase.com 新建项目；" +
      "② 在 SQL Editor 执行 docs/supabase-setup.sql；" +
      "③ 把 Project URL 和 anon key 填进 assets/js/config.js；" +
      "④ 关闭 Confirm email、打开 Anonymous sign-ins。详见 README.md。";
  }

  /** 统一的「配置没填好」提示 */
  function blockIfNotReady(noticeEl) {
    if (!configError) return false;
    showNotice(noticeEl, "warn", setupHint());
    return true;
  }

  /** 后端尚未配置时展示的引导卡片（让第一次打开网站的人知道该做什么） */
  function setupCard() {
    return '<div class="empty">' +
        '<div class="empty-icon">🛠</div>' +
        '<div class="empty-title">还差最后一步配置</div>' +
        '<div class="empty-text">' + escapeHtml(configError || "") + "</div>" +
      "</div>" +
      '<div class="card">' +
        '<h3 class="section-title mb-8">三步连接你的后端（免费）</h3>' +
        '<p class="text-sm text-muted" style="line-height:2">' +
          '1. 打开 <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> 新建一个项目<br>' +
          '2. 把 <code>docs/supabase-setup.sql</code> 的内容贴进 SQL Editor 执行<br>' +
          '3. 把 Project URL 和 anon key 填进 <code>assets/js/config.js</code><br>' +
          '4. 到 Authentication 里关闭 <code>Confirm email</code>、打开 <code>Anonymous sign-ins</code>' +
        "</p>" +
        '<p class="text-sm text-muted mt-16">详细步骤见项目根目录的 <code>README.md</code>。</p>' +
      "</div>";
  }

  /* ------------------------------------------------------------------
   * 8. 资料：保存昵称
   * ------------------------------------------------------------------ */

  /**
   * 保存昵称（注册用户和匿名访客都能用：RLS 的 profiles_update_self 只允许改自己那一行）
   * @param {string} nickname 最多 20 个字，空字符串表示清空
   */
  function saveNickname(nickname) {
    if (!client) return Promise.reject(new Error(configError));

    var name = String(nickname == null ? "" : nickname).trim();
    if (name.length > 20) return Promise.reject(new Error("昵称最多 20 个字"));

    return getIdentity().then(function (id) {
      if (!id.user) throw new Error("请先登录或匿名进入，再设置昵称");
      return client.from("profiles")
        .update({ nickname: name || null, updated_at: new Date().toISOString() })
        .eq("id", id.user.id)
        .then(function (res) {
          if (res.error) throw new Error("昵称没保存上：" + res.error.message);
          return name;
        });
    });
  }

  /** 防抖 */
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  /* ------------------------------------------------------------------
   * 9. 导出
   * ------------------------------------------------------------------ */
  return {
    // 环境
    isReady: isReady,
    getConfigError: getConfigError,
    client: function () { return client; },
    SITE_NAME: SITE_NAME,
    BUCKET: BUCKET,

    // 会话
    getSession: getSession,
    getIdentity: getIdentity,
    getProfile: getProfile,
    onAuthChange: onAuthChange,

    // 认证
    normalizePhone: normalizePhone,
    isValidPhone: isValidPhone,
    maskPhone: maskPhone,
    signUp: signUp,
    signIn: signIn,
    signInAnonymously: signInAnonymously,
    signOut: signOut,

    // 数据
    createPost: createPost,
    listPosts: listPosts,
    listMyPosts: listMyPosts,
    deletePost: deletePost,
    toggleLike: toggleLike,
    imageUrl: imageUrl,
    saveNickname: saveNickname,

    // 举报
    reportPost: reportPost,
    openReportDialog: openReportDialog,
    reportReasons: REPORT_REASONS,
    listMyReports: listMyReports,
    reportStatusLabel: reportStatusLabel,
    reportStatusNote: reportStatusNote,
    reportedExcerpt: reportedExcerpt,
    renderReportReceipt: renderReportReceipt,

    // UI
    escapeHtml: escapeHtml,
    timeAgo: timeAgo,
    greeting: greeting,
    initial: initial,
    renderPostCard: renderPostCard,
    statusTag: statusTag,
    showNotice: showNotice,
    hideNotice: hideNotice,
    markTabbar: markTabbar,
    blockIfNotReady: blockIfNotReady,
    setupCard: setupCard,
    setupHint: setupHint,
    debounce: debounce
  };
})();
