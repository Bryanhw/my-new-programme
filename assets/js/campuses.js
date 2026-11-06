/* =====================================================================
 *  校园拾光 · 学校固定列表（任务 D2 → M3 高校选择器）
 *  ---------------------------------------------------------------------
 *  本文件由 tools/campus_master.py 生成，勿手改；改数据请改那个文件后再生成。
 *
 *  名单口径（只增不删）：导师基线 129 行 + 后续新增（M3 28 行 + V4 名校 12 行），覆盖
 *  985(39) / 211(官方 112 立项) / 港五澳三(8) / 点名六所(6)，口径注释见
 *  tools/campus_master.py 与 docs/PLAN_SCOPE_v4.md §6.5，差异审计见
 *  tools/campus_compare.py。
 *
 *  为什么用受控列表而不让用户乱填：原「××大学」「××大学 」会被当成两所
 *  学校，「同城 / 同校筛选」就没法做。命中列表的输入被归一；找不到的学校
 *  照原样收下（降级），仍能注册，只是暂时没有城市。城市是「只看同城」的
 *  依据（provinceOf 是城市圈分圈的唯一依据，见 circles.js），每行必须填准。
 *
 *  新增搜索能力（给校外选择器）：pinyinOf / initialsOf / initialOf /
 *  search / byInitial，拼音与标签已内置在数据里（方案 A，零运行时依赖）。
 * ===================================================================== */
/* 宿主兼容：浏览器挂 window，Node / 沙箱挂 globalThis（替身同样模拟 window） */
var CAMPUS_HOST = (typeof window !== "undefined" ? window :
                (typeof globalThis !== "undefined" ? globalThis : {}));
