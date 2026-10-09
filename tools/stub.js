/* =====================================================================
 *  duktape 测试环境 stub（仅供本地验证使用，不属于网站代码）
 *  提供：最小 DOM、同步版 Promise、Supabase 客户端 mock、调用记录
 *  文件内容保持 ASCII。
 * ===================================================================== */

/* ------------------------------ 记录 ------------------------------ */
var __timers = [];
var __logs = [];
var __calls = [];
var __heldStats = [];   // 「统计请求先扣着不放」时，被扣下的那些请求（见 __releaseStats）

/* A6：把 post_likes / post_comment_counts 的结果先扣在手里不放，直到测试调
   __releaseStats()。用来复现真实网络里「帖子先到、计数晚半拍」的那一段。 */
function __releaseStats() {
  var hs = __heldStats;
  __heldStats = [];
  for (var i = 0; i < hs.length; i++) { hs[i](); }
  return hs.length;
}

function __log(x) { __logs.push(String(x)); }

/* --------------------- Promise（同步执行，测试用） --------------------- */
function __flush(p) {
  if (!p.state || !p.handlers.length) return;
  var hs = p.handlers;
  p.handlers = [];
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i];
    var fn = (p.state === 1) ? h.onOk : h.onErr;
    if (typeof fn !== 'function') {
      if (p.state === 1) { h.resolve(p.value); } else { h.reject(p.value); }
      continue;
    }
    try { h.resolve(fn(p.value)); } catch (e) { h.reject(e); }
  }
}

function P(executor) {
  var self = this;
  self.state = 0;
  self.value = undefined;
  self.handlers = [];

  function resolve(v) {
    if (v && typeof v.then === 'function') { v.then(resolve, reject); return; }
    if (self.state) return;
    self.state = 1;
    self.value = v;
    __flush(self);
  }
  function reject(e) {
    if (self.state) return;
    self.state = 2;
    self.value = e;
    __flush(self);
  }

  try { executor(resolve, reject); } catch (e) { reject(e); }
}

P.prototype.then = function (onOk, onErr) {
  var self = this;
  return new P(function (resolve, reject) {
    self.handlers.push({ onOk: onOk, onErr: onErr, resolve: resolve, reject: reject });
    __flush(self);
  });
};

P.prototype['catch'] = function (onErr) { return this.then(null, onErr); };

P.prototype['finally'] = function (fn) {
  return this.then(function (v) { fn(); return v; }, function (e) { fn(); throw e; });
};

P.resolve = function (v) { return new P(function (r) { r(v); }); };
P.reject = function (e) { return new P(function (r, j) { j(e); }); };

/* ------------------------------ DOM ------------------------------ */
var __elements = {};

function __cls(el) {
  function sync() {
    var out = [];
    for (var k in this._s) { if (this._s[k]) { out.push(k); } }
    el.className = out.join(' ');
  }
  return {
    _s: {},
    add: function (c) { this._s[c] = true; sync.call(this); },
    remove: function (c) { this._s[c] = false; sync.call(this); },
    toggle: function (c, force) {
      if (force === undefined) { this._s[c] = !this._s[c]; } else { this._s[c] = !!force; }
      sync.call(this);
      return this._s[c];
    },
    contains: function (c) { return !!this._s[c]; }
  };
}

function __el(id) {
  var el = {
    id: id,
    tagName: 'DIV',
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    className: '',
    style: {},
    disabled: false,
    checked: false,
    files: null,
    src: '',
    _h: {},
    _children: [],
    _attrs: {}
  };
  el.classList = __cls(el);

  el.addEventListener = function (t, fn) { (el._h[t] = el._h[t] || []).push(fn); };
  el.removeEventListener = function () {};
  el.dispatch = function (t, ev) {
    var a = el._h[t] || [];
    for (var i = 0; i < a.length; i++) { a[i](ev || { target: el, preventDefault: function () {} }); }
  };
  el.getAttribute = function (n) { return el._attrs[n] === undefined ? null : el._attrs[n]; };
  el.setAttribute = function (n, v) { el._attrs[n] = v; };
  el.removeAttribute = function (n) { delete el._attrs[n]; };
  el.querySelectorAll = function () { return []; };
  el.querySelector = function () { return null; };
  el.closest = function () { return null; };
  el.focus = function () {};
  el.click = function () { el.dispatch('click', { target: el, preventDefault: function () {} }); };
  el.appendChild = function (child) { el._children.push(child); return child; };
  el.firstElementChild = null;
  el.lastElementChild = null;

  return el;
}

