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

  /* 学校固定列表（assets/js/campuses.js，任务 D2）。
   * 页面没加载它时这里整体降级：校名只做去空白，城市为空，不报错。 */
  var campusList = window.CampusList || null;

  /** 把用户输入的学校归一成规范校名；不在列表里就原样收下 */
  function canonicalSchool(raw) {
    if (campusList) return campusList.schoolOf(raw);
    return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  }

  /** 学校对应的城市（「只看同城」要用）；认不出来返回空串 */
  function cityOfSchool(raw) {
    return campusList ? campusList.cityOf(raw) : "";
  }

  /** 注册页补全用的学校清单；没有列表时返回空数组 */
  function schoolOptions() {
    return campusList ? campusList.schoolOptions() : [];
  }

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
          school: canonicalSchool(school),
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
   * 统一署名算法：昵称优先；没昵称时匿名访客显示「路过的同学」，
   * 注册用户显示「同学 xxxx」。发帖、评论共用；
   * 数据库的 sync_my_display_name() 保持同样规则（两边要一致）。
   */
  function buildDisplayName(profile, identity) {
    var nickname = String((profile && profile.nickname) || "").trim();
    if (nickname) return nickname;
    if (identity && identity.isAnonymous) return "路过的同学";
    if (identity && identity.user) return "同学" + String(identity.user.id).slice(0, 4);
    return "一位同学";
  }

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
        // 勾了匿名 → 署名存成固定「匿名同学」（这只是兜底值，不是展示值）；
        // 卡片上显示的「匿名 #编号」是渲染时按帖子 id 现算的（anonName），不入库。
        // 非匿名 → 走统一署名算法（和评论一致）
        var displayName = isAnonymous ? "匿名同学" : buildDisplayName(profile, id);

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
          // 这里必须列出列名：数据库已撤销 posts.author_id 的读权限，
          // select=* 会整条失败（42501），列出来才只回显需要的展示字段。
          return withAnonCodeFallback(function () {
            return client.from("posts").insert(row).select(postColumns()).single();
          }).then(function (res) {
            if (res.error) throw new Error("发布失败：" + res.error.message);
            return res.data;
          });
        });
      });
    });
  }

  // 前端只取「需要展示」的字段：author_id 不在其中 —— 数据库那边已经把这列的
  // 读权限撤掉了（见 docs/supabase-anon-privacy.sql），所以即使有人直接调接口，
  // 也拿不到匿名帖的作者账号（README「关于匿名的边界」）。
  // status 用来显示「审核中 / 未通过」角标：只有本人看得见自己的待审核内容。
  var POST_COLUMNS = "id, is_anonymous, display_name, school, content, image_path, created_at, status";

  /**
   * 稳定洞号（D1）：posts.anon_code 是数据库的生成列，同一个人的匿名帖共用一个号。
   *
   * 为什么要有下面这套「能力探测」：
   *   数据库迁移和页面发布是两条独立的线，谁先谁后都可能发生 ——
   *   在库里还没有这一列时，请求里带上它会让**整条查询**失败（42703），
   *   广场直接白屏。所以先带列请求，一旦接口说「没这列」，就在本次会话里
   *   记住并改回不带列的老查询（页面退回 S1 的每帖编号，功能不受影响）。
   *   探测失败最多一次，之后不再多花一次请求。
   */
  var ANON_CODE_COLUMN = "anon_code";
  var anonCodeColumnOk = true;

  function postColumns() {
    return POST_COLUMNS + (anonCodeColumnOk ? ", " + ANON_CODE_COLUMN : "");
  }

  /** 接口是不是在说「这个列不存在」（Postgres 42703 / PostgREST PGRST204） */
  function isMissingColumn(err) {
    if (!err) return false;
    return String(err.code || "") === "42703" ||
           String(err.code || "") === "PGRST204" ||
           String(err.message || "").indexOf(ANON_CODE_COLUMN) >= 0;
  }

  /** 统一封一层：带上 anon_code 的请求若因「列不存在」失败，就降级重试一次 */
  function withAnonCodeFallback(run) {
    return run().then(function (res) {
      if (res && res.error && anonCodeColumnOk && isMissingColumn(res.error)) {
        anonCodeColumnOk = false;
        return run();
      }
      return res;
    });
  }

  /** 给一批帖子补上点赞数与「我是否点过」。
   *  读取走视图 post_likes：它只给「计数 + 我是否点过」，不含 user_id。
   *  数据库那边已经把 likes 的读取收口了（见 docs/supabase-likes-privacy.sql），
   *  所以这里不能再直接查 likes —— 那会 42501，而且会重新暴露「谁点了赞」。
   *  视图里没有点赞记录的内容不会出现，所以查不到的按 0 / false 处理即可。 */
  function attachLikes(posts) {
    if (!posts.length) return Promise.resolve(posts);

    var ids = posts.map(function (p) { return p.id; });

    return client.from("post_likes").select("post_id, like_count, liked_by_me").in("post_id", ids)
      .then(function (lres) {
        var map = {};
        ((lres && lres.data) || []).forEach(function (r) { map[r.post_id] = r; });

        posts.forEach(function (p) {
          var row = map[p.id];
          p.like_count = row ? (row.like_count || 0) : 0;
          p.liked_by_me = !!(row && row.liked_by_me);
        });
        return posts;
      })
      .catch(function () {
        posts.forEach(function (p) { p.like_count = 0; p.liked_by_me = false; });
        return posts;
      });
  }

  /** 取内容流（最新在前） */
  function listPosts(limit) {
    if (!client) return Promise.reject(new Error(configError));
    return withAnonCodeFallback(function () {
      return client.from("posts")
        .select(postColumns())
        .order("created_at", { ascending: false })
        .limit(limit || 30);
    })
      .then(function (res) {
        if (res.error) throw new Error("加载失败：" + res.error.message);
        return attachLikes(res.data || []).then(attachComments);
      });
  }

  /** 取「我发过的帖子」。
   *  过滤在服务端完成：视图 public.my_posts 用 auth.uid() 推导，客户端不再
   *  （也没有权限）用 author_id 过滤 —— 列级权限同样管住 WHERE 里的列。 */
  function listMyPosts(limit) {
    if (!client) return Promise.reject(new Error(configError));
    return withAnonCodeFallback(function () {
      return client.from("my_posts")
        .select(postColumns())
        .order("created_at", { ascending: false })
        .limit(limit || 50);
    })
      .then(function (res) {
        if (res.error) throw new Error("加载失败：" + res.error.message);
        return attachLikes(res.data || []).then(attachComments);
      });
  }

  /* ------------------------------------------------------------------
   * 4.5 城市圈（B5：城市圈优先推荐 + 圈内热词）
   *
   *  圈子只改「看的顺序」，不新开分区：选了圈就把本圈帖子排到前面、卡片上标一个
   *  圈名，「只看本圈」才是过滤。没加载 circles.js 的页面（如注册页）整体降级：
   *  没有圈，行为与以前完全一致，不报错。
   *
   *  为什么本圈和全量分两次请求、在前端合并：
   *    「本圈排在前面、但后面的内容一个都不能少」在 PostgREST 里没有干净的写法
   *    （要么服务端加视图/函数——那是迁移，要么用 or() 拼一大堆条件）。
   *    两次请求都是原本就公开的读通道，没有新增任何可读字段。
   * ------------------------------------------------------------------ */
  var circleList = window.CircleList || null;
  var hotWords = window.HotWords || null;

  /** 选的圈存在本机（同 circles.js 的 STORAGE_KEY）；不做账号级同步：
   *  匿名访客也有 localStorage，存账号里反而要写 profiles（那是迁移）。 */
  var CIRCLE_KEY = (circleList && circleList.STORAGE_KEY) || "campus.circle";

  /** 本机存的圈子（没选、被禁用、值不合法都返回空串） */
  function getCircle() {
    if (!circleList) return "";
    var id = "";
    try { id = window.localStorage.getItem(CIRCLE_KEY) || ""; } catch (e) { id = ""; }
    return circleList.exists(id) ? id : "";
  }

  /** 选圈；传空串 = 取消选择。存不下（隐私模式）也不影响本次浏览 */
  function setCircle(id) {
    if (!circleList) return "";
    var next = circleList.exists(id) ? id : "";
    try {
      if (next) window.localStorage.setItem(CIRCLE_KEY, next);
      else window.localStorage.removeItem(CIRCLE_KEY);
    } catch (e) { /* 忽略：只是下次打开要重选 */ }
    return next;
  }

  function listCircles() { return circleList ? circleList.list() : []; }

  /** 圈名（拿不到返回空串，调用方据此不显示圈子） */
  function circleName(id) { return circleList ? circleList.nameOf(id) : ""; }

  /** 学校 → 圈 id（认不出来是空串） */
  function circleOfSchool(school) { return circleList ? circleList.circleOf(school) : ""; }

  /** 我（当前登录身份）学校所属的圈；没登录/认不出是空串 */
  function myCircle() {
    if (!circleList) return Promise.resolve("");
    return getProfile().then(function (profile) {
      return circleOfSchool((profile && profile.school) || "");
    }).catch(function () { return ""; });
  }

  /**
   * 本圈帖子（只走 school 集合筛选）。
   * 不额外加 status 条件：和广场一样交给 RLS —— 加了就会把「自己的待审核帖」
   * 从本圈列表里挤掉，同一条内容在两个列表里表现不一致更让人困惑。
   */
  function listCirclePosts(circleId, limit) {
    if (!client) return Promise.reject(new Error(configError));
    var schools = circleList ? circleList.schoolsIn(circleId) : [];
    if (!schools.length) return Promise.resolve([]);
    return withAnonCodeFallback(function () {
      return client.from("posts")
        .select(postColumns())
        .in("school", schools)
        .order("created_at", { ascending: false })
        .limit(limit || 30);
    })
      .then(function (res) {
        if (res.error) throw new Error("加载失败：" + res.error.message);
        return res.data || [];
      });
  }

  /**
   * 广场数据流（本圈优先）。
   *   opts.circleId  已选圈子（空 = 没选，走原来的单请求）
   *   opts.onlyCircle 只看本圈（不再拉全量）
   * 返回的帖子会带上 circle_id / circle_name（本圈批次在前），卡片据此标圈名。
   */
  function listFeedPosts(opts) {
    opts = opts || {};
    var limit = opts.limit || 30;
    var circleId = circleList && circleList.exists(opts.circleId) ? opts.circleId : "";

    if (!circleId) {
      return listPosts(limit);
    }
    if (opts.onlyCircle) {
      return listCirclePosts(circleId, limit).then(function (posts) {
        return attachLikes(posts).then(attachComments);
      });
    }
    return listCirclePosts(circleId, limit).then(function (mine) {
      return listPosts(limit).then(function (all) {
        // 合并之后补一次点赞/评论数：本圈那批是单独取的，不补的话
        // 卡片上的 🤍 会全变成 0 —— 换了排序方式不该让计数消失。
        return attachLikes(mergeFeedPosts(mine, all)).then(attachComments);
      });
    });
  }

  /**
   * 合并「本圈 + 全量」：本圈在前，同一帖只留一份（留本圈那批的对象）。
   * 每帖尽可能标上它自己的圈名 —— 是本机按校名算的，不额外读数据库。
   */
  function mergeFeedPosts(mine, all) {
    var seen = {}, out = [], i, p, cid;
    for (i = 0; i < (mine || []).length; i++) {
      p = mine[i];
      if (!p || seen[p.id]) continue;
      seen[p.id] = 1;
      tagCircle(p, true);
      out.push(p);
    }
    for (i = 0; i < (all || []).length; i++) {
      p = all[i];
      if (!p || seen[p.id]) continue;
      seen[p.id] = 1;
      tagCircle(p, false);
      out.push(p);
    }
    return out;
  }

  function tagCircle(post, inCircle) {
    var cid = circleOfSchool(post.school);
    post.circle_id = cid;
    post.circle_name = cid ? circleName(cid) : "";
    post.in_circle = !!inCircle;
  }

  /**
   * 圈内热词：本圈近 WINDOW_DAYS 天、最新的一批帖子，纯前端统计。
   *  - 取样用公开读通道，不新增接口、不新增字段；
   *  - 作者标识只在 HotWords 内部当「至少两个人提到」的闸门，绝不外传；
   *  - 取不到（网络/没圈）就返回空数组：界面上宁可不显示热词，也不显示错的。
   */
  function listCircleHotwords(circleId) {
    if (!hotWords || !circleList || !circleList.exists(circleId)) return Promise.resolve([]);
    var cap = hotWords.MAX_POSTS || 300;
    return listCirclePosts(circleId, cap).then(function (posts) {
      var pool = [], i;
      for (i = 0; i < (posts || []).length; i++) {
        // 热词只统计已通过的帖子：待审核/未通过的内容不该被「加热」
        if (posts[i] && posts[i].status === "approved") pool.push(posts[i]);
      }
      var banned = [circleName(circleId)];
      var schools = circleList.schoolsIn(circleId);
      for (i = 0; i < schools.length; i++) banned.push(schools[i]);
      return hotWords.top(pool, { banned: banned });
    }).catch(function () { return []; });
  }

  /**
   * 一词筛帖：把「像词的东西」拿去和帖子的正文比对。
   * 这是**纯前端筛选**，只在调用方给的那批（已加载的）帖子里找 ——
   * 界面上必须如实说明「只筛已加载的这几条」，不能让人以为搜了全站。
   * 比对前两边都过一遍 HotWords 的归一化并清掉标点空白，所以全角、空格、
   * 大小写、正文里的链接洞号都不会影响命中。
   */
  function termKey(text) {
    var n = hotWords ? hotWords.normalize(text) : String(text == null ? "" : text).toLowerCase();
    return n.replace(/[^0-9a-z\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g, "");
  }

  function filterPostsByTerm(posts, term) {
    var key = termKey(term);
    var all = posts || [];
    if (!key) return all.slice();
    var out = [], i;
    for (i = 0; i < all.length; i++) {
      if (termKey(all[i] && all[i].content).indexOf(key) >= 0) out.push(all[i]);
    }
    return out;
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
        // 过滤条件只能带 post_id：user_id 这一列前端已经没有读权限了
        // （见 docs/supabase-likes-privacy.sql），WHERE 里带上它会 42501。
        // 也不会误删别人的点赞 —— RLS 策略 likes_delete_self 只放行
        // 「auth.uid() = user_id」的行。
        return client.from("likes").delete()
          .eq("post_id", postId)
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
   *
   *    上传前先压缩：手机直出的照片常有 3–5MB，而同学多是用手机流量
   *    刷这个站，原图会让每次浏览都等很久。压到「最长边 1600px 的 JPEG」
   *    后通常只剩几百 KB，手机屏幕上几乎看不出差别。
   *
   *    三条原则（宁愿不压，也不要把用户的东西弄坏）：
   *      1. 只在「确定更小」时才替换：压完反而更大就用原图；
   *      2. 任何一步失败（取不到尺寸、canvas 不可用、编码抛错）都退回原文件，
   *         压缩绝不导致「发布失败」；
   *      3. 动图（gif）与矢量图（svg）不重编码，避免动画丢失或糊掉。
   * ------------------------------------------------------------------ */

  var IMAGE_MAX_EDGE = 1600;              // 最长边上限（px）
  var IMAGE_QUALITY = 0.8;                // JPEG 质量：肉眼无损与体积的平衡点
  var IMAGE_COMPRESS_OVER = 300 * 1024;   // 小于 300KB 的文件不值得折腾
  var IMAGE_SKIP_TYPES = /^image\/(gif|svg\+xml)$/;

  /** 读出图片本身（优先 createImageBitmap：顺带按 EXIF 把手机照片摆正） */
  function loadImage(file) {
    if (typeof window.createImageBitmap === "function") {
      try {
        return window.createImageBitmap(file, { imageOrientation: "from-image" })
          .catch(function () { return window.createImageBitmap(file); });
      } catch (e) { /* 老浏览器没有这个参数形态，走下面 <img> 兜底 */ }
    }
    return new Promise(function (resolve, reject) {
      if (!window.URL || typeof window.URL.createObjectURL !== "function") {
        reject(new Error("当前浏览器不支持读取本地图片"));
        return;
      }
      var url = window.URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        if (window.URL.revokeObjectURL) window.URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        if (window.URL.revokeObjectURL) window.URL.revokeObjectURL(url);
        reject(new Error("图片解码失败"));
      };
      img.src = url;
    });
  }

  /** 把 dataURL 还原成 Blob（老浏览器没有 canvas.toBlob 时的兜底） */
  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(",");
    var mime = /data:([^;]+)/.exec(parts[0] || "");
    var bin = window.atob(parts[1] || "");
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: (mime && mime[1]) || "image/jpeg" });
  }

  /** canvas → Blob；编码不出来就 resolve(null)，由调用方决定退回原图 */
  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (typeof canvas.toBlob === "function") {
        try {
          canvas.toBlob(function (blob) { resolve(blob || null); }, type, quality);
          return;
        } catch (e) { /* 落到 toDataURL */ }
      }
      try { resolve(dataUrlToBlob(canvas.toDataURL(type, quality))); }
      catch (e) { resolve(null); }
    });
  }

  /**
   * 上传前的图片压缩。
   * @returns {Promise<File|Blob>} 压缩后的 JPEG，或原文件（不需要/没压成）
   */
  function compressImage(file) {
    if (!file || typeof file.size !== "number" || file.size <= IMAGE_COMPRESS_OVER) {
      return Promise.resolve(file);
    }
    var type = file.type || "";
    if (type.indexOf("image/") !== 0 || IMAGE_SKIP_TYPES.test(type)) {
      return Promise.resolve(file);
    }

    return Promise.resolve().then(function () {
      return loadImage(file);
    }).then(function (src) {
      var w = src.width || src.naturalWidth || 0;
      var h = src.height || src.naturalHeight || 0;
      if (!w || !h) throw new Error("拿不到图片尺寸");

      var scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h));
      var tw = Math.max(1, Math.round(w * scale));
      var th = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      var ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 不可用");

      // 先铺一层白底：PNG 的透明区域转成 JPEG 会变黑，铺白最接近肉眼预期
      if (typeof ctx.fillRect === "function") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, tw, th);
      }
      ctx.drawImage(src, 0, 0, tw, th);
      if (typeof src.close === "function") src.close();

      return canvasToBlob(canvas, "image/jpeg", IMAGE_QUALITY);
    }).then(function (blob) {
      if (!blob || !blob.size || blob.size >= file.size) return file;
      return blob;
    }).catch(function () {
      return file;   // 压缩失败不是错误，最多就是白白多花点流量
    });
  }

  function uploadImage(file, userId) {
    if (!client) return Promise.reject(new Error(configError));
    if (!file) return Promise.resolve(null);

    if (file.size > 5 * 1024 * 1024) {
      return Promise.reject(new Error("图片有点大，请选择 5MB 以内的图片"));
    }
    if (file.type && file.type.indexOf("image/") !== 0) {
      return Promise.reject(new Error("请选择图片文件"));
    }

    // 先压缩、再上传。返回值只可能是「更小的 JPEG」或「原文件」，
    // 所以扩展名和 content-type 都要跟着实际要传的那个对象走。
    return compressImage(file).then(function (payload) {
      var compressed = payload !== file;
      var ext = compressed ? extOf("", payload.type) : extOf(file.name, file.type);
      var path = userId + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;

      return client.storage.from(BUCKET).upload(path, payload, {
        cacheControl: "3600",
        upsert: false,
        contentType: payload.type || file.type || "image/jpeg"
      }).then(function (res) {
        if (res.error) {
          throw new Error("图片上传失败：" + res.error.message +
            "（请确认已在 Supabase 执行 docs/supabase-setup.sql 建好 post-images 存储桶）");
        }
        return path;
      });
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
   * 提交一条举报（帖子或评论）
   * @param {string} postId 被举报的帖子 id（举报评论时是评论所在的帖子）
   * @param {string} reason 原因 key（见 REPORT_REASONS）
   * @param {string} [detail] 补充说明，最多 200 字
   * @param {string} [commentId] 被举报的评论 id；不填就是举报帖子
   */
  function reportPost(postId, reason, detail, commentId) {
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

      var row = {
        post_id: postId,
        reporter_id: id.user.id,
        reason: key,
        detail: text || null,
        status: "open"
      };
      // 只有举报评论时才带 comment_id 这一列：老库里还没跑评论迁移时，
      // 帖子举报照常可用（带上不存在的列会让整个请求失败）。
      if (commentId) row.comment_id = commentId;

      return client.from("reports").insert(row).then(function (res) {
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
  var reportCommentId = null;
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
    reportCommentId = null;
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

        reportPost(reportPostId, reason, cur.detail ? cur.detail.value : "", reportCommentId)
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
   * 打开举报弹窗（帖子 / 评论共用）
   * @param {string} postId 被举报的帖子 id（举报评论时是评论所在的帖子）
   * @param {string} [commentId] 被举报的评论 id；不填就是举报帖子
   * @returns {boolean} 是否成功打开
   */
  function openReportDialog(postId, commentId) {
    if (blockIfNotReady(document.getElementById("notice"))) return false;

    var wrap = ensureReportDialog();
    if (!wrap) return false;

    reportPostId = postId;
    reportCommentId = commentId || null;

    // 弹窗是共用的一个，标题随举报对象切换
    var title = document.getElementById("report-modal-title");
    if (title) title.textContent = reportCommentId ? "举报这条评论" : "举报这条分享";

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

  /* 卡片上的「评论 / 回复 / 删除 / 举报」按钮统一在这里接管，各页面不用再写一遍 */
  document.addEventListener("click", function (e) {
    var el = e.target;
    if (!el || !el.closest) return;

    var reportBtn = el.closest("[data-report]");
    if (reportBtn) {
      openReportDialog(reportBtn.getAttribute("data-report"));
      return;
    }

    var reportCommentBtn = el.closest("[data-comment-report]");
    if (reportCommentBtn) {
      var rp = reportCommentBtn.closest("[data-post-id]");
      openReportDialog(rp ? rp.getAttribute("data-post-id") : null,
        reportCommentBtn.getAttribute("data-comment-report"));
      return;
    }

    var commentsBtn = el.closest("[data-comments]");
    if (commentsBtn) {
      toggleCommentZone(commentsBtn.getAttribute("data-comments"));
      return;
    }

    var sendBtn = el.closest("[data-comment-send]");
    if (sendBtn) {
      sendComment(sendBtn.getAttribute("data-comment-send"));
      return;
    }

    var replyBtn = el.closest("[data-comment-reply]");
    if (replyBtn) {
      var rZone = replyBtn.closest("[data-comment-zone]");
      if (rZone) startCommentReply(rZone.getAttribute("data-comment-zone"), replyBtn.getAttribute("data-comment-reply"));
      return;
    }

    var cancelBtn = el.closest("[data-comment-cancel]");
    if (cancelBtn) {
      var cZone = cancelBtn.closest("[data-comment-zone]");
      if (cZone) cancelCommentReply(cZone.getAttribute("data-comment-zone"));
      return;
    }

    var delBtn = el.closest("[data-comment-del]");
    if (delBtn) {
      var dZone = delBtn.closest("[data-comment-zone]");
      if (dZone) removeComment(dZone.getAttribute("data-comment-zone"), delBtn.getAttribute("data-comment-del"));
      return;
    }
  });

  /* ------------------------------------------------------------------
   * 6.6 我的举报回执（在「我的」页看自己举报过的内容处理得怎样了）
   *     · 数据库只允许读到自己的举报（RLS：reporter_id = auth.uid()）
   *     · 被举报的内容若已删除或不再公开，关联结果就是 null，这里照样显示状态
   * ------------------------------------------------------------------ */

  var REPORT_COLUMNS = "id, reason, detail, status, created_at, comment_id, " +
    "posts(id, content, display_name, is_anonymous, status, created_at, image_path)";

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

    // 匿名帖用和卡片同一个编号（anonName 按帖子 id 现算）；
    // 接口没把帖子 id 嵌进来时（老数据）anonName 会回退成「匿名同学」。
    var who = post.is_anonymous ? anonName(post) : (String(post.display_name || "").trim() || "同学");
    if (!text) return "「" + who + "」发的一张图片";
    return "「" + who + "」：" + text;
  }

  /**
   * 一条举报回执
   * @param {object} report listMyReports() 里的一行
   */
  function renderReportReceipt(report) {
    var r = report || {};
    var isComment = !!r.comment_id;

    var quote = isComment
      ? "你举报的评论（属于：" + escapeHtml(reportedExcerpt(r.posts)) + "）"
      : escapeHtml(reportedExcerpt(r.posts));

    var meta = (isComment ? "举报对象：评论 · " : "") +
      "举报原因：" + escapeHtml(reportReasonLabel(r.reason)) +
      (r.detail ? " · 你写的说明：" + escapeHtml(r.detail) : "");

    return '<div class="receipt">' +
        '<div class="receipt-top">' +
          '<span class="tag ' + reportStatusClass(r.status) + '">' +
            escapeHtml(reportStatusLabel(r.status)) + "</span>" +
          '<span class="receipt-time">' + escapeHtml(timeAgo(r.created_at)) + "</span>" +
        "</div>" +
        '<div class="receipt-quote">' + quote + "</div>" +
        '<div class="receipt-meta">' + meta + "</div>" +
        '<div class="receipt-note">' + escapeHtml(reportStatusNote(r.status)) + "</div>" +
      "</div>";
  }

  /* ------------------------------------------------------------------
   * 6.7 评论与回复（只支持两级：顶层评论 + 回复）
   *     · 先发后审：发出即刻公开显示，被举报后由站点主人下架；
   *     · 回复只会挂在顶层评论下（数据库触发器同样只接受两级）；
   *     · 读的是视图 post_comments：读不到 author_id，is_mine 标记本人；
   *     · 评论区懒加载：点卡片上的「💬 N」才拉取。
   * ------------------------------------------------------------------ */

  var COMMENT_MAX = 300;
  var COMMENT_COLUMNS = "id, post_id, parent_id, is_anonymous, display_name, school, content, created_at, is_mine";

  /** 取某条帖子下的公开评论（时间正序：顶层与回复都在同一个列表里） */
  function listComments(postId, limit) {
    if (!client) return Promise.reject(new Error(configError));
    return client.from("post_comments")
      .select(COMMENT_COLUMNS)
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(limit || 200)
      .then(function (res) {
        if (res.error) throw new Error("评论加载失败：" + res.error.message);
        return res.data || [];
      });
  }

  /** 给一批帖子补上评论数（读不到就按 0，不影响列表本身） */
  function attachComments(posts) {
    if (!posts.length) return Promise.resolve(posts);

    var ids = posts.map(function (p) { return p.id; });

    return client.from("post_comment_counts").select("post_id, comment_count").in("post_id", ids)
      .then(function (res) {
        var counts = {};
        var rows = (res && res.data) || [];
        rows.forEach(function (r) { counts[r.post_id] = r.comment_count || 0; });
        posts.forEach(function (p) { p.comment_count = counts[p.id] || 0; });
        return posts;
      })
      .catch(function () {
        posts.forEach(function (p) { p.comment_count = 0; });
        return posts;
      });
  }

  /**
   * 发布评论 / 回复
   * @param {string} postId   帖子 id
   * @param {string} content  评论内容（最多 300 字）
   * @param {string} [parentId] 回复的顶层评论 id；不填就是顶层评论
   */
  function addComment(postId, content, parentId) {
    if (!client) return Promise.reject(new Error(configError));
    if (!postId) return Promise.reject(new Error("没找到要评论的帖子，刷新一下再试"));

    var text = String(content == null ? "" : content).trim();
    if (!text) return Promise.reject(new Error("先写点什么再发吧"));
    if (text.length > COMMENT_MAX) return Promise.reject(new Error("评论最多 " + COMMENT_MAX + " 个字"));

    return getIdentity().then(function (id) {
      if (!id.user) throw new Error("请先登录或匿名进入，再评论");

      return getProfile().then(function (profile) {
        return client.from("comments").insert({
          post_id: postId,
          author_id: id.user.id,
          parent_id: parentId || null,
          is_anonymous: false,
          display_name: buildDisplayName(profile, id),
          school: (profile && profile.school) || null,
          content: text,
          status: "approved"
        }).then(function (res) {
          if (!res.error) return { parentId: parentId || null };

          var msg = String(res.error.message || "");
          if (/父评论/.test(msg)) throw new Error("这条评论刚刚被下架了，换一条回复吧");
          throw new Error("评论没发上：" + (msg || "请稍后重试"));
        });
      });
    });
  }

  /** 删除自己的一条评论（数据库只放行本人的删除） */
  function deleteComment(commentId) {
    if (!client) return Promise.reject(new Error(configError));
    return client.from("comments").delete().eq("id", commentId).then(function (res) {
      if (res.error) throw new Error("删除失败：" + res.error.message);
    });
  }

  /* ---- 评论区 UI：懒加载，点「💬 N」才拉取 ---- */

  var commentZoneState = {};   // postId -> { open, loaded, loading, sending, comments, replyTo, draft }

  function commentState(postId) {
    var st = commentZoneState[postId];
    if (!st) {
      st = { open: false, loaded: false, loading: false, sending: false, comments: [], replyTo: null, draft: "" };
      commentZoneState[postId] = st;
    }
    return st;
  }

  function commentZoneEl(postId) {
    var zones = document.querySelectorAll("[data-comment-zone]");
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].getAttribute("data-comment-zone") === postId) return zones[i];
    }
    return null;
  }

  /** 列表里同一帖可能有多个「💬 N」按钮（广场 / 我的），一起更新 */
  function updateCommentCount(postId, count) {
    var btns = document.querySelectorAll("[data-comments]");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-comments") !== postId) continue;
      var num = btns[i].querySelector(".comment-count");
      if (num) num.textContent = count;
    }
  }

  /** 回复对象显示用的名字 */
  function replyTargetName(postId) {
    var st = commentState(postId);
    for (var i = 0; i < st.comments.length; i++) {
      if (st.comments[i].id === st.replyTo) {
        return st.comments[i].is_anonymous ? "匿名同学" :
          (String(st.comments[i].display_name || "").trim() || "一位同学");
      }
    }
    return "ta";
  }

  /** 一条评论（isReply = 缩进的回复） */
  function renderCommentItem(c, isReply) {
    var name = c.is_anonymous ? "匿名同学" : (String(c.display_name || "").trim() || "一位同学");

    var html = '<div class="comment' + (isReply ? " is-reply" : "") + '" data-comment-id="' + escapeHtml(c.id) + '">';

    html += '<div class="comment-head">';
    html += '<span class="comment-name">' + escapeHtml(name) + "</span>";
    if (c.school) html += '<span class="comment-school">' + escapeHtml(c.school) + "</span>";
    html += '<span class="comment-time">' + escapeHtml(timeAgo(c.created_at)) + "</span>";
    html += "</div>";

    html += '<div class="comment-body">' + escapeHtml(c.content) + "</div>";

    html += '<div class="comment-actions">';
    html += '<button class="link-plain" type="button" data-comment-reply="' + escapeHtml(c.id) + '">回复</button>';
    if (c.is_mine) {
      html += '<button class="link-plain" type="button" data-comment-del="' + escapeHtml(c.id) + '">删除</button>';
    }
    html += '<button class="link-plain" type="button" data-comment-report="' + escapeHtml(c.id) + '">举报</button>';
    html += "</div></div>";
    return html;
  }

  /** 评论输入框 + 发送按钮（draft 存在状态里，重渲染不丢已输入的字） */
  function renderCommentFormHtml(postId, st) {
    var html = '<div class="comment-form">';

    if (st.replyTo) {
      html += '<div class="comment-reply-chip">回复 <strong>' + escapeHtml(replyTargetName(postId)) + "</strong>" +
        '<button class="link-plain" type="button" data-comment-cancel="' + escapeHtml(postId) + '">取消</button></div>';
    }

    html += '<textarea class="comment-input" rows="2" maxlength="' + COMMENT_MAX + '"' +
      ' data-comment-input="' + escapeHtml(postId) + '"' +
      ' placeholder="' + (st.replyTo ? "回复 ta…（最多 " + COMMENT_MAX + " 字）" : "友善地说点什么…（最多 " + COMMENT_MAX + " 字）") + '">' +
      escapeHtml(st.draft || "") + "</textarea>";

    html += '<div class="comment-form-foot">';
    html += '<span class="comment-hint" data-comment-hint="' + escapeHtml(postId) + '" hidden></span>';
    html += '<button class="btn btn-primary btn-sm" type="button" data-comment-send="' + escapeHtml(postId) + '">' +
      (st.replyTo ? "回复" : "发布") + "</button>";
    html += "</div></div>";
    return html;
  }

  /** 整个评论区（懒加载完成后调用；回复的父评论查不到时按顶层显示） */
  function renderCommentZone(postId) {
    var zone = commentZoneEl(postId);
    if (!zone) return;
    var st = commentState(postId);

    if (st.loading) {
      zone.innerHTML = '<div class="comment-empty">正在加载评论…</div>';
      return;
    }

    var list = st.comments || [];
    var top = [];
    var byId = {};
    var childrenOf = {};

    list.forEach(function (c) { byId[c.id] = c; });
    list.forEach(function (c) {
      if (c.parent_id && byId[c.parent_id]) {
        (childrenOf[c.parent_id] = childrenOf[c.parent_id] || []).push(c);
      } else {
        top.push(c);
      }
    });

    var html = '<div class="comment-list">';
    if (!list.length) {
      html += '<div class="comment-empty">还没有评论，来坐第一个沙发。</div>';
    } else {
      top.forEach(function (c) {
        html += renderCommentItem(c, false);
        (childrenOf[c.id] || []).forEach(function (k) { html += renderCommentItem(k, true); });
      });
    }
    html += "</div>";

    html += renderCommentFormHtml(postId, st);
    zone.innerHTML = html;
  }

  /** 只重渲染表单区域（点「回复 / 取消」用，不动下面的评论列表） */
  function renderCommentFormOnly(postId) {
    var zone = commentZoneEl(postId);
    if (!zone) return;
    var form = zone.querySelector(".comment-form");
    if (!form) {
      renderCommentZone(postId);
      return;
    }
    form.outerHTML = renderCommentFormHtml(postId, commentState(postId));
  }

  function focusCommentInput(postId) {
    var zone = commentZoneEl(postId);
    if (!zone) return;
    var input = zone.querySelector(".comment-input");
    if (input && input.focus) input.focus();
  }

  function showCommentHint(postId, text, type) {
    var zone = commentZoneEl(postId);
    if (!zone) return;
    var hint = zone.querySelector("[data-comment-hint]");
    if (!hint) return;
    hint.hidden = false;
    hint.className = "comment-hint" + (type ? " " + type : "");
    hint.textContent = text;
  }

  function setCommentSending(postId, on) {
    var zone = commentZoneEl(postId);
    if (!zone) return;
    var btn = zone.querySelector("[data-comment-send]");
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? "发送中…" : (commentState(postId).replyTo ? "回复" : "发布");
  }

  /* ---- 交互：展开 / 收起、发送、删除、回复 ---- */

  function toggleCommentZone(postId) {
    var st = commentState(postId);
    var zone = commentZoneEl(postId);
    if (!zone) return;

    if (st.open) {
      st.open = false;
      zone.hidden = true;
      return;
    }

    st.open = true;
    zone.hidden = false;
    if (st.loaded || st.loading) {
      renderCommentZone(postId);
    } else {
      refreshCommentZone(postId);
    }
  }

  /** 拉取评论并渲染（loading → 列表；失败就给一句提示） */
  function refreshCommentZone(postId) {
    var st = commentState(postId);
    if (st.loading) return Promise.resolve();
    st.loading = true;
    renderCommentZone(postId);

    return listComments(postId).then(function (comments) {
      st.loading = false;
      st.loaded = true;
      st.comments = comments;
      updateCommentCount(postId, comments.length);
      renderCommentZone(postId);
    }).catch(function (err) {
      st.loading = false;
      var zone = commentZoneEl(postId);
      if (zone) {
        zone.innerHTML = '<div class="comment-empty">' +
          escapeHtml(err.message || "评论暂时加载不出来，稍后再试") + "</div>";
      }
    });
  }

  function sendComment(postId) {
    var st = commentState(postId);
    if (st.sending) return;

    var text = String(st.draft || "").trim();
    if (!text) {
      showCommentHint(postId, "先写点什么再发吧", "warn");
      return;
    }

    st.sending = true;
    setCommentSending(postId, true);

    addComment(postId, text, st.replyTo).then(function () {
      st.sending = false;
      st.draft = "";
      st.replyTo = null;
      return refreshCommentZone(postId).then(function () {
        focusCommentInput(postId);
      });
    }).catch(function (err) {
      st.sending = false;
      setCommentSending(postId, false);
      showCommentHint(postId, err.message, "error");
    });
  }

  function removeComment(postId, commentId) {
    if (!confirm("确定要删除这条评论吗？删掉就不能恢复了。")) return;

    deleteComment(commentId).then(function () {
      var st = commentState(postId);
      st.replyTo = null;
      return refreshCommentZone(postId);
    }).catch(function (err) {
      showCommentHint(postId, err.message, "error");
    });
  }

  /**
   * 点「回复」：数据库只接受两级，所以回复的回复要挂回它的顶层评论，
   * 和 FAQ 里「回复的回复会挂在同一条评论下面」的说法保持一致；
   * 若上一层已经被下架（孤儿回复），直接给提示，不进回复态。
   */
  function startCommentReply(postId, commentId) {
    var st = commentState(postId);
    var target = null;
    for (var i = 0; i < st.comments.length; i++) {
      if (st.comments[i].id === commentId) { target = st.comments[i]; break; }
    }

    var anchor = commentId;
    if (target && target.parent_id) {
      var parentVisible = false;
      for (var j = 0; j < st.comments.length; j++) {
        if (st.comments[j].id === target.parent_id) { parentVisible = true; break; }
      }
      if (!parentVisible) {
        showCommentHint(postId, "上一层评论已被下架，这条评论暂时回复不了", "warn");
        return;
      }
      anchor = target.parent_id;
    }

    st.replyTo = anchor;
    renderCommentFormOnly(postId);
    focusCommentInput(postId);
  }

  function cancelCommentReply(postId) {
    var st = commentState(postId);
    st.replyTo = null;
    renderCommentFormOnly(postId);
    focusCommentInput(postId);
  }

  /* 评论输入：内容存进状态（重渲染不丢）；Enter 发送、Shift+Enter 换行 */
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!el || el.getAttribute === undefined) return;
    var postId = el.getAttribute("data-comment-input");
    if (!postId) return;
    var st = commentZoneState[postId];
    if (st) st.draft = el.value;
  });

  document.addEventListener("keydown", function (e) {
    var el = e.target;
    if (!el || el.getAttribute === undefined) return;
    var postId = el.getAttribute("data-comment-input");
    if (!postId) return;
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;   // 中文输入法组词中的回车上屏，不算发送
    e.preventDefault();
    sendComment(postId);
  });

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
      var code = anonCode(post) || anonCodeOf(post && post.id);
      // 拿不到号（老数据、或 id 缺失）时保持原来的月亮头像
      if (!code) return '<div class="avatar anon" aria-hidden="true">🌙</div>';
      // 同一个号 → 同一个色带 + 同一个字形，让「又是这位同学」一眼看得出。
      // 用 data-hue-band 交给 CSS 配色，不用行内 style（将来加 CSP 也不用放开）。
      var band = parseInt(code.slice(0, 2), 16) % 12;
      return '<div class="avatar anon" data-hue-band="' + band + '" aria-hidden="true">' +
             escapeHtml(code.slice(0, 1)) + "</div>";
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

  /**
   * 匿名帖的「帖子编号」（S1 探针阶段留下的每帖编号，现在是稳定洞号的兜底）
   *
   * 由帖子自己的 id 哈希出来的 6 位十六进制，用来让读者能指代某一条匿名帖
   * （「#3F9A21 说得对」），而不是三条匿名帖看起来都叫「匿名同学」。
   *
   * D1 之后：能读到数据库那一列（`anon_code`，跨帖稳定）时优先用它，这个函数
   * 只在「库还没迁移」或老数据缺值时兜底 —— 两种号的形状一样（六位大写十六进制），
   * 但**含义不同**：这里算出来的是每帖一个号，不跨帖关联。所以文案里始终只
   * 说「编号」，不说「你的固定号」（固定号由数据库那列负责）。
   *
   * 三个刻意的限制：
   *  - **每帖一个号**：同一个人的两条匿名帖号不同，跨帖不关联（这是「会话级
   *    匿名」，不是「你的固定匿名号」）。所以文案里绝不能宣传成固定号。
   *  - **不是 id 片段**：走哈希而不是 `post.id.slice(0, 6)`，避免界面上出现
   *    看似可拼回原 id 的编号（虽然 id 本来就公开，但编号不该长得像它的一部分）。
   *  - **不参与过滤与排序**：只用于展示，别拿它做 `eq` / `order`。
   *
   * id 缺失时返回空串，由调用方回退成原来的「匿名同学」——宁可回到旧文案，
   * 也不要凭空编一个号出来。
   */
  function anonCodeOf(id) {
    var s = String(id == null ? "" : id).replace(/-/g, "");
    if (!s) return "";
    var h = 2166136261;                       // FNV-1a 32 位
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;       // imul 避免大数相乘丢精度
    }
    return ("00000" + h.toString(16).toUpperCase()).slice(-6);
  }

  /** 匿名帖的显示名；拿不到编号就退回旧文案 */
  function anonName(post) {
    var code = anonCode(post) || anonCodeOf(post && post.id);
    return code ? "匿名 #" + code : "匿名同学";
  }

  /**
   * 取数据库给的稳定洞号（D1 之后每个匿名帖都带这一列）
   *
   * 只接受「六位十六进制」这种形状：号是给人看的标识，不是数据通道 ——
   * 接口万一返回别的形状（空串、带空格的脏值、将来的新格式），宁可退回
   * 前端自己算的每帖编号，也不要把它原样印到界面上。
   */
  function anonCode(post) {
    var raw = String((post && post.anon_code) || "").trim().toUpperCase();
    return /^[0-9A-F]{6}$/.test(raw) ? raw : "";
  }

  /** 渲染单条帖子卡片 */
  function renderPostCard(post) {
    var url = imageUrl(post.image_path);
    var name = post.is_anonymous ? anonName(post) : (post.display_name || "一位同学");

    var meta = [];
    if (post.school) meta.push(escapeHtml(post.school));
    // 城市圈（B5）：圈名是按校名在本机算出来的，比校名更粗，不额外暴露什么
    if (post.circle_name) {
      meta.push('<span class="post-circle">🏙 ' + escapeHtml(post.circle_name) + "</span>");
    }
    meta.push(timeAgo(post.created_at));

    var html = '<article class="card post" data-post-id="' + escapeHtml(post.id) + '">';

    html += '<div class="post-head">';
    html += avatarHtml(post);
    html += '<div class="post-meta">';
    html += '<div class="post-name">' + escapeHtml(name);
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
    html += '<button class="like-btn comment-btn" type="button" data-comments="' + escapeHtml(post.id) + '">';
    html += "<span>💬</span>";
    html += '<span class="comment-count">' + (post.comment_count || 0) + "</span>";
    html += "</button>";
    html += '<span class="post-time">' + escapeHtml(timeAgo(post.created_at)) + "</span>";
    html += '<button class="link-plain report-btn" type="button" data-report="' + escapeHtml(post.id) +
      '">举报</button>';
    html += "</div>";
    // 评论区：懒加载，点上面的「💬 N」才拉取
    html += '<div class="comments" data-comment-zone="' + escapeHtml(post.id) + '" hidden></div>';
    html += "</article>";

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
   * 保存成功后顺带调用数据库函数 sync_my_display_name，把本人历史帖子 / 评论的
   * 署名刷成新昵称（只改自己、不动匿名内容；函数还没部署时忽略失败，不影响改名本身）。
   * @param {string} nickname 最多 20 个字，空字符串表示清空
   * @returns {Promise<{name: string, synced: number|null}>}
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
          return client.rpc("sync_my_display_name").then(function (rres) {
            var n = (rres && !rres.error && typeof rres.data === "number") ? rres.data : null;
            return { name: name, synced: n };
          }).catch(function () {
            return { name: name, synced: null };   // 同步失败不影响「昵称已保存」
          });
        });
    });
  }

  /* ------------------------------------------------------------------
   * 9. 意见反馈
   *    任何访客都能提交 —— 不要求登录，也不要求先「匿名进入」。
   *    数据库那边（docs/supabase-feedback.sql）只给 feedback 表开了
   *    insert 策略，没有 select 策略：提交完连提交者自己都读不回来，
   *    只有站主用 service_role 在后台看得到。
   *    所以这里刻意不取 getIdentity()：反馈和「你是谁」无关。
   * ------------------------------------------------------------------ */

  var FEEDBACK_MAX = 500;
  var FEEDBACK_DEVICES = ["desktop", "tablet", "phone", "other"];

  /** 按 UA 猜一个设备选项（页面上会预选好，用户可以改） */
  function guessDevice(ua) {
    var s = String(
      ua == null
        ? (typeof navigator !== "undefined" && navigator && navigator.userAgent) || ""
        : ua
    ).toLowerCase();

    if (/ipad|tablet|kindle|silk|playbook/.test(s)) return "tablet";
    if (/mobi|android|iphone|ipod|phone/.test(s)) return "phone";
    if (/windows|macintosh|mac os x|linux|cros|desktop/.test(s)) return "desktop";
    return "other";
  }

  /**
   * 提交一条意见反馈。
   * @param {{device?: string, content: string, contact?: string}} o
   * @returns {Promise<{device: string}>}
   */
  function sendFeedback(o) {
    if (!client) return Promise.reject(new Error(configError));
    o = o || {};

    var device = String(o.device == null ? "" : o.device).trim();
    if (FEEDBACK_DEVICES.indexOf(device) < 0) device = "other";

    var content = String(o.content == null ? "" : o.content).trim();
    if (!content) return Promise.reject(new Error("写点什么再提交吧"));
    if (content.length > FEEDBACK_MAX) {
      return Promise.reject(new Error("最多 " + FEEDBACK_MAX + " 字，现在有 " + content.length + " 字"));
    }

    var contact = String(o.contact == null ? "" : o.contact).trim();
    if (contact.length > 100) contact = contact.slice(0, 100);

    // 只提交这三列：数据库只授予了这三列的 insert 权限（id 与 created_at
    // 由数据库默认值生成，提交者改不了）。
    // 这里绝不能接 .select()：feedback 没有 select 策略也没有 select 权限，
    // 接上必然 42501（和发帖那条 POST_COLUMNS 的坑是同一类）。
    var row = { device: device, content: content, contact: contact || null };

    return client.from("feedback").insert(row).then(function (res) {
      if (!res.error) return { device: device };

      var msg = String(res.error.message || "");
      var code = String(res.error.code || "");
      // 还没跑迁移时的兜底：给一句能照着做的提示，而不是甩一个关系名错误
      if (code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(msg)) {
        throw new Error("反馈功能还没部署：请在 Supabase 的 SQL Editor 执行 docs/supabase-feedback.sql（详见 README）");
      }
      throw new Error("反馈没提交上：" + (msg || "请稍后重试"));
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
   * 页头「登录 / 注册」入口：未登录 / 匿名时保持醒目，已登录时收起。
   * 各页面头部自带 <a class="header-login">，这里只按身份切换显示与文案。
   * ------------------------------------------------------------------ */
  (function initHeaderLogin() {
    if (typeof document.querySelectorAll !== "function") return;
    function sync() {
      var nodes = document.querySelectorAll(".header-login");
      if (!nodes.length || !client) return;
      getIdentity().then(function (id) {
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var label = el.querySelector ? el.querySelector(".header-login-text") : null;
          if (id.user && !id.isAnonymous) {
            el.hidden = true;                      /* 已登录：身份在「我的」页里 */
          } else {
            el.hidden = false;
            if (label) label.textContent = id.user ? "注册账号" : "登录 / 注册";
          }
        }
      });
    }
    sync();
    onAuthChange(sync);
  })();

  /* ------------------------------------------------------------------
   * 10. 密保问题与找回密码（站主 2026-09-29 拍板新增）
   * ------------------------------------------------------------------
   * 为什么必须这么绕：
   *   · 账号邮箱是伪邮箱 `<手机号>@students.local`（见 phoneToEmail），
   *     这个域名收不到信 —— Supabase 自带的「邮件找回」在本站是死的；
   *   · 未登录时用 anon key 没有任何改密码的接口，改别人的密码必须
   *     service_role，而它绝不能进浏览器。
   * 所以自助找回只能走「密保问题 + 一个持 service_role 的服务端函数」。
   *
   * 三件事各自的分工（都不新增「前端能读别人数据」的通道）：
   *   1) 登记 / 改密保：rpc("set_security_answer")，答案的归一化与哈希
   *      都在数据库里做一份实现（前端不碰哈希，也不往外存答案明文）；
   *   2) 看自己有没有登记：只读视图 my_security_answer（只有问题与时间，
   *      连答案指纹都不给前端）；
   *   3) 找回密码：POST 到 Edge Function functions/v1/reset-password，
   *      由它在服务端核对答案并调 Auth Admin API 改密码。
   * ------------------------------------------------------------------ */

  /** 三选一密保问题：id 必须与 docs/supabase-security-question.sql 的 CHECK 一致 */
  var SECURITY_QUESTIONS = [
    { id: "primary_school",  text: "你的小学叫什么名字？" },
    { id: "teacher_surname", text: "你最喜欢的一位老师姓什么？" },
    { id: "home_city",       text: "你家乡所在的城市叫什么？" }
  ];
  var SECURITY_ANSWER_MAX = 60;
  var RESET_FUNCTION_NAME = "reset-password";
  var RESET_TIMEOUT_MS = 20000;

  function securityQuestions() { return SECURITY_QUESTIONS.slice(); }

  /** 问题文案；id 不认识时返回空串（调用方据此判断合法性） */
  function securityQuestionText(id) {
    for (var i = 0; i < SECURITY_QUESTIONS.length; i++) {
      if (SECURITY_QUESTIONS[i].id === id) return SECURITY_QUESTIONS[i].text;
    }
    return "";
  }

  /** 答案的比对口径（去空白 + 转小写）在数据库里；这里只做同样的长度校验 */
  function normalizeAnswer(raw) {
    return String(raw == null ? "" : raw).replace(/\s/g, "");
  }

  /**
   * 登记 / 修改密保（登录用户）。
   * @param {string} questionId 三个 id 之一
   * @param {string} answer 答案原文（归一化与哈希由数据库完成）
   */
  function saveSecurityAnswer(questionId, answer) {
    if (!client) return Promise.reject(new Error(configError));

    var q = String(questionId == null ? "" : questionId).trim();
    if (!securityQuestionText(q)) return Promise.reject(new Error("先选一个问题"));

    var norm = normalizeAnswer(answer);
    if (!norm) return Promise.reject(new Error("答案是空的"));
    if (norm.length > SECURITY_ANSWER_MAX) {
      return Promise.reject(new Error("答案最多 " + SECURITY_ANSWER_MAX + " 个字，现在有 " + norm.length + " 字"));
    }

    return client.rpc("set_security_answer", {
      p_question_id: q,
      p_answer: String(answer == null ? "" : answer)
    }).then(function (res) {
      if (!res.error) return { questionId: q };
      throw new Error(securityDbError(res.error));
    });
  }

  /** 当前账号登记过的密保问题；没登记（或还没跑迁移）返回 null */
  function getSecurityQuestion() {
    if (!client) return Promise.resolve(null);
    return client.from("my_security_answer").select("question_id, updated_at").maybeSingle()
      .then(function (res) {
        if (res.error) return null;
        return res.data || null;
      })
      .catch(function () { return null; });
  }

  /** 把密保相关的数据库报错翻译成「照着做就行」的中文 */
  function securityDbError(err) {
    var msg = String((err && err.message) || "");
    var code = String((err && err.code) || "");
    // 迁移没跑：表 / 视图 / 函数不存在，或 PostgREST 还没刷新 schema 缓存
    // （42501 只在报错里点名 set_security_answer 时才算「没部署」，否则是别的权限问题）
    if (code === "42P01" || code === "42883" ||
        (code === "42501" && /set_security_answer/i.test(msg)) ||
        code === "PGRST202" || code === "PGRST205" ||
        /does not exist|schema cache|could not find the function/i.test(msg)) {
      return "密保功能还没部署：请在 Supabase 的 SQL Editor 执行 " +
             "docs/supabase-security-question.sql（详见 README）";
    }
    // RPC 里 raise exception 抛出的中文（「答案是空的」这类）原样展示
    if (/[\u4e00-\u9fa5]/.test(msg)) return msg;
    return msg || "密保没存上，请稍后重试";
  }

  /**
   * 忘记密码：手机号 + 密保答案 + 新密码 -> 交给服务端函数改密。
   * 这里只用 anon key 调 Edge Function，service_role 只在函数里出现。
   * 用 fetch 而不是 client.functions.invoke：要自己控制超时，并把
   * 「函数没部署（404）」「忘了关 JWT 校验（401）」翻译成人话。
   */
  function resetPasswordWithAnswer(phone, answer, newPassword) {
    if (!client || !cfg.SUPABASE_URL) return Promise.reject(new Error(configError));

    var p = normalizePhone(phone);
    if (!isValidPhone(p)) return Promise.reject(new Error("请输入 11 位手机号"));

    var norm = normalizeAnswer(answer);
    if (!norm) return Promise.reject(new Error("请填写密保答案"));
    if (norm.length > SECURITY_ANSWER_MAX) {
      return Promise.reject(new Error("答案最多 " + SECURITY_ANSWER_MAX + " 个字"));
    }
    if (!newPassword || newPassword.length < 6) {
      return Promise.reject(new Error("新密码至少 6 位"));
    }

    var url = String(cfg.SUPABASE_URL).replace(/\/+$/, "") + "/functions/v1/" + RESET_FUNCTION_NAME;
    var ctl = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, RESET_TIMEOUT_MS);

    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY
      },
      // 答案按原文发过去：归一化只在数据库那一处做，避免两份实现走偏
      body: JSON.stringify({
        phone: p,
        answer: String(answer == null ? "" : answer),
        new_password: newPassword
      }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (res.ok && data && data.ok) {
          return { message: data.message || "密码已重置，请用新密码登录" };
        }
        throw new Error(resetFunctionError(res.status, data));
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && (err.name === "AbortError" || /aborted/i.test(String(err.message || "")))) {
        throw new Error("请求没有响应（可能网络被拦了），稍后再试，或者联系站主");
      }
      throw err;
    });
  }

  /** 把 Edge Function 的响应翻译成给同学看的中文 */
  function resetFunctionError(status, data) {
    var code = String((data && data.code) || "");
    var msg = String((data && data.message) || "");

    if (code === "mismatch") return "手机号或密保答案不对。也可以换一个问题对应的答案再试一次。";
    if (code === "locked") return "试得有点多，请 15 分钟后再试。";
    if (code === "invalid_input") return msg || "填写的内容不合法";
    if (code === "not_configured") return "服务端还没配置好，请联系站主";
    if (status === 404) {
      return "找回密码功能还没部署：请在 Supabase 后台部署 reset-password 函数" +
             "（见 docs/edge-functions/reset-password/README.md）";
    }
    if (status === 401 || status === 403) {
      return "找回密码功能还没配置好：那个函数需要关闭「Enforce JWT Verification」（见部署说明）";
    }
    if (status >= 500) return "服务端出了点问题，稍后再试，或者联系站主";
    return msg || "改密码没成功，请稍后重试";
  }

  /* ------------------------------------------------------------------
   * 11. 导出
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

    // 学校（任务 D2：固定列表 + 别名归一，cityOf 供「只看同城」用）
    schoolOf: canonicalSchool,
    cityOf: cityOfSchool,
    schoolOptions: schoolOptions,

    // 城市圈（B5）：选圈只存本机，只影响广场的排序与「只看本圈」
    listCircles: listCircles,
    getCircle: getCircle,
    setCircle: setCircle,
    circleName: circleName,
    circleOfSchool: circleOfSchool,
    myCircle: myCircle,
    CIRCLE_KEY: CIRCLE_KEY,

    // 数据
    createPost: createPost,
    listPosts: listPosts,
    listCirclePosts: listCirclePosts,
    listFeedPosts: listFeedPosts,
    mergeFeedPosts: mergeFeedPosts,
    listCircleHotwords: listCircleHotwords,
    filterPostsByTerm: filterPostsByTerm,
    listMyPosts: listMyPosts,
    deletePost: deletePost,
    toggleLike: toggleLike,
    imageUrl: imageUrl,
    saveNickname: saveNickname,

    // 评论
    listComments: listComments,
    addComment: addComment,
    deleteComment: deleteComment,
    COMMENT_MAX: COMMENT_MAX,
    buildDisplayName: buildDisplayName,

    // 图片：compressImage 是「上传前压缩」的入口，
    // uploadImage 平时由 createPost 调用，导出出来是为了能单独自测。
    compressImage: compressImage,
    uploadImage: uploadImage,

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
    anonCodeOf: anonCodeOf,
    anonName: anonName,
    // D1：服务端稳定洞号（形状不对时返回空串）+ 「这个库有没有迁移过」的探测结果
    anonCode: anonCode,
    anonCodeSupported: function () { return anonCodeColumnOk; },
    avatarHtml: avatarHtml,
    statusTag: statusTag,
    showNotice: showNotice,
    hideNotice: hideNotice,
    markTabbar: markTabbar,
    blockIfNotReady: blockIfNotReady,
    setupCard: setupCard,
    setupHint: setupHint,
    debounce: debounce,

    // 意见反馈
    sendFeedback: sendFeedback,
    guessDevice: guessDevice,
    FEEDBACK_MAX: FEEDBACK_MAX,
    FEEDBACK_DEVICES: FEEDBACK_DEVICES,

    // 密保问题与找回密码：答案的归一化/哈希都在数据库，前端只收发结果
    securityQuestions: securityQuestions,
    securityQuestionText: securityQuestionText,
    saveSecurityAnswer: saveSecurityAnswer,
    getSecurityQuestion: getSecurityQuestion,
    resetPasswordWithAnswer: resetPasswordWithAnswer,
    SECURITY_ANSWER_MAX: SECURITY_ANSWER_MAX
  };
})();