CAMPUS_HOST.CampusList = (function () {
  "use strict";

  /* -----------------------------------------------------------
   * 1. 学校：[校名, 省 / 自治区 / 直辖市, 城市]（生成，共 169 行）
   * ----------------------------------------------------------- */
  var LIST = [
    ["北京大学", "北京市", "北京市"],
    ["清华大学", "北京市", "北京市"],
    ["中国人民大学", "北京市", "北京市"],
    ["北京航空航天大学", "北京市", "北京市"],
    ["北京理工大学", "北京市", "北京市"],
    ["北京师范大学", "北京市", "北京市"],
    ["北京邮电大学", "北京市", "北京市"],
    ["北京交通大学", "北京市", "北京市"],
    ["北京科技大学", "北京市", "北京市"],
    ["中央财经大学", "北京市", "北京市"],
    ["对外经济贸易大学", "北京市", "北京市"],
    ["中国政法大学", "北京市", "北京市"],
    ["北京外国语大学", "北京市", "北京市"],
    ["南开大学", "天津市", "天津市"],
    ["天津大学", "天津市", "天津市"],
    ["天津医科大学", "天津市", "天津市"],
    ["河北工业大学", "天津市", "天津市"],
    ["复旦大学", "上海市", "上海市"],
    ["上海交通大学", "上海市", "上海市"],
    ["同济大学", "上海市", "上海市"],
    ["华东师范大学", "上海市", "上海市"],
    ["华东理工大学", "上海市", "上海市"],
    ["上海大学", "上海市", "上海市"],
    ["东华大学", "上海市", "上海市"],
    ["上海财经大学", "上海市", "上海市"],
    ["上海外国语大学", "上海市", "上海市"],
    ["重庆大学", "重庆市", "重庆市"],
    ["西南大学", "重庆市", "重庆市"],
    ["西南政法大学", "重庆市", "重庆市"],
    ["重庆邮电大学", "重庆市", "重庆市"],
    ["重庆交通大学", "重庆市", "重庆市"],
    ["河北大学", "河北省", "保定市"],
    ["燕山大学", "河北省", "秦皇岛市"],
    ["河北师范大学", "河北省", "石家庄市"],
    ["太原理工大学", "山西省", "太原市"],
    ["山西大学", "山西省", "太原市"],
    ["内蒙古大学", "内蒙古自治区", "呼和浩特市"],
    ["东北大学", "辽宁省", "沈阳市"],
    ["辽宁大学", "辽宁省", "沈阳市"],
    ["大连理工大学", "辽宁省", "大连市"],
    ["大连海事大学", "辽宁省", "大连市"],
    ["东北财经大学", "辽宁省", "大连市"],
    ["吉林大学", "吉林省", "长春市"],
    ["东北师范大学", "吉林省", "长春市"],
    ["哈尔滨工业大学", "黑龙江省", "哈尔滨市"],
    ["哈尔滨工程大学", "黑龙江省", "哈尔滨市"],
    ["东北林业大学", "黑龙江省", "哈尔滨市"],
    ["南京大学", "江苏省", "南京市"],
    ["东南大学", "江苏省", "南京市"],
    ["南京航空航天大学", "江苏省", "南京市"],
    ["南京理工大学", "江苏省", "南京市"],
    ["河海大学", "江苏省", "南京市"],
    ["南京师范大学", "江苏省", "南京市"],
    ["苏州大学", "江苏省", "苏州市"],
    ["江南大学", "江苏省", "无锡市"],
    ["中国矿业大学", "江苏省", "徐州市"],
    ["浙江大学", "浙江省", "杭州市"],
    ["杭州电子科技大学", "浙江省", "杭州市"],
    ["浙江工业大学", "浙江省", "杭州市"],
    ["宁波大学", "浙江省", "宁波市"],
    ["中国科学技术大学", "安徽省", "合肥市"],
    ["合肥工业大学", "安徽省", "合肥市"],
    ["安徽大学", "安徽省", "合肥市"],
    ["厦门大学", "福建省", "厦门市"],
    ["集美大学", "福建省", "厦门市"],
    ["福州大学", "福建省", "福州市"],
    ["华侨大学", "福建省", "泉州市"],
    ["南昌大学", "江西省", "南昌市"],
    ["江西财经大学", "江西省", "南昌市"],
    ["山东大学", "山东省", "济南市"],
    ["山东师范大学", "山东省", "济南市"],
    ["中国海洋大学", "山东省", "青岛市"],
    ["青岛大学", "山东省", "青岛市"],
    ["郑州大学", "河南省", "郑州市"],
    ["河南大学", "河南省", "开封市"],
    ["武汉大学", "湖北省", "武汉市"],
    ["华中科技大学", "湖北省", "武汉市"],
    ["武汉理工大学", "湖北省", "武汉市"],
    ["华中师范大学", "湖北省", "武汉市"],
    ["华中农业大学", "湖北省", "武汉市"],
    ["中南财经政法大学", "湖北省", "武汉市"],
    ["中南大学", "湖南省", "长沙市"],
    ["湖南大学", "湖南省", "长沙市"],
    ["湖南师范大学", "湖南省", "长沙市"],
    ["国防科技大学", "湖南省", "长沙市"],
    ["湘潭大学", "湖南省", "湘潭市"],
    ["湖南科技大学", "湖南省", "湘潭市"],
    ["中山大学", "广东省", "广州市"],
    ["华南理工大学", "广东省", "广州市"],
    ["暨南大学", "广东省", "广州市"],
    ["华南师范大学", "广东省", "广州市"],
    ["广东工业大学", "广东省", "广州市"],
    ["深圳大学", "广东省", "深圳市"],
    ["南方科技大学", "广东省", "深圳市"],
    ["汕头大学", "广东省", "汕头市"],
    ["香港大学", "香港特别行政区", "香港"],
    ["香港中文大学", "香港特别行政区", "香港"],
    ["香港科技大学", "香港特别行政区", "香港"],
    ["香港理工大学", "香港特别行政区", "香港"],
    ["香港城市大学", "香港特别行政区", "香港"],
    ["澳门大学", "澳门特别行政区", "澳门"],
    ["澳门科技大学", "澳门特别行政区", "澳门"],
    ["广西大学", "广西壮族自治区", "南宁市"],
    ["海南大学", "海南省", "海口市"],
    ["电子科技大学", "四川省", "成都市"],
    ["四川大学", "四川省", "成都市"],
    ["西南交通大学", "四川省", "成都市"],
    ["西南财经大学", "四川省", "成都市"],
    ["成都理工大学", "四川省", "成都市"],
    ["四川师范大学", "四川省", "成都市"],
    ["西南石油大学", "四川省", "成都市"],
    ["成都信息工程大学", "四川省", "成都市"],
    ["西华大学", "四川省", "成都市"],
    ["西南科技大学", "四川省", "绵阳市"],
    ["贵州大学", "贵州省", "贵阳市"],
    ["云南大学", "云南省", "昆明市"],
    ["昆明理工大学", "云南省", "昆明市"],
    ["西藏大学", "西藏自治区", "拉萨市"],
    ["西安交通大学", "陕西省", "西安市"],
    ["西北工业大学", "陕西省", "西安市"],
    ["西安电子科技大学", "陕西省", "西安市"],
    ["西北大学", "陕西省", "西安市"],
    ["陕西师范大学", "陕西省", "西安市"],
    ["长安大学", "陕西省", "西安市"],
    ["兰州大学", "甘肃省", "兰州市"],
    ["青海大学", "青海省", "西宁市"],
    ["宁夏大学", "宁夏回族自治区", "银川市"],
    ["新疆大学", "新疆维吾尔自治区", "乌鲁木齐市"],
    ["石河子大学", "新疆维吾尔自治区", "石河子市"],
    ["中国农业大学", "北京市", "北京市"],
    ["中央民族大学", "北京市", "北京市"],
    ["西北农林科技大学", "陕西省", "咸阳市"],
    ["北京工业大学", "北京市", "北京市"],
    ["北京化工大学", "北京市", "北京市"],
    ["北京林业大学", "北京市", "北京市"],
    ["北京中医药大学", "北京市", "北京市"],
    ["中国传媒大学", "北京市", "北京市"],
    ["北京体育大学", "北京市", "北京市"],
    ["中央音乐学院", "北京市", "北京市"],
    ["华北电力大学", "北京市", "北京市"],
    ["东北农业大学", "黑龙江省", "哈尔滨市"],
    ["延边大学", "吉林省", "延吉市"],
    ["海军军医大学", "上海市", "上海市"],
    ["中国药科大学", "江苏省", "南京市"],
    ["南京农业大学", "江苏省", "南京市"],
    ["四川农业大学", "四川省", "雅安市"],
    ["空军军医大学", "陕西省", "西安市"],
    ["澳门城市大学", "澳门特别行政区", "澳门"],
    ["中国科学院大学", "北京市", "北京市"],
    ["深圳理工大学", "广东省", "深圳市"],
    ["西湖大学", "浙江省", "杭州市"],
    ["香港中文大学（深圳）", "广东省", "深圳市"],
    ["中国地质大学（武汉）", "湖北省", "武汉市"],
    ["中国地质大学（北京）", "北京市", "北京市"],
    ["中国矿业大学（北京）", "北京市", "北京市"],
    ["中国石油大学（华东）", "山东省", "青岛市"],
    ["中国石油大学（北京）", "北京市", "北京市"],
    ["上海科技大学", "上海市", "上海市"],
    ["上海纽约大学", "上海市", "上海市"],
    ["大湾区大学", "广东省", "东莞市"],
    ["中国社会科学院大学", "北京市", "北京市"],
    ["北京师范大学-香港浸会大学联合国际学院", "广东省", "珠海市"],
    ["昆山杜克大学", "江苏省", "苏州市"],
    ["西交利物浦大学", "江苏省", "苏州市"],
    ["香港科技大学（广州）", "广东省", "广州市"],
    ["香港城市大学（东莞）", "广东省", "东莞市"],
    ["哈尔滨工业大学（深圳）", "广东省", "深圳市"],
    ["哈尔滨工业大学（威海）", "山东省", "威海市"],
    ["山东大学（威海）", "山东省", "威海市"],  ];

  /* -----------------------------------------------------------
   * 1.5 拼音与首字母（与 LIST 一一对应，生成）
   * ----------------------------------------------------------- */
  var PYIN = [
    "bei jing da xue",
    "qing hua da xue",
    "zhong guo ren min da xue",
    "bei jing hang kong hang tian da xue",
    "bei jing li gong da xue",
    "bei jing shi fan da xue",
    "bei jing you dian da xue",
    "bei jing jiao tong da xue",
    "bei jing ke ji da xue",
    "zhong yang cai jing da xue",
    "dui wai jing ji mao yi da xue",
    "zhong guo zheng fa da xue",
    "bei jing wai guo yu da xue",
    "nan kai da xue",
    "tian jin da xue",
    "tian jin yi ke da xue",
    "he bei gong ye da xue",
    "fu dan da xue",
    "shang hai jiao tong da xue",
    "tong ji da xue",
    "hua dong shi fan da xue",
    "hua dong li gong da xue",
    "shang hai da xue",
    "dong hua da xue",
    "shang hai cai jing da xue",
    "shang hai wai guo yu da xue",
    "chong qing da xue",
    "xi nan da xue",
    "xi nan zheng fa da xue",
    "chong qing you dian da xue",
    "chong qing jiao tong da xue",
    "he bei da xue",
    "yan shan da xue",
    "he bei shi fan da xue",
    "tai yuan li gong da xue",
    "shan xi da xue",
    "nei meng gu da xue",
    "dong bei da xue",
    "liao ning da xue",
    "da lian li gong da xue",
    "da lian hai shi da xue",
    "dong bei cai jing da xue",
    "ji lin da xue",
    "dong bei shi fan da xue",
    "ha er bin gong ye da xue",
    "ha er bin gong cheng da xue",
    "dong bei lin ye da xue",
    "nan jing da xue",
    "dong nan da xue",
    "nan jing hang kong hang tian da xue",
    "nan jing li gong da xue",
    "he hai da xue",
    "nan jing shi fan da xue",
    "su zhou da xue",
    "jiang nan da xue",
    "zhong guo kuang ye da xue",
    "zhe jiang da xue",
    "hang zhou dian zi ke ji da xue",
    "zhe jiang gong ye da xue",
    "ning bo da xue",
    "zhong guo ke xue ji shu da xue",
    "he fei gong ye da xue",
    "an hui da xue",
    "xia men da xue",
    "ji mei da xue",
    "fu zhou da xue",
    "hua qiao da xue",
    "nan chang da xue",
    "jiang xi cai jing da xue",
    "shan dong da xue",
    "shan dong shi fan da xue",
    "zhong guo hai yang da xue",
    "qing dao da xue",
    "zheng zhou da xue",
    "he nan da xue",
    "wu han da xue",
    "hua zhong ke ji da xue",
    "wu han li gong da xue",
    "hua zhong shi fan da xue",
    "hua zhong nong ye da xue",
    "zhong nan cai jing zheng fa da xue",
    "zhong nan da xue",
    "hu nan da xue",
    "hu nan shi fan da xue",
    "guo fang ke ji da xue",
    "xiang tan da xue",
    "hu nan ke ji da xue",
    "zhong shan da xue",
    "hua nan li gong da xue",
    "ji nan da xue",
    "hua nan shi fan da xue",
    "guang dong gong ye da xue",
    "shen zhen da xue",
    "nan fang ke ji da xue",
    "shan tou da xue",
    "xiang gang da xue",
    "xiang gang zhong wen da xue",
    "xiang gang ke ji da xue",
    "xiang gang li gong da xue",
    "xiang gang cheng shi da xue",
    "ao men da xue",
    "ao men ke ji da xue",
    "guang xi da xue",
    "hai nan da xue",
    "dian zi ke ji da xue",
    "si chuan da xue",
    "xi nan jiao tong da xue",
    "xi nan cai jing da xue",
    "cheng du li gong da xue",
    "si chuan shi fan da xue",
    "xi nan shi you da xue",
    "cheng du xin xi gong cheng da xue",
    "xi hua da xue",
    "xi nan ke ji da xue",
    "gui zhou da xue",
    "yun nan da xue",
    "kun ming li gong da xue",
    "xi zang da xue",
    "xi an jiao tong da xue",
    "xi bei gong ye da xue",
    "xi an dian zi ke ji da xue",
    "xi bei da xue",
    "shan xi shi fan da xue",
    "chang an da xue",
    "lan zhou da xue",
    "qing hai da xue",
    "ning xia da xue",
    "xin jiang da xue",
    "shi he zi da xue",
    "zhong guo nong ye da xue",
    "zhong yang min zu da xue",
    "xi bei nong lin ke ji da xue",
    "bei jing gong ye da xue",
    "bei jing hua gong da xue",
    "bei jing lin ye da xue",
    "bei jing zhong yi yao da xue",
    "zhong guo chuan mei da xue",
    "bei jing ti yu da xue",
    "zhong yang yin yue xue yuan",
    "hua bei dian li da xue",
    "dong bei nong ye da xue",
    "yan bian da xue",
    "hai jun jun yi da xue",
    "zhong guo yao ke da xue",
    "nan jing nong ye da xue",
    "si chuan nong ye da xue",
    "kong jun jun yi da xue",
    "ao men cheng shi da xue",
    "zhong guo ke xue yuan da xue",
    "shen zhen li gong da xue",
    "xi hu da xue",
    "xiang gang zhong wen da xue shen zhen",
    "zhong guo di zhi da xue wu han",
    "zhong guo di zhi da xue bei jing",
    "zhong guo kuang ye da xue bei jing",
    "zhong guo shi you da xue hua dong",
    "zhong guo shi you da xue bei jing",
    "shang hai ke ji da xue",
    "shang hai niu yue da xue",
    "da wan qu da xue",
    "zhong guo she hui ke xue yuan da xue",
    "bei jing shi fan da xue xiang gang jin hui da xue lian he guo ji xue yuan",
    "kun shan du ke da xue",
    "xi jiao li wu pu da xue",
    "xiang gang ke ji da xue guang zhou",
    "xiang gang cheng shi da xue dong guan",
    "ha er bin gong ye da xue shen zhen",
    "ha er bin gong ye da xue wei hai",
    "shan dong da xue wei hai",  ];

  /* -----------------------------------------------------------
   * 1.6 标签（与 LIST 一一对应，生成；985 / 211 / 港五澳三 / 知名）
   * ----------------------------------------------------------- */
  var TAGS = [
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["211"],
    [],
    [],
    [],
    [],
    [],
    [],
    ["211"],
    [],
    ["211"],
    ["985", "211"],
    ["211"],
    ["985", "211"],
    ["211"],
    [],
    ["985", "211"],
    ["211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["985", "211"],
    [],
    [],
    [],
    ["985", "211"],
    ["211"],
    ["211"],
    ["985", "211"],
    [],
    ["211"],
    [],
    ["211"],
    [],
    ["985", "211"],
    [],
    ["985", "211"],
    [],
    ["211"],
    [],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["985", "211"],
    [],
    [],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["知名"],
    ["知名"],
    ["知名"],
    [],
    ["港五澳三"],
    ["港五澳三"],
    ["港五澳三"],
    ["港五澳三"],
    ["港五澳三"],
    ["港五澳三"],
    ["港五澳三"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    [],
    [],
    [],
    [],
    [],
    [],
    ["211"],
    ["211"],
    [],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["港五澳三"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["211"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["知名"],
    ["985", "211"],
    ["985", "211"],
    ["985", "211"],  ];

  /* -----------------------------------------------------------
   * 2. 常见简称 / 别名 → 规范校名（只收没有歧义的）
   * ----------------------------------------------------------- */
  var ALIAS = {
    "UIC": "北京师范大学-香港浸会大学联合国际学院",
    "ucas": "中国科学院大学",
    "uestc": "电子科技大学",
    "uic": "北京师范大学-香港浸会大学联合国际学院",
    "上交": "上海交通大学",
    "上海交大": "上海交通大学",
    "上科大": "上海科技大学",
    "上纽": "上海纽约大学",
    "上纽大": "上海纽约大学",
    "东北农大": "东北农业大学",
    "东北财经": "东北财经大学",
    "东南": "东南大学",
    "东财": "东北财经大学",
    "中传": "中国传媒大学",
    "中南财大": "中南财经政法大学",
    "中国农大": "中国农业大学",
    "中大": "中山大学",
    "中科大": "中国科学技术大学",
    "云大": "云南大学",
    "人大": "中国人民大学",
    "兰大": "兰州大学",
    "北体": "北京体育大学",
    "北化工": "北京化工大学",
    "北大": "北京大学",
    "北工大": "北京工业大学",
    "北师大": "北京师范大学",
    "北师港浸会": "北京师范大学-香港浸会大学联合国际学院",
    "北师港浸大": "北京师范大学-香港浸会大学联合国际学院",
    "北林": "北京林业大学",
    "北理工": "北京理工大学",
    "北航": "北京航空航天大学",
    "北邮": "北京邮电大学",
    "华东师大": "华东师范大学",
    "华中师大": "华中师范大学",
    "华工": "华南理工大学",
    "华电": "华北电力大学",
    "华科": "华中科技大学",
    "南农": "南京农业大学",
    "南大": "南京大学",
    "南科大": "南方科技大学",
    "厦大": "厦门大学",
    "合工大": "合肥工业大学",
    "吉大": "吉林大学",
    "同济": "同济大学",
    "哈工大": "哈尔滨工业大学",
    "哈工大威海": "哈尔滨工业大学（威海）",
    "哈工威": "哈尔滨工业大学（威海）",
    "哈工深": "哈尔滨工业大学（深圳）",
    "国科大": "中国科学院大学",
    "国防科大": "国防科技大学",
    "复旦": "复旦大学",
    "大湾区": "大湾区大学",
    "央音": "中央音乐学院",
    "山大威": "山东大学（威海）",
    "川农": "四川农业大学",
    "川大": "四川大学",
    "川师": "四川师范大学",
    "广工": "广东工业大学",
    "成电": "电子科技大学",
    "昆山杜克": "昆山杜克大学",
    "暨大": "暨南大学",
    "杭电": "杭州电子科技大学",
    "武大": "武汉大学",
    "河海": "河海大学",
    "浙大": "浙江大学",
    "深大": "深圳大学",
    "深理工": "深圳理工大学",
    "清华": "清华大学",
    "港中文": "香港中文大学",
    "港中深": "香港中文大学（深圳）",
    "港城大": "香港城市大学",
    "港城莞": "香港城市大学（东莞）",
    "港大": "香港大学",
    "港理工": "香港理工大学",
    "港科大": "香港科技大学",
    "港科广": "香港科技大学（广州）",
    "澳大": "澳门大学",
    "澳科大": "澳门科技大学",
    "电子科大": "电子科技大学",
    "矿大": "中国矿业大学",
    "社科大": "中国社会科学院大学",
    "第二军医大学": "海军军医大学",
    "第四军医大学": "空军军医大学",
    "西交": "西安交通大学",
    "西交利物浦": "西交利物浦大学",
    "西北工大": "西北工业大学",
    "西南交大": "西南交通大学",
    "西南科大": "西南科技大学",
    "西安交大": "西安交通大学",
    "西电": "西安电子科技大学",
    "西财": "西南财经大学",
    "贵大": "贵州大学",
    "贸大": "对外经济贸易大学",
    "郑大": "郑州大学",
    "重大": "重庆大学",  };

  var MAX_LEN = 40;   // 与注册表单的 maxlength 一致

  /* -----------------------------------------------------------
   * 2.5 自带括号的「另立门户」校区：
   *    归一化的比较键会丢掉括号（见 key()），于是「香港中文大学（深圳）」
   *    会撞上「香港中文大学」的键 —— 可它是另一所学校，校址在深圳，
   *    不能互相归一。带括号的行注册进 SPECIAL_NOTE，带括号的输入先查它；
   *    查到就落回该校区（带正根城市），查不到才落进 DIFFERENT_CAMPUS 护栏。
   * ----------------------------------------------------------- */
  var SPECIAL_DEFAULT = {
    "中国地质大学": "中国地质大学（武汉）",
    "中国石油大学": "中国石油大学（华东）",  };

  /* 比较用的 key：去括号补充说明、所有空白（含全角）、间隔号，再统一小写 */
  function key(text) {
    return String(text == null ? "" : text)
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[\s\u3000]+/g, "")
      .replace(/[·・.。]/g, "")
      .toLowerCase();
  }

  /* 括号里的补充说明（「（深圳）」「（清水河校区）」），只给护栏和另立门户用 */
  function notes(text) {
    var s = String(text == null ? "" : text);
    var out = "", m, re = /[（(]([^）)]*)[）)]/g;
    while ((m = re.exec(s))) out += m[1];
    return key(out);
  }

  /* 逐条建条目 + 索引；带括号校区单独进 SPECIAL_NOTE（与裸校名区分） */
  var ENTRY = [];            // 与 LIST 同序：{name,province,city,pinyin,initials,initial,tags}
  var INDEX = {};            // key(name) -> entry（裸校名）
  var SPECIAL_NOTE = {};     // key(裸校名) + "|" + 括号注释 -> 校区 entry
  var i;
  for (i = 0; i < LIST.length; i++) {
    var name = LIST[i][0], prv = LIST[i][1], city = LIST[i][2];
    var py = PYIN[i] || "", tgs = TAGS[i] || [];
    var entry = { name: name, province: prv, city: city, pinyin: py, tags: tgs.slice() };
    ENTRY.push(entry);
  }
  // initial / initials：由拼音派生（每个音节取首字母）
  for (i = 0; i < ENTRY.length; i++) {
    var syl = ENTRY[i].pinyin.split(/\s+/);
    var inits = [];
    for (var w = 0; w < syl.length; w++) { if (syl[w]) inits.push(syl[w].charAt(0)); }
    ENTRY[i].initials = inits.join("");
    ENTRY[i].initial = (inits[0] || "").toUpperCase();
  }
  for (i = 0; i < ENTRY.length; i++) {
    var e = ENTRY[i];
    var k = key(e.name);
    var n = notes(e.name);
    if (n) {
      SPECIAL_NOTE[k + "|" + n] = e;
    } else if (!(k in INDEX)) {
      INDEX[k] = e;
    }
  }
  // 裸校名 → 默认主校区（只对没有裸行可命中的另立门户校生效）
  // SPECIAL_DEFAULT 对象字面量由生成器在上方 2.5 段发射，此处直接引用。
  // 注意不能用 key() 匹配校区名（括号会剥掉、多校区会撞键），必须按 name 精确找。
  var SPECIAL_DEFAULT_2 = {};
  for (var dk in SPECIAL_DEFAULT) {
    if (!Object.prototype.hasOwnProperty.call(SPECIAL_DEFAULT, dk)) continue;
    var dk2 = key(dk);
    if (dk2 in INDEX) continue;              // 已有裸行，不需要兜底
    var want = SPECIAL_DEFAULT[dk];
    for (i = 0; i < ENTRY.length; i++) {
      if (ENTRY[i].name === want) { SPECIAL_DEFAULT_2[dk2] = ENTRY[i]; break; }
    }
  }

  var ALIAS_KEY = {};
  for (var alias in ALIAS) {
    if (Object.prototype.hasOwnProperty.call(ALIAS, alias)) {
      ALIAS_KEY[key(alias)] = ALIAS[alias];
    }
  }

  /* 这条输入是不是「挂在校名后面、其实是另一所学校」（护栏，只兜底未另立门户的） */
  var DIFFERENT_CAMPUS = [
    { school: "香港中文大学", marker: "深圳" }
  ];
  function isDifferentCampus(raw, hit) {
    var note = notes(raw);
    if (!note) return false;
    for (var i = 0; i < DIFFERENT_CAMPUS.length; i++) {
      var g = DIFFERENT_CAMPUS[i];
      if (key(g.school) === key(hit.name) && note.indexOf(key(g.marker)) >= 0) return true;
    }
    return false;
  }

  /* 把用户输入解析成列表里的那条学校记录；解析不出来返回 null */
  function entryOf(text) {
    if (text == null) return null;
    var k = key(text);
    if (!k) return null;
    var n = notes(text);
    // 1) 带括号且另立门户 → 先查 SPECIAL_NOTE（如 香港中文大学（深圳））
    if (n && SPECIAL_NOTE[k + "|" + n]) return SPECIAL_NOTE[k + "|" + n];
    // 2) 主表
    if (INDEX[k]) return isDifferentCampus(text, INDEX[k]) ? null : INDEX[k];
    // 3) 别名 → 规范名再走一遍
    var canonical = ALIAS_KEY[k];
    if (canonical) {
      var k2 = key(canonical);
      var n2 = notes(canonical);
      if (n2 && SPECIAL_NOTE[k2 + "|" + n2]) return SPECIAL_NOTE[k2 + "|" + n2];
      if (INDEX[k2]) return isDifferentCampus(text, INDEX[k2]) ? null : INDEX[k2];
    }
    // 4) 裸校名 → 默认主校区（「中国地质大学」→ 武汉）
    if (SPECIAL_DEFAULT_2[k]) return SPECIAL_DEFAULT_2[k];
    return null;
  }

  /* ------------------------------------------------------------------
   * 4. 对外 API
   * ------------------------------------------------------------------ */

  /* 归一后的校名：命中 → 规范名；否则原样（去首尾空白、压缩内部空白）降级 */
  function schoolOf(text) {
    var raw = String(text == null ? "" : text).replace(/[\s\u3000]+/g, " ").trim();
    if (!raw) return "";
    var hit = entryOf(raw);
    if (hit) return hit.name;
    return raw.slice(0, MAX_LEN);
  }

  function cityOf(text) {
    var hit = entryOf(text);
    return hit ? hit.city : "";
  }

  function provinceOf(text) {
    var hit = entryOf(text);
    return hit ? hit.province : "";
  }

  function pinyinOf(text) {
    var hit = entryOf(text);
    return hit ? hit.pinyin : "";
  }

  function initialsOf(text) {
    var hit = entryOf(text);
    return hit ? hit.initials : "";
  }

  function initialOf(text) {
    var hit = entryOf(text);
    return hit ? hit.initial : "";
  }

  /* 拷贝一份（外部改不到内部表）；顺带带上拼音/标签，供选择器直接用 */
  function schoolOptions() {
    var out = [];
    for (var j = 0; j < ENTRY.length; j++) {
      var e = ENTRY[j];
      out.push({ name: e.name, province: e.province, city: e.city,
                 pinyin: e.pinyin, initials: e.initials, initial: e.initial,
                 tags: e.tags.slice() });
    }
    return out;
  }

  /* 搜索：校名子串 / 别名 / 拼音 / 首字母，前缀靠前、其余靠后，最长 40 条 */
  function search(q) {
    var raw = String(q == null ? "" : q).trim();
    if (!raw) return [];
    var kq = key(raw);
    if (!kq) return [];
    var qAlnum = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    var head = [], tail = [];
    var canonicalOfQ = ALIAS_KEY[kq];
    for (i = 0; i < ENTRY.length; i++) {
      var e = ENTRY[i];
      var mn = key(e.name);
      var rank = -1;
      if (canonicalOfQ && key(canonicalOfQ) === mn) rank = 0;
      else if (mn === kq) rank = 0;
      else if (mn.indexOf(kq) === 0) rank = 1;
      else if (qAlnum && e.initials.indexOf(qAlnum) === 0) rank = 1;
      else if (mn.indexOf(kq) > 0) rank = 2;
      else if (qAlnum && e.pinyin.replace(/\s/g, "").indexOf(qAlnum) >= 0) rank = 3;
      else if (qAlnum && e.initials.indexOf(qAlnum) > 0) rank = 4;
      if (rank < 0) continue;
      (rank < 2 ? head : tail).push(e);
      if (head.length >= 40 && tail.length >= 40) break;
    }
    return head.concat(tail).slice(0, 40);
  }

  /* 按首字母取一组（拼音排序），给 A–Z 索引栏用 */
  function byInitial(letter) {
    var L = String(letter == null ? "" : letter).toUpperCase().replace(/[^A-Z]/g, "");
    if (!L) return [];
    var out = [];
    for (i = 0; i < ENTRY.length; i++) {
      if (ENTRY[i].initial === L) out.push(ENTRY[i]);
    }
    out.sort(function (a, b) { return a.pinyin < b.pinyin ? -1 : a.pinyin > b.pinyin ? 1 : 0; });
    return out;
  }

  return {
    schoolOf: schoolOf,
    cityOf: cityOf,
    provinceOf: provinceOf,
    schoolOptions: schoolOptions,
    pinyinOf: pinyinOf,
    initialsOf: initialsOf,
    initialOf: initialOf,
    search: search,
    byInitial: byInitial,
    cityCount: (function () {
      var seen = {}, n = 0;
      for (var j = 0; j < ENTRY.length; j++) {
        if (!seen[ENTRY[j].city]) { seen[ENTRY[j].city] = 1; n++; }
      }
      return n;
    })(),
    size: ENTRY.length,
    MAX_LEN: MAX_LEN
  };
})();
