/* =====================================================================
 *  校园拾光 · 城市圈（任务 B5 的第二形态）
 *  ---------------------------------------------------------------------
 *  为什么不是「同城筛选」：
 *    单个城市的学校太少（129 所学校散在 49 座城市，一半城市只有 1~2 所），
 *    按城市筛几乎必然筛出空页；按省筛又太松散（「华南」对广东和广西的同学
 *    不是同一件事）。所以折成**学生自己会说的那几片区域**：
 *    大湾区、京津冀、长三角、华中、齐鲁、闽台、西南、东三省、西北、海南、
 *    华北（晋蒙）、广西 —— 12 个圈覆盖全部 33 个省级区划，每所学校恰好一个圈。
 *
 *  圈子只影响**看的顺序**，不影响内容归属：
 *    - 仍是一个广场（不新开子分区，见 PROJECT_SCOPE 第 5 节）；
 *    - 选了圈 → 本圈内容排在前面 + 卡片上标圈名；还能「只看本圈」；
 *    - 没选圈 → 和以前完全一样。
 *
 *  归属规则的唯一依据是**学校所在的省**（`CampusList.provinceOf`）：
 *    学校认不出来（历史手输值、列表外的学校）→ 没有圈，降级为「看全部」，
 *    用户仍可手选一个圈。这是刻意的：宁可没有归属，也不要猜错归属。
 *
 *  维护方式：改下面的 LIST 就行（省份是唯一键，**不能重复**，否则同一所学校
 *  会有两个圈）。新增省份时记得跑测试 —— 静态检查会核对「campuses.js 里出现过的
 *  每个省份都被某个圈收下」。
 * ===================================================================== */
window.CircleList = (function () {
  "use strict";

  var STORAGE_KEY = "campus.circle";   // 只存在本机（localStorage），见 README「城市圈」

  /* ------------------------------------------------------------------
   * 1. 圈子定义
   *    id 用 ASCII（存 localStorage、进 URL），名称与说明是给人看的。
   *    顺序 = 选择器里的展示顺序（把学生多的放前面）。
   * ------------------------------------------------------------------ */
  var LIST = [
    {
      id: "gba",
      name: "大湾区",
      emoji: "🌊",
      intro: "广州、深圳、珠海……以及香港、澳门",
      provinces: ["广东省", "香港特别行政区", "澳门特别行政区"]
    },
    {
      id: "jingjinji",
      name: "京津冀",
      emoji: "🏛",
      intro: "北京、天津、河北",
      provinces: ["北京市", "天津市", "河北省"]
    },
    {
      id: "yangtze",
      name: "长三角",
      emoji: "🌉",
      intro: "上海、江苏、浙江、安徽",
      provinces: ["上海市", "江苏省", "浙江省", "安徽省"]
    },
    {
      id: "central",
      name: "华中",
      emoji: "🚢",
      intro: "河南、湖北、湖南、江西",
      provinces: ["河南省", "湖北省", "湖南省", "江西省"]
    },
    {
      id: "shandong",
      name: "齐鲁",
      emoji: "⛰",
      intro: "山东",
      provinces: ["山东省"]
    },
    {
      id: "fujian",
      name: "闽台",
      emoji: "🍵",
      intro: "福建",
      provinces: ["福建省"]
    },
    {
      id: "southwest",
      name: "西南",
      emoji: "🐼",
      intro: "四川、重庆、云南、贵州、西藏",
      provinces: ["四川省", "重庆市", "云南省", "贵州省", "西藏自治区"]
    },
    {
      id: "northeast",
      name: "东三省",
      emoji: "❄️",
      intro: "辽宁、吉林、黑龙江",
      provinces: ["辽宁省", "吉林省", "黑龙江省"]
    },
    {
      id: "northwest",
      name: "西北",
      emoji: "🐫",
      intro: "陕西、甘肃、青海、宁夏、新疆",
      provinces: ["陕西省", "甘肃省", "青海省", "宁夏回族自治区", "新疆维吾尔自治区"]
    },
    {
      id: "hainan",
      name: "海南",
      emoji: "🌴",
      intro: "海南",
      provinces: ["海南省"]
    },
    {
      id: "huabei",
      name: "华北",
      emoji: "🐎",
      intro: "山西、内蒙古",
      provinces: ["山西省", "内蒙古自治区"]
    },
    {
      id: "guangxi",
      name: "广西",
      emoji: "🍜",
      intro: "广西",
      provinces: ["广西壮族自治区"]
    }
  ];

  var MAX_INTRO = 60;

  /* ------------------------------------------------------------------
   * 2. 索引：省份 → 圈子
   *    省份重复会当场暴露（同一所学校两套归属），静态检查也会拦。
   * ------------------------------------------------------------------ */
  var BY_ID = {};
  var PROVINCE_TO_CIRCLE = {};
  var DUPLICATE_PROVINCES = [];
  var i, j, c, p;

  for (i = 0; i < LIST.length; i++) {
    c = LIST[i];
    c.intro = String(c.intro || "").slice(0, MAX_INTRO);
    BY_ID[c.id] = c;
    for (j = 0; j < c.provinces.length; j++) {
      p = c.provinces[j];
      if (PROVINCE_TO_CIRCLE[p]) DUPLICATE_PROVINCES.push(p);
      PROVINCE_TO_CIRCLE[p] = c.id;
    }
  }

  /* ------------------------------------------------------------------
   * 3. 对外 API
   * ------------------------------------------------------------------ */

  function list() {
    var out = [];
    for (var k = 0; k < LIST.length; k++) {
      out.push({ id: LIST[k].id, name: LIST[k].name, emoji: LIST[k].emoji, intro: LIST[k].intro });
    }
    return out;
  }

  function byId(id) {
    var c2 = BY_ID[id];
    return c2 ? { id: c2.id, name: c2.name, emoji: c2.emoji, intro: c2.intro } : null;
  }

  /** 圈名（拿不到就返回空串，调用方据此退回「不显示圈子」） */
  function nameOf(id) {
    return BY_ID[id] ? BY_ID[id].name : "";
  }

  function exists(id) {
    return !!BY_ID[id];
  }

  /**
   * 学校 → 圈子 id。
   * 认不出省份（列表外学校、历史手输值、空值）→ 空串，表示「没有归属」。
   */
  function circleOf(school) {
    var province = "";
    if (window.CampusList && window.CampusList.provinceOf) {
      province = window.CampusList.provinceOf(school);
    }
    if (!province) return "";
    return PROVINCE_TO_CIRCLE[province] || "";
  }

  function provinceOfCircle(id) {
    var c3 = BY_ID[id];
    return c3 ? c3.provinces.slice() : [];
  }

  /**
   * 这个圈里有哪些学校（用于按 `school` 集合筛选）。
   * 依据是 campuses.js 的固定列表 —— 用户自填的「列表外学校」不会出现在这里，
   * 所以它天然进不了任何圈（README 里写明了这个已知边界）。
   */
  function schoolsIn(id) {
    var c4 = BY_ID[id];
    var out = [];
    if (!c4 || !window.CampusList || !window.CampusList.schoolOptions) return out;
    var all = window.CampusList.schoolOptions();
    for (var k = 0; k < all.length; k++) {
      if (c4.provinces.indexOf(all[k].province) >= 0) out.push(all[k].name);
    }
    return out;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    list: list,
    byId: byId,
    nameOf: nameOf,
    exists: exists,
    circleOf: circleOf,
    provinceOfCircle: provinceOfCircle,
    schoolsIn: schoolsIn,
    size: LIST.length,
    duplicateProvinces: DUPLICATE_PROVINCES
  };
})();
