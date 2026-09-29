/* =====================================================================
 *  校园拾光 · 圈内热词（任务 B5 的一部分）
 *  ---------------------------------------------------------------------
 *  它是什么：把「你所在城市圈最近被提到的几个词」挑出来，做成几个可点的词。
 *  它不是什么（很重要）：
 *    - **不是全站热搜**：只在选了圈子之后才有，只用本圈的帖子算；
 *    - **不是排名**：界面上只出现词，不出现名次、热度、票数；
 *    - **不做作者画像**：作者标识只在内部当「去重闸门」用（防一个人刷榜），
 *      从不输出、也从不按作者聚合内容。
 *
 *  为什么要「客户端统计」而不是数据库视图：
 *    视图要站主再跑一次迁移，而热词是可以随时改口味的东西（停用词、黑名单
 *    都要能一句话调）。放在前端 = 零迁移、改完刷新即生效；代价是样本有上限
 *    （近 14 天、最多 300 条），所以圈里帖子太少时宁可不显示（见 MIN_POSTS）。
 *
 *  算法（顺序即优先级）：
 *    1. 归一化：全角转半角、去掉链接 / 邮箱 / 手机号 / 长数字 / 洞号（6 位十六进制）；
 *    2. 取词：内置校园词典命中 + 汉字 2~3 字滑动窗口 + 拉丁词（≥3 字母）；
 *    3. 每帖去重：同一个词在一帖里出现十次也算「一条帖子提到」——防止复读刷榜；
 *    4. 闸门：至少 MIN_MENTIONS 条帖子提到、至少 MIN_AUTHORS 个不同作者提到；
 *    5. 过滤：停用词、站主黑名单、校名与圈名（社交语料里最容易霸榜的噪声）；
 *    6. 折叠：只在更长的那个词「几乎同样多帖子」时才被它吸收（避免同时冒出
 *       「食堂」和「食堂阿姨」两个意思重叠的词）；
 *    7. 排序：提到它的帖子数 → 不同作者数 → 原始词频 → 词长 → 字典序。
 *
 *  这个文件不碰网络、不碰 DOM：输入一组帖子，输出几个词，所以能被单测钉死。
 * ===================================================================== */