var document = {
  title: '',
  getElementById: function (id) {
    if (!__elements[id]) { __elements[id] = __el(id); }
    return __elements[id];
  },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  addEventListener: function (t, fn) { (__docH[t] = __docH[t] || []).push(fn); },
  createElement: function (t) {
    var e = __el('_new');
    e.tagName = String(t).toUpperCase();
    /* WebP 能力探测：真浏览器里 canvas.toDataURL('image/webp') 会回
       'data:image/webp;...'（支持）或 'data:image/png;...'（不支持）。
       默认按「不支持」走（= JPEG），测试要覆盖支持 WebP 的那条分支就把
       __mockOpts.canvasWebp 设成 true。 */
    e.toDataURL = function (type) {
      var webp = false;
      try { webp = !!(__mockOpts && __mockOpts.canvasWebp); } catch (err) { webp = false; }
      return (webp && String(type).indexOf('webp') >= 0)
        ? 'data:image/webp;base64,AAAA'
        : 'data:image/png;base64,AAAA';
    };
    return e;
  }
};

/* 模拟 document.body：appendChild 会按 id 登记，这样 app.js 动态生成的
 * 举报弹窗在测试里也能通过 getElementById 拿到。 */
var __docH = {};
var __created = [];
document.body = __el('body');
document.body.appendChild = function (el) {
  __created.push(el);
  if (el && el.id) { __elements[el.id] = el; }
  return el;
};

/** 触发挂在其 tag 上的 document 事件（测试用） */
function __docEmit(type, ev) {
  var a = __docH[type] || [];
  for (var i = 0; i < a.length; i++) { a[i](ev); }
  return a.length;
}

var window = {
  CAMPUS_CONFIG: null,
  location: { href: '' },
  supabase: null
};

/* localStorage 的内存替身：城市圈的选择只存在本机，测试要能读写它
 * （真实浏览器里刷新后还在，所以这里也得是持久的，不能每次读都返回空）。 */
var __ls = {};
window.localStorage = {
  getItem: function (k) {
    return Object.prototype.hasOwnProperty.call(__ls, k) ? __ls[k] : null;
  },
  setItem: function (k, v) { __ls[k] = String(v); },
  removeItem: function (k) { delete __ls[k]; }
};

/* ------------------------------ 计时器 / 浏览器 API ------------------------------ */
function setTimeout(fn, ms) { __timers.push(fn); return __timers.length; }
function clearTimeout() {}
function confirm() { return true; }
function alert(m) { __log('alert: ' + m); }
function FileReader() { this.readAsDataURL = function () { __log('FileReader.readAsDataURL'); }; }

function __drain() {
  var t = __timers;
  __timers = [];
  for (var i = 0; i < t.length; i++) {
    try { t[i](); } catch (e) { __log('timer error: ' + e); }
  }
}

/* --------------------------- Supabase mock --------------------------- */
function __clone(o) {
  var r = {};
  for (var k in o) { if (o.hasOwnProperty(k)) { r[k] = o[k]; } }
  return r;
}

function __match(row, filters) {
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i];
    if (f[2]) { if (f[1].indexOf(row[f[0]]) < 0) return false; }
    else { if (row[f[0]] !== f[1]) return false; }
  }
  return true;
}

/**
 * 模拟数据库那边算出来的「稳定洞号」（D1 的 posts.anon_code 生成列）。
 *
 * 真实实现是 md5(author_id || 盐) 的前 6 位；这里只是一个确定性的替身：
 * 形状一样（6 位大写十六进制）、同一个人稳定、**故意和前端按帖子 id 算的
 * 每帖编号不同** —— 这样测试才能分辨「页面用的到底是服务端那列，还是兜底值」。
 */
function __serverCode(authorId) {
  var s = 'salt:' + String(authorId == null ? '' : authorId);
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ('00000' + h.toString(16).toUpperCase()).slice(-6);
}

/**
 * 「这一列还没迁移」：clientOpts.missingColumns 里写 `表.列`，
 * 请求里碰到它就照实回 Postgres 的 42703 —— 前端必须自己降级，
 * 而不是把整页读挂。
 *
 * posts.anon_code（D1 的生成列）默认按「库还没迁移」模拟：真实线上现在就是
 * 这个状态，前端必须能带着这列请求 → 拿到 42703 → 降级重试。
 * clientOpts.anonCodeColumn = true 才表示迁移已经跑过。
 */
