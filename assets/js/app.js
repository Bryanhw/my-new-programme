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

      var profilePromise = id.isRegistered ? getProfile() : Promise.resolve(null);

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
            image_path: imagePath
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
  var POST_COLUMNS = "id, is_anonymous, display_name, school, content, image_path, created_at";

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
   * 8. 导出
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

    // UI
    escapeHtml: escapeHtml,
    timeAgo: timeAgo,
    greeting: greeting,
    initial: initial,
    renderPostCard: renderPostCard,
    showNotice: showNotice,
    hideNotice: hideNotice,
    markTabbar: markTabbar,
    blockIfNotReady: blockIfNotReady,
    setupCard: setupCard,
    setupHint: setupHint,
    debounce: debounce
  };
})();