window.HotWords = (function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 1. 阈值（改这里就能调口味）
   * ------------------------------------------------------------------ */
  var MIN_POSTS = 8;        // 本圈帖子少于这个数 → 一个词都不给（冷启动）
  var MIN_MENTIONS = 3;     // 至少 3 条帖子提到
  var MIN_AUTHORS = 2;      // 至少 2 个不同作者提到（一个人刷 100 帖也不算）
  var MAX_TERMS = 8;        // 最多给几个词
  var MIN_LEN = 2;          // 词最短 2 字（1 字词噪声太大）
  var MAX_LEN = 6;          // 词最长 6 字
  var WINDOW_DAYS = 14;     // 只看最近多少天
  var MAX_POSTS = 300;      // 取样上限（新帖优先）

  /* ------------------------------------------------------------------
   * 2. 校园词典：命中即算一个词（不受 2~3 字窗口限制，可以到 6 字）
   *    —— 只收「学生真的会聊」的东西；宁可漏，不要乱收。
   * ------------------------------------------------------------------ */
  var DICT = [
    // 学业
    "期末", "考试", "挂科", "补考", "绩点", "保研", "考研", "考公", "四级", "六级",
    "四六级", "论文", "答辩", "查重", "开题", "组会", "实验", "实验室", "课程", "选课",
    "抢课", "重修", "奖学金", "助学金", "综测", "转专业", "双学位", "实习", "秋招", "春招",
    "校招", "面试", "简历", "offer", "留学", "雅思", "托福", "保研率", "毕设", "毕业",
    // 生活
    "食堂", "宿舍", "寝室", "室友", "外卖", "快递", "澡堂", "洗澡", "洗衣房", "洗衣机",
    "断电", "熄灯", "空调", "暖气", "早八", "晚自习", "图书馆", "自习室", "教室", "通勤",
    "校车", "地铁", "高铁", "机票", "回家", "食堂阿姨", "夜宵", "奶茶", "咖啡", "火锅",
    "麻辣烫", "螺蛳粉", "烧烤", "火锅店", "买菜", "做饭", "省钱", "兼职", "家教", "生活费",
    // 身体与心情
    "体测", "军训", "跑操", "跑步", "篮球", "足球", "羽毛球", "乒乓球", "健身房", "游泳",
    "失眠", "熬夜", "焦虑", "内耗", "想家", "emo", "emo了", "崩溃", "开心", "开心死了",
    "感冒", "发烧", "牙疼", "校医院", "体检",
    // 校园与社交
    "社团", "学生会", "志愿", "支教", "迎新", "校庆", "运动会", "晚会", "比赛", "国奖",
    "辅导员", "班主任", "导师", "老师", "开题报告", "实验室", "工位", "室友关系", "谈恋爱",
    "表白", "暗恋", "分手", "异地", "脱单", "考研人", "保研人", "打工人", "摸鱼", "摆烂",
    // 天气与环境
    "下雨", "台风", "暴雨", "降温", "下雪", "高温", "停电", "停水", "食堂难吃", "网速",
    "限电", "封路", "开学", "放假", "暑假", "寒假", "国庆", "调休"
  ];

  /* ------------------------------------------------------------------
   * 3. 停用词：口语与功能词。它们高频但没有信息量，放进去只会让词榜变废话。
   * ------------------------------------------------------------------ */
  var STOP_WORDS = [
    "时候", "现在", "今天", "明天", "昨天", "早上", "上午", "中午", "下午", "晚上", "夜里",
    "我们", "你们", "他们", "她们", "大家", "自己", "别人", "有人", "没有人", "什么", "怎么",
    "为什么", "哪里", "哪个", "这个", "那个", "这些", "那些", "这样", "那样", "一下", "一点",
    "真的", "好像", "感觉", "觉得", "应该", "可以", "不能", "不会", "没有", "就是", "还是",
    "但是", "因为", "所以", "如果", "虽然", "而且", "然后", "于是", "已经", "正在", "一直",
    "有点", "非常", "特别", "真的吗", "哈哈", "哈哈哈", "哈哈哈哈", "嘻嘻", "呜呜", "啊啊",
    "分享", "发表", "评论", "图片", "帖子", "内容", "东西", "事情", "地方", "问题", "情况",
    "同学", "同学们", "朋友", "学校", "大学", "学院", "校区", "学生", "专业", "时间", "一天",
    "早上好", "晚安", "加油", "谢谢", "对不起", "没关系", "不知道", "怎么办", "怎么样", "好吃",
    "好玩", "好看", "好累", "好想", "真的吗", "是的", "好的", "收到了", "哈哈哈",
    "我觉得", "我发现", "我感觉", "我想说", "说实话", "其实", "反正", "之类的", "什么的",
    "有没有", "有人知道", "差不多", "有时候", "一会儿", "第二天", "昨天晚上", "到现在",
    "看到", "刷到", "吃了", "喝了", "买了", "最后还是", "一起", "一共", "多少", "每个",
    "之前", "以后", "以前", "后来", "凌晨", "半夜"
  ];

  /* ------------------------------------------------------------------
   * 4. 站主黑名单：自动挑词一定会出洋相。发现哪个词不该出现，加到这里，
   *    刷新即生效（不用改算法、不用重新部署）。匹配是「词里包含黑名单词」。
   * ------------------------------------------------------------------ */
  var BLOCK_WORDS = [
    "傻", "滚", "垃圾", "废物", "恶心", "去死", "自杀", "抑郁", "割腕", "跳楼",
    "约炮", "约p", "代写", "代考", "枪手", "卖答案", "作弊", "翻墙", "赌博", "兼职刷单"
  ];

  /* ------------------------------------------------------------------
   * 5. 归一化 / 取词
   * ------------------------------------------------------------------ */
  function normalize(text) {
    var s = String(text == null ? "" : text);
    // 全角 ASCII → 半角（！～ 区，外加全角空格）
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/\u3000/g, " ").toLowerCase();
    s = s.replace(/https?:\/\/\S+|www\.\S+/g, " ");          // 链接
    s = s.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, " "); // 邮箱
    s = s.replace(/\b1[3-9]\d{9}\b/g, " ");                   // 手机号
    s = s.replace(/\b[0-9a-f]{6}\b/g, " ");                   // 洞号（6 位十六进制）
    s = s.replace(/\d{4,}/g, " ");                            // 学号 / QQ / 长数字
    s = s.replace(/[#＃]/g, " ");                             // 井号只当分隔
    return s;
  }

  var CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
  var LATIN = /[a-z]/;

  function isCjk(ch) { return CJK.test(ch); }
  function isLatin(ch) { return LATIN.test(ch); }

  /** 把归一化后的文本切成「汉字段」和「拉丁段」 */
  function runs(s) {
    var out = [], buf = "", mode = "", i, ch, m;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      m = isCjk(ch) ? "cjk" : (isLatin(ch) ? "latin" : "");
      if (!m) {
        if (buf) { out.push({ cjk: mode === "cjk", text: buf }); buf = ""; }
        mode = "";
        continue;
      }
      if (m !== mode && buf) { out.push({ cjk: mode === "cjk", text: buf }); buf = ""; }
      mode = m;
      buf += ch;
    }
    if (buf) out.push({ cjk: mode === "cjk", text: buf });
    return out;
  }

  var STOP = {}, BLOCK = {}, DICT_SET = {};
  (function () {
    var i;
    for (i = 0; i < STOP_WORDS.length; i++) STOP[STOP_WORDS[i]] = 1;
    for (i = 0; i < BLOCK_WORDS.length; i++) BLOCK[BLOCK_WORDS[i]] = 1;
    for (i = 0; i < DICT.length; i++) DICT_SET[DICT[i]] = 1;
  })();

  function stopped(t) { return !!STOP[t]; }

  /* 同一个字在词里出现两次（「哈哈」「食堂食」「堂食堂」）—— 只用来挡滑窗切出来的
   * 碎片，词典里手写的词（如「火锅」「图书馆」）不经过这里。 */
  function hasRepeat(t) {
    for (var i = 0; i < t.length; i++) {
      if (t.indexOf(t.charAt(i)) !== t.lastIndexOf(t.charAt(i))) return true;
    }
    return false;
  }

  function blocked(t) {
    for (var b in BLOCK) {
      if (Object.prototype.hasOwnProperty.call(BLOCK, b) && t.indexOf(b) >= 0) return true;
    }
    return false;
  }

  /**
   * 一帖里的所有候选词（已去重，按字典序）。
   * 词典命中优先，其次 2~4 字汉字滑窗、≥3 字母的拉丁词。
   * keepStop=true 时连停用词一起返回 —— 那是给「碎片判定」用的：
   * 「我觉」这种切片要看它是不是总出现在「我觉得」里面（见 rank）。
   */
  function tokensOf(text, keepStop) {
    var norm = normalize(text);
    var found = {}, i, j, k, run, piece;
    var rs = runs(norm);

    for (i = 0; i < rs.length; i++) {
      run = rs[i];
      if (!run.cjk) {
        if (run.text.length >= 3 && (keepStop || !stopped(run.text))) found[run.text] = 1;
        continue;
      }
      // 汉字段：2~4 字窗口（4 字是为了「期末考试」这类连写词）
      for (j = 2; j <= 4; j++) {
        for (k = 0; k + j <= run.text.length; k++) {
          piece = run.text.substr(k, j);
          // 同一个字出现两次的窗口，几乎都是复读或跨词边界的碎片
          //（「哈哈」跑、「堂食堂」这种）；词典里手写的词不经过这里。
          if (hasRepeat(piece)) continue;
          // 停用词照样收进 found：keepStop 只是决定要不要留在结果里
          found[piece] = 1;
        }
      }
    }
    // 词典：在整段归一化文本里找（可以跨标点命中固定说法）
    for (i = 0; i < DICT.length; i++) {
      if (norm.indexOf(DICT[i]) >= 0) found[DICT[i]] = 1;
    }

    var out = [];
    for (var t in found) {
      if (!Object.prototype.hasOwnProperty.call(found, t)) continue;
      if (t.length < MIN_LEN || t.length > MAX_LEN) continue;
      if (/^[0-9]+$/.test(t)) continue;
      if (!keepStop && stopped(t)) continue;
      out.push(t);
    }
    out.sort();
    return out;
  }

  /** 日常取词：见 tokensOf */
  function termsOf(text) { return tokensOf(text, false); }

  /* ------------------------------------------------------------------
   * 6. 作者标识（只在内部当闸门用，绝不外传）
   * ------------------------------------------------------------------ */
  function authorKey(post) {
    var code = String((post && post.anon_code) || "").trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(code)) return "c" + code;          // 匿名帖：稳定洞号
    var name = String((post && post.display_name) || "").trim();
    if (name) return "n" + name;                                 // 署名帖：昵称
    return "p" + String((post && post.id) || "");                // 都没有：退化成每帖一人
  }

  /* ------------------------------------------------------------------
   * 7. 取样：近 WINDOW_DAYS 天、最新 MAX_POSTS 条
   * ------------------------------------------------------------------ */
  function selectRecent(posts, nowMs, days, limit) {
    var now = typeof nowMs === "number" ? nowMs : Date.now();
    var win = (typeof days === "number" ? days : WINDOW_DAYS) * 86400000;
    var cap = typeof limit === "number" ? limit : MAX_POSTS;
    var cutoff = now - win;
    var kept = [], i, p, ts;
    for (i = 0; i < (posts || []).length; i++) {
      p = posts[i];
      ts = Date.parse(p && p.created_at);
      if (!isFinite(ts) || ts < cutoff) continue;   // 时间戳坏了就当过期：宁可少算
      kept.push({ post: p, ts: ts });
    }
    kept.sort(function (a, b) { return b.ts - a.ts; });
    var out = [];
    for (i = 0; i < kept.length && i < cap; i++) out.push(kept[i].post);
    return out;
  }

  /* ------------------------------------------------------------------
   * 8. 主函数：给一组帖子，回几个词
   *    opts.banned: 额外要屏蔽的词（校名、圈名由调用方传进来）
   *    opts.now:    测试用的「现在」
   *    返回值只带词与内部计数，界面上**只显示词**。
   * ------------------------------------------------------------------ */
  function rank(posts, opts) {
    opts = opts || {};
    var pool = selectRecent(posts, opts.now, opts.days, opts.limit);
    if (pool.length < MIN_POSTS) return [];

    var banned = {}, i, j;
    for (i = 0; i < (opts.banned || []).length; i++) {
      var b = normalize(opts.banned[i]).replace(/\s+/g, "");
      if (b) banned[b] = 1;
    }

    var stat = {};   // term -> { posts:{帖:1}, authors:{作者:1}, raw:n }
    var rawByPost = {};   // 帖 → 该帖的全部候选词（含停用词），只给碎片判定用
    for (i = 0; i < pool.length; i++) {
      var p = pool[i];
      var who = authorKey(p);
      var pid = String(p && p.id != null ? p.id : "i" + i);
      rawByPost[pid] = tokensOf(p.content, true);
      var toks = termsOf(p.content);
      for (j = 0; j < toks.length; j++) {
        var t = toks[j];
        if (!stat[t]) stat[t] = { posts: {}, authors: {}, raw: 0 };
        stat[t].posts[pid] = 1;
        stat[t].authors[who] = 1;
        stat[t].raw += 1;
      }
    }

    /* 碎片判定：某个词如果**每一帖里**都只是停用词短语的一部分
     *（「我觉」永远出现在「我觉得」里），那它就不是词，是切片。 */
    function onlyInsideStopword(term, set) {
      for (var q in set) {
        if (!Object.prototype.hasOwnProperty.call(set, q)) continue;
        var list = rawByPost[q] || [], ok = false;
        for (var r = 0; r < list.length; r++) {
          if (list[r].length > term.length && stopped(list[r]) && list[r].indexOf(term) >= 0) {
            ok = true;
            break;
          }
        }
        if (!ok) return false;
      }
      return true;
    }

    var arr = [], t2;
    for (t2 in stat) {
      if (!Object.prototype.hasOwnProperty.call(stat, t2)) continue;
      var s = stat[t2];
      var posts2 = 0, authors2 = 0, k2;
      for (k2 in s.posts) {
        if (Object.prototype.hasOwnProperty.call(s.posts, k2)) posts2 += 1;
      }
      for (k2 in s.authors) {
        if (Object.prototype.hasOwnProperty.call(s.authors, k2)) authors2 += 1;
      }
      if (posts2 < MIN_MENTIONS || authors2 < MIN_AUTHORS) continue;
      if (banned[t2]) continue;
      if (blocked(t2)) continue;
      var dropped = false;
      for (var bb in banned) {
        // 校名/圈名的一部分（如「大学」的邻接片段）不当热词
        if (bb.length >= 2 && bb.indexOf(t2) >= 0) { dropped = true; break; }
      }
      if (dropped) continue;
      if (!DICT_SET[t2] && onlyInsideStopword(t2, s.posts)) continue;
      arr.push({ term: t2, posts: posts2, authors: authors2, raw: s.raw, set: s.posts,
                 dict: DICT_SET[t2] ? 1 : 0 });
    }

    // 折叠：碎片让位给完整的词。
    // 排序先给**词典里手写的词**（那是人确认过说得通的词），再按帖子数、
    // 词长；然后拿「帖子集合被覆盖」当折叠判据 —— 提到 B 的帖子里有八成以上
    // 也提到了 A、而 A 排在 B 前面，B 就只是 A 的切片（「去食」「堂吃」让位给
    // 「食堂」）。这不追求完美：自动挑词一定会漏出怪词，站主发现后加进黑名单。
    arr.sort(function (a, b) {
      if (b.dict !== a.dict) return b.dict - a.dict;
      if (b.posts !== a.posts) return b.posts - a.posts;
      if (b.term.length !== a.term.length) return b.term.length - a.term.length;
      return a.term < b.term ? -1 : (a.term > b.term ? 1 : 0);
    });
    var keep = [], w;
    for (i = 0; i < arr.length && i < 80; i++) {
      var cand = arr[i], covered = false;
      for (w = 0; w < keep.length; w++) {
        var strong = keep[w];
        var hitCount = 0;
        for (var pid in cand.set) {
          if (Object.prototype.hasOwnProperty.call(cand.set, pid) &&
              Object.prototype.hasOwnProperty.call(strong.set, pid)) hitCount += 1;
        }
        if (hitCount >= cand.posts * 0.8) { covered = true; break; }
      }
      if (!covered) keep.push(cand);
    }

    keep.sort(function (a, b) {
      if (b.posts !== a.posts) return b.posts - a.posts;
      if (b.authors !== a.authors) return b.authors - a.authors;
      if (b.raw !== a.raw) return b.raw - a.raw;
      if (b.term.length !== a.term.length) return b.term.length - a.term.length;
      return a.term < b.term ? -1 : (a.term > b.term ? 1 : 0);
    });

    return keep.slice(0, MAX_TERMS);
  }

  /** 只要词（界面用）：界面上永远只出现词，不出现计数 */
  function top(posts, opts) {
    var r = rank(posts, opts), out = [], i;
    for (i = 0; i < r.length; i++) out.push(r[i].term);
    return out;
  }

  return {
    MIN_POSTS: MIN_POSTS,
    MIN_MENTIONS: MIN_MENTIONS,
    MIN_AUTHORS: MIN_AUTHORS,
    MAX_TERMS: MAX_TERMS,
    WINDOW_DAYS: WINDOW_DAYS,
    MAX_POSTS: MAX_POSTS,
    normalize: normalize,
    termsOf: termsOf,
    selectRecent: selectRecent,
    rank: rank,
    top: top,
    dictSize: DICT.length,
    stopSize: STOP_WORDS.length,
    blockSize: BLOCK_WORDS.length
  };
})();