function __missingColumn(clientOpts, st) {
  var miss = ((clientOpts && clientOpts.missingColumns) || []).slice();
  if (!(clientOpts && clientOpts.anonCodeColumn)) {
    miss.push('posts.anon_code', 'my_posts.anon_code');
  }
  if (!miss.length) return '';
  var cols = String(st.select || '').split(',');
  for (var c = 0; c < cols.length; c++) cols[c] = cols[c].replace(/\s/g, '');
  for (var i = 0; i < miss.length; i++) {
    var parts = String(miss[i]).split('.');
    if (parts.length !== 2 || parts[0] !== st.table) continue;
    if (cols.indexOf(parts[1]) >= 0) return parts[1];
    /* 过滤条件里的列同样受列级权限约束 */
    for (var f = 0; f < st.filters.length; f++) {
      if (st.filters[f][0] === parts[1]) return parts[1];
    }
  }
  return '';
}

function __tableRows(store, table, uid) {
  if (table === 'posts') return store.posts;
  if (table === 'likes') return store.likes;
  if (table === 'profiles') return store.profiles;
  if (table === 'reports') return store.reports;
  /* 视图 my_posts：真实库里由 auth.uid() 在服务端过滤，
     未登录（uid 为 null）查得空集 —— 这里照实模拟 */
  if (table === 'my_posts') {
    var mine = [];
    for (var i = 0; i < store.posts.length; i++) {
      if (uid && store.posts[i].author_id === uid) mine.push(store.posts[i]);
    }
    return mine;
  }
  /* 视图 my_security_answer：只暴露调用者自己的 question_id / updated_at。
     答案指纹（answer_hash）与盐都不在视图里 —— 这里照实只吐这两列。 */
  if (table === 'my_security_answer') {
    var secRows = [];
    var secRec = (store.security_answers || {})[uid];
    if (uid && secRec) {
      secRows.push({
        question_id: secRec.question_id,
        updated_at: secRec.updated_at || '2026-09-29T00:00:00.000Z'
      });
    }
    return secRows;
  }
  if (table === 'comments') return store.comments || [];
  /* 视图 post_comments：只暴露展示字段 + is_mine（服务端 auth.uid() 比对），
     author_id 在视图里不存在 —— 学生读不到任何账号信息 */
  if (table === 'post_comments') {
    var vis = [];
    for (var pc = 0; pc < (store.comments || []).length; pc++) {
      var cc = store.comments[pc];
      if (cc.status !== 'approved') continue;
      vis.push({
        id: cc.id,
        post_id: cc.post_id,
        parent_id: cc.parent_id || null,
        is_anonymous: !!cc.is_anonymous,
        display_name: cc.display_name || '',
        school: cc.school || null,
        content: cc.content,
        created_at: cc.created_at,
        is_mine: !!(uid && cc.author_id === uid)
      });
    }
    return vis;
  }
  /* 视图 post_comment_counts：每帖的公开评论数 */
  if (table === 'post_comment_counts') {
    var seen = [];
    var counts = {};
    for (var pt = 0; pt < (store.comments || []).length; pt++) {
      var c2 = store.comments[pt];
      if (c2.status !== 'approved') continue;
      if (!counts.hasOwnProperty(c2.post_id)) { counts[c2.post_id] = 0; seen.push(c2.post_id); }
      counts[c2.post_id]++;
    }
    var crow = [];
    for (var ci = 0; ci < seen.length; ci++) {
      crow.push({ post_id: seen[ci], comment_count: counts[seen[ci]] });
    }
    return crow;
  }
  /* 视图 post_likes：只给「计数 + 我是否点过」，不含任何 user_id。
     likes 基表的 select 已对前端角色收口（只有 post_id 还能读），
     所以「谁点了赞」这件事在接口层已经消失 —— 这里照实模拟。 */
  if (table === 'post_likes') {
    var agg = {};
    var aggOrder = [];
    for (var pl = 0; pl < store.likes.length; pl++) {
      var lk = store.likes[pl];
      if (!agg.hasOwnProperty(lk.post_id)) {
        agg[lk.post_id] = { post_id: lk.post_id, like_count: 0, liked_by_me: false };
        aggOrder.push(lk.post_id);
      }
      agg[lk.post_id].like_count++;
      if (uid && lk.user_id === uid) agg[lk.post_id].liked_by_me = true;
    }
    var lrow = [];
    for (var li = 0; li < aggOrder.length; li++) lrow.push(agg[aggOrder[li]]);
    return lrow;
  }
  return [];
}

function __resolveQuery(st, store, uid, clientOpts) {
  var rows = __tableRows(store, st.table, uid);

  if (st.op === 'select' || !st.op) {
    __calls.push(['select', st.table, st.select || '*']);
    /* 迁移之后 posts.author_id 对前端角色不可读（列级权限），
       select 里带上这列、或拿它做过滤（WHERE 同样受列级权限约束）都是 42501
       —— 这里照实模拟，防止前端（或新写的测试）又把它加回查询串。 */
    var touched = String(st.select || '*');
    for (var fi = 0; fi < st.filters.length; fi++) touched += ' ' + st.filters[fi][0];
    if (st.table === 'comments') {
      /* comments 整表 select 对前端角色已撤销（隐私收口）：照实模拟 42501 */
      return { data: null, error: { code: '42501', message: 'permission denied for table comments' } };
    }
    if (st.table === 'my_security_answer') {
      /* 答案指纹与盐都不在视图里：谁想把它们查出来，真实库会回 42703 */
      var secTouched = String(st.select || '*');
      for (var sfi = 0; sfi < st.filters.length; sfi++) secTouched += ' ' + st.filters[sfi][0];
      if (secTouched.indexOf('answer_hash') >= 0 || secTouched.indexOf('salt') >= 0) {
        return {
          data: null,
          error: { code: '42703', message: 'column my_security_answer.answer_hash does not exist' }
        };
      }
    }
    if (st.table === 'feedback') {
      /* feedback 是「只进不出」的表：服务端一条 select 策略都没有，
         所以哪怕提交者本人也读不回来 —— 照实模拟 42501。
         前端只 insert 不 select；这条分支同时替测试看着这条红线。 */
      return { data: null, error: { code: '42501', message: 'permission denied for table feedback' } };
    }
    if (st.table === 'likes') {
      /* likes 的 select 也已收口（见 docs/supabase-likes-privacy.sql）：
         只留下 post_id 一列（取消点赞要按它过滤），user_id / created_at
         一律 42501。想要点赞数只能读视图 post_likes。 */
      var likesTouched = String(st.select || '*');
      for (var lfi = 0; lfi < st.filters.length; lfi++) likesTouched += ' ' + st.filters[lfi][0];
      if (likesTouched.indexOf('*') >= 0 || likesTouched.indexOf('user_id') >= 0
          || likesTouched.indexOf('created_at') >= 0) {
        return {
          data: null,
          error: { code: '42501', message: 'permission denied for column user_id' }
        };
      }
    }
    if (st.table === 'posts' && touched.indexOf('author_id') >= 0) {
      return {
        data: null,
        error: { code: '42501', message: 'permission denied for column author_id' }
      };
    }
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (__match(rows[i], st.filters)) out.push(rows[i]);
    }
    /* D1：posts / my_posts 的 anon_code 只有「迁移跑过」的库才有。
       迁移前这一列整个不存在（上面的 42703 已经拦住了带它的查询）；迁移后
       匿名行才带值，且值由数据库按 author_id 派生（这里用 __serverCode 替身）。
       署名帖一律是 null —— 页面也只在 is_anonymous 时才看这一列。 */
    if (st.table === 'posts' || st.table === 'my_posts') {
      for (var ai = 0; ai < out.length; ai++) {
        var arow = __clone(out[ai]);
        if (clientOpts && clientOpts.anonCodeColumn) {
          arow.anon_code = arow.is_anonymous ? __serverCode(arow.author_id) : null;
        } else {
          delete arow.anon_code;
        }
        out[ai] = arow;
      }
    }
    /* 举报表：真实 PostgREST 会把被举报的帖子嵌进来；
       看不到那条帖子时（已删除、或还没过审）嵌入结果是 null —— 这里照实模拟 */
    if (st.table === 'reports' && String(st.select || '').indexOf('posts(') >= 0) {
      var embedded = [];
      for (var e = 0; e < out.length; e++) {
        var copy = __clone(out[e]);
        copy.posts = null;
        for (var k = 0; k < store.posts.length; k++) {
          if (store.posts[k].id === out[e].post_id) {
            var p = __clone(store.posts[k]);
            delete p.author_id;            /* 接口不会把作者账号返回给浏览器 */
            copy.posts = p;
            break;
          }
        }
        embedded.push(copy);
      }
      out = embedded;
    }
    if (st.orderCol) {
      out.sort(function (a, b) {
        var x = a[st.orderCol], y = b[st.orderCol];
        if (x === y) return 0;
        var r = (x > y) ? 1 : -1;
        return st.asc ? r : -r;
      });
    }
    if (st.limit !== null && st.limit !== undefined) out = out.slice(0, st.limit);
    if (st.single || st.maybeSingle) out = out.length ? out[0] : null;
    return { data: out, error: null };
  }

  if (st.op === 'insert') {
    var row = __clone(st.payload);

    /* 举报表：模拟数据库的 unique (post_id, reporter_id) 约束 */
    if (st.table === 'reports') {
      if (st.__dup) {
        __calls.push(['insert', st.table, 'duplicate']);
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      if (!row.id) row.id = 'r-' + (store.reports.length + 1);
      if (!row.created_at) row.created_at = new Date().toISOString();
      store.reports.push(row);
      __calls.push(['insert', st.table, row.reason]);
      return { data: row, error: null };
    }

    if (st.table === 'comments') {
      /* 触发器 validate_comment_parent：只允许两级，父必须是同帖的已公开顶层评论 */
      if (row.parent_id) {
        var par = null;
        for (var pi = 0; pi < (store.comments || []).length; pi++) {
          if (store.comments[pi].id === row.parent_id) { par = store.comments[pi]; break; }
        }
        if (!par || par.status !== 'approved') {
          return { data: null, error: { code: 'P0001', message: '父评论不存在或已被下架' } };
        }
        if (par.post_id !== row.post_id) {
          return { data: null, error: { code: 'P0001', message: '父评论不属于这个帖子' } };
        }
        if (par.parent_id) {
          return { data: null, error: { code: 'P0001', message: '只支持两级评论' } };
        }
      }
      /* check 约束：1..300 字、不能只有空白 */
      var ctext = String(row.content == null ? '' : row.content);
      var ctrim = ctext.replace(/^\s+|\s+$/g, '');
      if (!ctrim || ctrim.length > 300) {
        return { data: null, error: { code: '23514', message: 'violates check constraint "comments_content_check"' } };
      }
      if (!row.id) row.id = 'c-' + (store.comments.length + 1);
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.status) row.status = 'approved';
      store.comments.push(row);
      __calls.push(['insert', st.table]);
      return { data: null, error: null };   /* 前端不带 .select()：真实接口没有回显 */
    }

    if (st.table === 'feedback') {
      /* 只进不出：反馈表没有任何 select 策略，前端也不该跟 .select() */
      if (st.select) {
        return {
          data: null,
          error: { code: '42501', message: 'permission denied for table feedback' }
        };
      }
      /* check 约束 feedback_device_check：四种设备之一 */
      var fdev = String(row.device == null ? '' : row.device);
      if (['desktop', 'tablet', 'phone', 'other'].indexOf(fdev) < 0) {
        return {
          data: null,
          error: { code: '23514', message: 'violates check constraint "feedback_device_check"' }
        };
      }
      /* check 约束 feedback_content_check：1..500 字，且不能只有空白 */
      var fbody = String(row.content == null ? '' : row.content);
      if (!fbody.replace(/^\s+|\s+$/g, '') || fbody.length > 500) {
        return {
          data: null,
          error: { code: '23514', message: 'violates check constraint "feedback_content_check"' }
        };
      }
      /* check 约束 feedback_contact_check：选填，但最长 100 字 */
      var fcon = row.contact == null ? null : String(row.contact);
      if (fcon !== null && fcon.length > 100) {
        return {
          data: null,
          error: { code: '23514', message: 'violates check constraint "feedback_contact_check"' }
        };
      }
      /* 身份列在服务端根本不存在：真出现了就是前端多塞了东西 */
      var badCols = ['user_id', 'author_id', 'ip', 'user_agent', 'email'];
      for (var bc = 0; bc < badCols.length; bc++) {
        if (row.hasOwnProperty(badCols[bc])) {
          return {
            data: null,
            error: { code: 'PGRST204', message: "Could not find the '" + badCols[bc] + "' column" }
          };
        }
      }
      if (!row.id) row.id = 'fb-' + ((store.feedback || []).length + 1);
      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!store.feedback) store.feedback = [];
      store.feedback.push(row);
      __calls.push(['insert', st.table, fdev]);
      /* 没有 select 策略：不带 .select() 的 insert 本来也不回显 */
      return { data: null, error: null };
    }

    if (st.table === 'posts') {
      /* author_id 不可读的连带影响：insert 之后跟一个不带列名的 select()
         （真实接口会翻成 select=*）同样 42501，必须显式列出要回显的列。 */
      if (!st.select || String(st.select).indexOf('*') >= 0) {
        return {
          data: null,
          error: { code: '42501', message: 'permission denied for column author_id' }
        };
      }
      if (!row.id) row.id = 'p-' + (store.posts.length + 1);
      if (!row.created_at) row.created_at = new Date().toISOString();
      store.posts.push(row);
      /* 真实 PostgREST 只回显 select 里点名的列：author_id 既然读不到，
         回显里自然也不会出现（前端拿到的就是这些展示字段）。 */
      var echo = {};
      var want = String(st.select).split(',');
      for (var wi = 0; wi < want.length; wi++) {
        var col = want[wi].replace(/^\s+|\s+$/g, '');
        if (col && row.hasOwnProperty(col)) echo[col] = row[col];
      }
      __calls.push(['insert', st.table]);
      return { data: echo, error: null };
    } else if (st.table === 'likes') {
      store.likes.push(row);
    } else {
      store.profiles.push(row);
    }
    __calls.push(['insert', st.table]);
    return { data: row, error: null };
  }

  if (st.op === 'update') {
    var hit = [];
    for (var j = 0; j < rows.length; j++) {
      if (__match(rows[j], st.filters)) {
        for (var k in st.payload) {
          if (st.payload.hasOwnProperty(k)) rows[j][k] = st.payload[k];
        }
        hit.push(rows[j]);
      }
    }
    __calls.push(['update', st.table, hit.length]);
    return { data: hit, error: null };
  }

  if (st.op === 'delete') {
    if (st.table === 'likes') {
      /* RLS 策略 likes_delete_self：只放行 auth.uid() = user_id 的那一行。
         前端现在只按 post_id 过滤（user_id 那一列已不可读），
         所以「不会误删别人的点赞」由这条策略保证 —— 这里照实模拟，
         否则测试会以为「按 post_id 删」把全站的赞都删了。 */
      var keptLikes = [];
      var removedLikes = [];
      for (var lx = 0; lx < rows.length; lx++) {
        var hitsMine = __match(rows[lx], st.filters) && !!uid && rows[lx].user_id === uid;
        if (hitsMine) removedLikes.push(rows[lx]); else keptLikes.push(rows[lx]);
      }
      store.likes = keptLikes;
      __calls.push(['delete', st.table, removedLikes.length]);
      return { data: removedLikes, error: null };
    }
    var keep = [];
    var removed = [];
    for (var m = 0; m < rows.length; m++) {
      if (__match(rows[m], st.filters)) removed.push(rows[m]); else keep.push(rows[m]);
    }
    if (st.table === 'posts') store.posts = keep;
    else if (st.table === 'likes') store.likes = keep;
    else if (st.table === 'reports') store.reports = keep;
    else if (st.table === 'comments') {
      /* parent_id on delete cascade：挂在这条评论下的回复跟着一起删 */
      var gone = {};
      for (var gi = 0; gi < removed.length; gi++) gone[removed[gi].id] = true;
      var survivors = [];
      for (var si = 0; si < keep.length; si++) {
        if (keep[si].parent_id && gone[keep[si].parent_id]) { gone[keep[si].id] = true; continue; }
        survivors.push(keep[si]);
      }
      store.comments = survivors;
    }
    else store.profiles = keep;
    __calls.push(['delete', st.table, removed.length]);
    return { data: removed, error: null };
  }

  return { data: null, error: { message: 'unknown op' } };
}

function __q(table, store, clientOpts, getUid) {
  var st = {
    table: table, op: null, payload: null, filters: [], select: null,
    orderCol: null, asc: true, limit: null, single: false, maybeSingle: false
  };

  var b = {};

  b.select = function (cols) {
    if (!st.op) st.op = 'select';
    if (cols) st.select = cols;
    return b;
  };
  b.insert = function (row) {
    st.op = 'insert';
    st.payload = row;
    /* 允许测试注入「重复举报」这种情况 */
    if (table === 'reports' && clientOpts && clientOpts.reportDup) st.__dup = true;
    return b;
  };
  b.update = function (row) { st.op = 'update'; st.payload = row; return b; };
  b['delete'] = function () { st.op = 'delete'; return b; };
  b.eq = function (col, val) { st.filters.push([col, val]); return b; };
  b['in'] = function (col, vals) { st.filters.push([col, vals, true]); return b; };
  b.order = function (col, o) {
    st.orderCol = col;
    st.asc = !(o && o.ascending === false);
    return b;
  };
  b.limit = function (n) { st.limit = n; return b; };
  b.single = function () { st.single = true; return b; };
  b.maybeSingle = function () { st.maybeSingle = true; return b; };
  b.then = function (onOk, onErr) {
    /* 模拟「列级迁移还没跑」：这一列在表里不存在（Postgres 42703）。
       前端带着 posts.anon_code 请求时应该降级重试一次，页面照常显示。 */
    var missingCol = __missingColumn(clientOpts, st);
    if (missingCol) {
      /* 记下请求的列（第 3 位保持原样，老断言照旧能看列名），
         第 4 位标明「这次请求被 42703 挡回来了」 */
      __calls.push([st.op || 'select', table, st.select || '*', 'missing:' + missingCol]);
      return P.resolve({
        data: null,
        error: {
          code: '42703',
          message: 'column ' + table + '.' + missingCol + ' does not exist'
        }
      }).then(onOk, onErr);
    }
    /* 模拟「迁移还没跑」：表在 schema cache 里不存在（PGRST205） */
    if (clientOpts && clientOpts.missingTables
        && clientOpts.missingTables.indexOf(table) >= 0) {
      __calls.push([st.op || 'select', table, 'missing']);
      return P.resolve({
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public." + table + "' in the schema cache"
        }
      }).then(onOk, onErr);
    }
    /* 「统计请求慢半拍」的模拟（A6）：把 post_likes / post_comment_counts 的结果
       先扣在手里，等 __releaseStats() 再放行。用来验证「卡片先出现、计数后补，
       而且期间刷新按钮不会一直转圈」。 */
    if (__mockOpts && __mockOpts.holdStats
        && (table === 'post_likes' || table === 'post_comment_counts')) {
      __calls.push([st.op || 'select', table, st.select || '*', 'held']);
      return new P(function (resolve) {
        __heldStats.push(function () {
          resolve(__resolveQuery(st, store, getUid ? getUid() : null, clientOpts));
        });
      }).then(onOk, onErr);
    }
    return P.resolve(__resolveQuery(st, store, getUid ? getUid() : null, clientOpts))
      .then(onOk, onErr);
  };

  return b;
}

function __makeClient(opts) {
  opts = opts || {};
  var store = opts.store || { posts: [], likes: [], profiles: [], reports: [], comments: [] };
  if (!store.reports) store.reports = [];
  if (!store.comments) store.comments = [];
  if (!store.feedback) store.feedback = [];
  var session = opts.session || null;
  /* 当前会话 uid：视图 my_posts 用它模拟 auth.uid() 的服务端过滤 */
  function sessionUid() { return session && session.user ? session.user.id : null; }

  return {
    __store: store,
    auth: {
      getSession: function () { return P.resolve({ data: { session: session }, error: null }); },
      signUp: function (o) {
        __calls.push(['signUp', o.email]);
        if (opts.signUpError) {
          return P.resolve({ data: { session: null, user: null }, error: { message: opts.signUpError } });
        }
        session = {
          user: { id: 'u-new', email: o.email, is_anonymous: false, user_metadata: o.options && o.options.data }
        };
        return P.resolve({ data: { session: session, user: session.user }, error: null });
      },
      signInWithPassword: function (o) {
        __calls.push(['signIn', o.email]);
        if (opts.signInError) {
          return P.resolve({ data: null, error: { message: opts.signInError } });
        }
        session = { user: { id: 'u-1', email: o.email, is_anonymous: false } };
        return P.resolve({ data: { session: session, user: session.user }, error: null });
      },
      signInAnonymously: function () {
        __calls.push(['signInAnonymously']);
        if (opts.anonError) {
          return P.resolve({ data: null, error: { message: opts.anonError } });
        }
        session = { user: { id: 'u-anon', is_anonymous: true } };
        return P.resolve({ data: { session: session, user: session.user }, error: null });
      },
      signOut: function () { session = null; return P.resolve({ error: null }); },
      onAuthStateChange: function () {
        return { data: { subscription: { unsubscribe: function () {} } } };
      }
    },
    from: function (table) { return __q(table, store, opts, sessionUid); },
    rpc: function (name) {
      __calls.push(['rpc', name]);
      if (opts.rpcMissing) {
        /* 函数还没部署：PostgREST 找不到函数时返回 PGRST202 */
        return P.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } });
      }
      if (name === 'set_security_answer') {
        /* services 端函数 set_security_answer(text, text)：
           校验问题 id 与答案长度，落库的是「加盐指纹」而不是答案本身。
           归一化照 SQL 的口径来（去空白 + 转小写），用来验证同一答案的
           不同空格/大小写写法会落到同一个指纹上。错误文案与 SQL 里的
           raise exception 保持一致，方便测试盯着真正会看到的字。 */
        var sargs = arguments[1] || {};
        var sqid = String(sargs.p_question_id == null ? '' : sargs.p_question_id);
        var sraw = String(sargs.p_answer == null ? '' : sargs.p_answer);
        var snorm = sraw.replace(/\s/g, '').toLowerCase();
        __calls.push(['securityAnswer', sqid, sraw, snorm]);

        var suid = sessionUid();
        var ssess = suid ? session : null;
        if (!suid) {
          return P.resolve({ data: null, error: { code: 'P0001', message: '请先登录再设置密保' } });
        }
        if (ssess && ssess.user && ssess.user.is_anonymous) {
          return P.resolve({ data: null, error: { code: 'P0001', message: '匿名身份不需要密保' } });
        }
        if (['primary_school', 'teacher_surname', 'home_city'].indexOf(sqid) < 0) {
          return P.resolve({ data: null, error: { code: 'P0001', message: '密保问题不在允许的范围内' } });
        }
        if (!snorm) {
          return P.resolve({ data: null, error: { code: 'P0001', message: '答案是空的' } });
        }
        if (snorm.length > 60) {
          return P.resolve({ data: null, error: { code: 'P0001', message: '答案最多 60 个字' } });
        }
        store.security_answers = store.security_answers || {};
        store.security_answers[suid] = {
          question_id: sqid,
          fingerprint: 'sha256:' + snorm,
          failed_count: 0,
          updated_at: '2026-09-29T12:00:00.000Z'
        };
        return P.resolve({ data: { ok: true, question_id: sqid }, error: null });
      }
      if (name === 'sync_my_display_name') {
        /* 模拟服务端行为：把调用者本人的非匿名署名刷成 profiles.nickname，返回条数 */
        var uid = sessionUid();
        var vname = '';
        for (var i = 0; i < store.profiles.length; i++) {
          if (store.profiles[i].id === uid) {
            vname = String(store.profiles[i].nickname || '').replace(/^\s+|\s+$/g, '');
            break;
          }
        }
        if (!uid || !vname) return P.resolve({ data: 0, error: null });
        var n = 0;
        for (var j = 0; j < store.posts.length; j++) {
          if (store.posts[j].author_id === uid && !store.posts[j].is_anonymous) {
            store.posts[j].display_name = vname;
            n++;
          }
        }
        for (var k = 0; k < (store.comments || []).length; k++) {
          if (store.comments[k].author_id === uid && !store.comments[k].is_anonymous) {
            store.comments[k].display_name = vname;
            n++;
          }
        }
        if (opts.rpcResult !== undefined) n = opts.rpcResult;
        return P.resolve({ data: n, error: null });
      }
      return P.resolve({ data: (opts.rpcResult === undefined ? 0 : opts.rpcResult), error: null });
    },
    storage: {
      from: function (bucket) {
        return {
          upload: function (path, file) {
            __calls.push(['upload', bucket, path, (file && file.type) || '', (file && file.size) || 0]);
            return P.resolve({ data: { path: path }, error: null });
          },
          getPublicUrl: function (path) {
            return {
              data: { publicUrl: 'https://mock.supabase.co/storage/v1/object/public/' + bucket + '/' + path }
            };
          },
          remove: function (paths) {
            __calls.push(['remove', bucket]);
            return P.resolve({ data: null, error: null });
          }
        };
      }
    }
  };
}

/* Bridge: in a browser `window` IS the global object; duktape separates them,
 * so copy window props onto the real global object for test convenience. */
var __global = (function () { return this; })();
function __expose() {
  for (var k in window) {
    if (window.hasOwnProperty(k) && k !== 'location' && k !== 'document' && k !== 'window') {
      __global[k] = window[k];
    }
  }
  return true;
}

/* ------------------- Edge Function 调用用的最小 fetch ------------------- */
/* 找回密码是直接 POST 到 functions/v1/reset-password 的（不经 supabase-js），
   所以这里给一个可编程的 fetch：状态码与响应体由 __mockOpts.fetch 决定，
   用来验证「服务端怎么说 -> 页面怎么提示」这一段映射。 */
function __fetchOpts() {
  try { return (__mockOpts && __mockOpts.fetch) || {}; } catch (e) { return {}; }
}

window.fetch = function (url, init) {
  var o = __fetchOpts();
  var headers = (init && init.headers) || {};
  __calls.push(['fetch', String(url), (init && init.method) || '', (init && init.body) || '',
                String(headers.apikey || ''), String(headers.Authorization || '')]);
  if (o.throw) return P.reject(new Error(o.throw));
  // 浏览器里连不上时 fetch 抛的是 TypeError('Failed to fetch')，不是普通 Error：
  // 这样才验得出「不把英文原文丢给同学看」那一段。
  if (o.typeError) return P.reject(new TypeError('Failed to fetch'));
  if (o.abort) {
    var aerr = new Error('aborted');
    aerr.name = 'AbortError';
    return P.reject(aerr);
  }
  var status = (o.status === undefined) ? 200 : o.status;
  var body = (o.body === undefined)
    ? JSON.stringify({ ok: true, message: '密码已重置，请用新密码登录' })
    : o.body;
  return P.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    text: function () { return P.resolve(body); }
  });
};

/* ------------------------------ 结果导出 ------------------------------ */
function __results() {
  var els = {};
  for (var k in __elements) {
    if (__elements.hasOwnProperty(k)) {
      els[k] = {
        innerHTML: __elements[k].innerHTML,
        textContent: __elements[k].textContent,
        disabled: __elements[k].disabled,
        hidden: __elements[k].hidden,
        checked: __elements[k].checked
      };
    }
  }
  return {
    calls: __calls,
    logs: __logs,
    timers: __timers.length,
    title: document.title,
    location: window.location.href,
    elements: els
  };
}
