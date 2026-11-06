# -*- coding: utf-8 -*-
"""校园拾光 · 学校主数据（唯一事实源）与 assets/js/campuses.js 生成器。

为什么要有这个文件（M3 = 高校选择器）
----------------------------------------------------------------------
注册页选校从 <datalist> 升级成「搜索 + 拼音首字母索引 + 标签」的高校选择器后，
名单口径必须能审计：985(39) / 211(112 个官方立项 = 39 985 + 73 非 985) /
港五澳三(8) / 点名六所(6)，差额为 0 或逐条注明（docs/PLAN_SCOPE_v4.md §6.5）。

因此把「权威名单 + 每行省/市 + 拼音 + 标签」收在同一处，campuses.js 由本脚本
生成并提交进仓库（CI 不联网、也不依赖 pypinyin；改数据改这里再重新生成）。
校验方向：tools/campus_compare.py 把产物 diff 回这份权威名单。

口径说明（按公开教育部立项名单整理）：
  - 985(39)：39 所均在录；211 名单包含全部 985。
  - 211(官方 112 个立项)：985 39 + 非 985 73；中国地质大学/中国矿业大学/
    中国石油大学按校区（武汉/北京、徐州/北京、华东/北京）拆为可选学校，
    但立项数各计 1，不影响 112。发布前请站主对 211 名单做一次点验。
  - 港五澳三(8)：香港大学、香港中文大学、香港科技大学、香港理工大学、
    香港城市大学、澳门大学、澳门科技大学、澳门城市大学。
  - 点名六所(6)：南方科技大学、深圳大学、中国科学院大学、深圳理工大学、
    香港中文大学（深圳）、西湖大学。

只增不删：最终名单 = 现有 LIST 129 行 + 新增 28 行。香港中文大学（深圳）
作为正式学校进入列表，但通过 SPECIAL 索引与「香港中文大学」区分，不互相归一。
"""

import io
import os
import json
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

# =====================================================================
# 一、学校数据：现有基线 129 行（保持原顺序与省/市不变，勿改）
# =====================================================================
BASE_ROWS = [
    # 北京
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
    # 天津
    ["南开大学", "天津市", "天津市"],
    ["天津大学", "天津市", "天津市"],
    ["天津医科大学", "天津市", "天津市"],
    ["河北工业大学", "天津市", "天津市"],
    # 上海
    ["复旦大学", "上海市", "上海市"],
    ["上海交通大学", "上海市", "上海市"],
    ["同济大学", "上海市", "上海市"],
    ["华东师范大学", "上海市", "上海市"],
    ["华东理工大学", "上海市", "上海市"],
    ["上海大学", "上海市", "上海市"],
    ["东华大学", "上海市", "上海市"],
    ["上海财经大学", "上海市", "上海市"],
    ["上海外国语大学", "上海市", "上海市"],
    # 重庆
    ["重庆大学", "重庆市", "重庆市"],
    ["西南大学", "重庆市", "重庆市"],
    ["西南政法大学", "重庆市", "重庆市"],
    ["重庆邮电大学", "重庆市", "重庆市"],
    ["重庆交通大学", "重庆市", "重庆市"],
    # 河北
    ["河北大学", "河北省", "保定市"],
    ["燕山大学", "河北省", "秦皇岛市"],
    ["河北师范大学", "河北省", "石家庄市"],
    # 山西 / 内蒙古
    ["太原理工大学", "山西省", "太原市"],
    ["山西大学", "山西省", "太原市"],
    ["内蒙古大学", "内蒙古自治区", "呼和浩特市"],
    # 辽宁
    ["东北大学", "辽宁省", "沈阳市"],
    ["辽宁大学", "辽宁省", "沈阳市"],
    ["大连理工大学", "辽宁省", "大连市"],
    ["大连海事大学", "辽宁省", "大连市"],
    ["东北财经大学", "辽宁省", "大连市"],
    # 吉林 / 黑龙江
    ["吉林大学", "吉林省", "长春市"],
    ["东北师范大学", "吉林省", "长春市"],
    ["哈尔滨工业大学", "黑龙江省", "哈尔滨市"],
    ["哈尔滨工程大学", "黑龙江省", "哈尔滨市"],
    ["东北林业大学", "黑龙江省", "哈尔滨市"],
    # 江苏
    ["南京大学", "江苏省", "南京市"],
    ["东南大学", "江苏省", "南京市"],
    ["南京航空航天大学", "江苏省", "南京市"],
    ["南京理工大学", "江苏省", "南京市"],
    ["河海大学", "江苏省", "南京市"],
    ["南京师范大学", "江苏省", "南京市"],
    ["苏州大学", "江苏省", "苏州市"],
    ["江南大学", "江苏省", "无锡市"],
    ["中国矿业大学", "江苏省", "徐州市"],
    # 浙江
    ["浙江大学", "浙江省", "杭州市"],
    ["杭州电子科技大学", "浙江省", "杭州市"],
    ["浙江工业大学", "浙江省", "杭州市"],
    ["宁波大学", "浙江省", "宁波市"],
    # 安徽
    ["中国科学技术大学", "安徽省", "合肥市"],
    ["合肥工业大学", "安徽省", "合肥市"],
    ["安徽大学", "安徽省", "合肥市"],
    # 福建
    ["厦门大学", "福建省", "厦门市"],
    ["集美大学", "福建省", "厦门市"],
    ["福州大学", "福建省", "福州市"],
    ["华侨大学", "福建省", "泉州市"],
    # 江西
    ["南昌大学", "江西省", "南昌市"],
    ["江西财经大学", "江西省", "南昌市"],
    # 山东
    ["山东大学", "山东省", "济南市"],
    ["山东师范大学", "山东省", "济南市"],
    ["中国海洋大学", "山东省", "青岛市"],
    ["青岛大学", "山东省", "青岛市"],
    # 河南
    ["郑州大学", "河南省", "郑州市"],
    ["河南大学", "河南省", "开封市"],
    # 湖北
    ["武汉大学", "湖北省", "武汉市"],
    ["华中科技大学", "湖北省", "武汉市"],
    ["武汉理工大学", "湖北省", "武汉市"],
    ["华中师范大学", "湖北省", "武汉市"],
    ["华中农业大学", "湖北省", "武汉市"],
    ["中南财经政法大学", "湖北省", "武汉市"],
    # 湖南
    ["中南大学", "湖南省", "长沙市"],
    ["湖南大学", "湖南省", "长沙市"],
    ["湖南师范大学", "湖南省", "长沙市"],
    ["国防科技大学", "湖南省", "长沙市"],
    ["湘潭大学", "湖南省", "湘潭市"],
    ["湖南科技大学", "湖南省", "湘潭市"],
    # 广东
    ["中山大学", "广东省", "广州市"],
    ["华南理工大学", "广东省", "广州市"],
    ["暨南大学", "广东省", "广州市"],
    ["华南师范大学", "广东省", "广州市"],
    ["广东工业大学", "广东省", "广州市"],
    ["深圳大学", "广东省", "深圳市"],
    ["南方科技大学", "广东省", "深圳市"],
    ["汕头大学", "广东省", "汕头市"],
    # 香港 / 澳门
    ["香港大学", "香港特别行政区", "香港"],
    ["香港中文大学", "香港特别行政区", "香港"],
    ["香港科技大学", "香港特别行政区", "香港"],
    ["香港理工大学", "香港特别行政区", "香港"],
    ["香港城市大学", "香港特别行政区", "香港"],
    ["澳门大学", "澳门特别行政区", "澳门"],
    ["澳门科技大学", "澳门特别行政区", "澳门"],
    # 广西 / 海南
    ["广西大学", "广西壮族自治区", "南宁市"],
    ["海南大学", "海南省", "海口市"],
    # 四川
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
    # 贵州 / 云南 / 西藏
    ["贵州大学", "贵州省", "贵阳市"],
    ["云南大学", "云南省", "昆明市"],
    ["昆明理工大学", "云南省", "昆明市"],
    ["西藏大学", "西藏自治区", "拉萨市"],
    # 陕西 / 甘肃 / 青海 / 宁夏 / 新疆
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
]

# =====================================================================
# 二、新增 28 行（只增不删的「增」）：
#    缺失 985：中国农业大学、中央民族大学、西北农林科技大学
#    缺失 211(非985)：北京工业大学 … 空军军医大学（详见各注释）
#    港五澳三补齐：澳门城市大学
#    点名六所补齐：中国科学院大学、深圳理工大学、西湖大学
#    另立门户校区：香港中文大学（深圳）、中国地质大学（武汉/北京）、
#                 中国矿业大学（北京）、中国石油大学（华东/北京）
# =====================================================================
ADD_ROWS = [
    # —— M3 新增：985 补齐（三所）
    ["中国农业大学", "北京市", "北京市"],
    ["中央民族大学", "北京市", "北京市"],
    ["西北农林科技大学", "陕西省", "咸阳市"],
    # —— M3 新增：211（非 985）补齐
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
    # —— M3 新增：港五澳三补齐 + 点名六所补齐
    ["澳门城市大学", "澳门特别行政区", "澳门"],
    ["中国科学院大学", "北京市", "北京市"],
    ["深圳理工大学", "广东省", "深圳市"],
    ["西湖大学", "浙江省", "杭州市"],
    # —— M3 新增：另立门户校区（不互相归一，见 SPECIAL 机制）
    ["香港中文大学（深圳）", "广东省", "深圳市"],
    ["中国地质大学（武汉）", "湖北省", "武汉市"],
    ["中国地质大学（北京）", "北京市", "北京市"],
    ["中国矿业大学（北京）", "北京市", "北京市"],
    ["中国石油大学（华东）", "山东省", "青岛市"],
    ["中国石油大学（北京）", "北京市", "北京市"],
    # —— V4-4 新增：知名大学 / 中外合办 / 异地校区（只增不删）
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
    ["山东大学（威海）", "山东省", "威海市"],
]

# =====================================================================
# 三、权威名单（口径见 docstring）
# =====================================================================
SET_985 = set([
    "北京大学", "中国人民大学", "清华大学", "北京航空航天大学",
    "北京理工大学", "中国农业大学", "北京师范大学", "中央民族大学",
    "南开大学", "天津大学", "大连理工大学", "东北大学", "吉林大学",
    "哈尔滨工业大学", "复旦大学", "同济大学", "上海交通大学",
    "华东师范大学", "南京大学", "东南大学", "浙江大学",
    "中国科学技术大学", "厦门大学", "山东大学", "中国海洋大学",
    "武汉大学", "华中科技大学", "湖南大学", "中南大学", "中山大学",
    "华南理工大学", "四川大学", "重庆大学", "电子科技大学",
    "西安交通大学", "西北工业大学", "兰州大学", "国防科技大学",
    "西北农林科技大学",
])

NON_985_211 = set([
    "北京交通大学", "北京工业大学", "北京科技大学", "北京化工大学",
    "北京邮电大学", "北京林业大学", "北京中医药大学", "北京外国语大学",
    "中国传媒大学", "中央财经大学", "对外经济贸易大学", "北京体育大学",
    "中央音乐学院", "中国政法大学", "华北电力大学", "天津医科大学",
    "河北工业大学", "太原理工大学", "内蒙古大学", "辽宁大学",
    "大连海事大学", "延边大学", "东北师范大学", "哈尔滨工程大学",
    "东北农业大学", "东北林业大学", "华东理工大学", "东华大学",
    "上海外国语大学", "上海财经大学", "上海大学", "海军军医大学",
    "南京航空航天大学", "南京理工大学", "中国矿业大学", "河海大学",
    "江南大学", "南京农业大学", "中国药科大学", "南京师范大学",
    "苏州大学", "合肥工业大学", "安徽大学", "福州大学", "南昌大学",
    "中国石油大学", "郑州大学", "中国地质大学", "武汉理工大学",
    "华中农业大学", "华中师范大学", "中南财经政法大学", "湖南师范大学",
    "暨南大学", "华南师范大学", "广西大学", "海南大学", "西南大学",
    "西南交通大学", "四川农业大学", "西南财经大学", "贵州大学",
    "云南大学", "西藏大学", "西北大学", "西安电子科技大学", "长安大学",
    "陕西师范大学", "空军军医大学", "青海大学", "宁夏大学", "新疆大学",
    "石河子大学",
])

assert len(SET_985) == 39, len(SET_985)
assert len(NON_985_211) == 73, len(NON_985_211)
# 官方「211 工程」共 112 个立项 = 985(39) + 非 985(73)。条目中
# 中国地质大学（武汉/北京）、中国矿业大学（徐州/北京）、中国石油大学
# （华东/北京）按校区拆为可选学校，但立项数仍各计 1，故不改变 112。
SET_211 = SET_985 | NON_985_211
assert len(SET_211) == 112, len(SET_211)

SET_GBA = set([
    "香港大学", "香港中文大学", "香港科技大学", "香港理工大学",
    "香港城市大学", "澳门大学", "澳门科技大学", "澳门城市大学",
])
SET_SIX = set([
    "南方科技大学", "深圳大学", "中国科学院大学", "深圳理工大学",
    "香港中文大学（深圳）", "西湖大学",
])

# 「知名大学」标签：原点名六所 + V4-4 新增的非 985/211 名校/中外合办。
# 985/211 的异地分校（哈尔滨工业大学（深圳/威海）、山东大学（威海）等）
# 不进本集合——由 tags_of 的 bare 剥括号逻辑自动归属 985/211，避免重复占位。
SET_KNOWN = SET_SIX | set([
    "上海科技大学", "上海纽约大学", "广东工业大学", "大湾区大学",
    "中国社会科学院大学", "北京师范大学-香港浸会大学联合国际学院",
    "昆山杜克大学", "西交利物浦大学", "香港科技大学（广州）",
    "香港城市大学（东莞）",
])

# 另立门户校区的「裸校名 → 默认主校区」，供 entryOf 第 4 步兜底
SPECIAL_DEFAULT = {
    "中国地质大学": "中国地质大学（武汉）",
    "中国石油大学": "中国石油大学（华东）",
}

# =====================================================================
# 四、别名补充分（并入现有 ALIAS；只收没有歧义的）
# =====================================================================
ALIAS_ADD = {
    "北工大": "北京工业大学",
    "北化工": "北京化工大学",
    "北林": "北京林业大学",
    "北体": "北京体育大学",
    "中传": "中国传媒大学",
    "央音": "中央音乐学院",
    "华电": "华北电力大学",
    "贸大": "对外经济贸易大学",
    "中国农大": "中国农业大学",
    "东北农大": "东北农业大学",
    "矿大": "中国矿业大学",
    "南农": "南京农业大学",
    "川农": "四川农业大学",
    "第二军医大学": "海军军医大学",
    "第四军医大学": "空军军医大学",
    "国科大": "中国科学院大学",
    "ucas": "中国科学院大学",
    "深理工": "深圳理工大学",
    "港中深": "香港中文大学（深圳）",
    # —— V4-4 新增简称（只收无歧义）——
    "北师港浸大": "北京师范大学-香港浸会大学联合国际学院",
    "北师港浸会": "北京师范大学-香港浸会大学联合国际学院",
    "UIC": "北京师范大学-香港浸会大学联合国际学院",
    "uic": "北京师范大学-香港浸会大学联合国际学院",
    "港科广": "香港科技大学（广州）",
    "港城莞": "香港城市大学（东莞）",
    "大湾区": "大湾区大学",
    "上科大": "上海科技大学",
    "社科大": "中国社会科学院大学",
    "广工": "广东工业大学",
    "西交利物浦": "西交利物浦大学",
    "昆山杜克": "昆山杜克大学",
    "上纽大": "上海纽约大学",
    "上纽": "上海纽约大学",
    "哈工深": "哈尔滨工业大学（深圳）",
    "哈工威": "哈尔滨工业大学（威海）",
    "山大威": "山东大学（威海）",
    "哈工大威海": "哈尔滨工业大学（威海）",
}

# =====================================================================
# 五、拼音（方案 A：键内置，零运行时依赖；开发期一次生成并提交）
# =====================================================================
def pinyin_of(name):
    from pypinyin import pinyin, Style
    out = []
    for seg in pinyin(name, style=Style.NORMAL):
        out.append(re.sub(r"[^a-z]", "", seg[0]))
    return " ".join([s for s in out if s])


def initials_of(pyin):
    return "".join(w[0] for w in pyin.split(" "))


def tags_of(name):
    out = []
    bare = re.sub(r"[（(][^）)]*[）)]", "", name)  # 校区行剥括号后按主体归 211/985
    if name in SET_985 or bare in SET_985:
        out.append("985")
    if name in SET_211 or bare in SET_211:
        out.append("211")
    if name in SET_GBA:
        out.append("港五澳三")
    if name in SET_KNOWN:
        out.append("知名")
    return out


def all_rows():
    return BASE_ROWS + ADD_ROWS


def rows_meta():
    out = []
    for name, prv, city in all_rows():
        py = pinyin_of(name)
        out.append({
            "name": name, "province": prv, "city": city,
            "pinyin": py, "initials": initials_of(py), "tags": tags_of(name),
        })
    return out


# =====================================================================
# 六、生成 campuses.js
# =====================================================================
JS_HEADER = (
    "/* =====================================================================\n"
    " *  校园拾光 · 学校固定列表（任务 D2 → M3 高校选择器）\n"
    " *  ---------------------------------------------------------------------\n"
    " *  本文件由 tools/campus_master.py 生成，勿手改；改数据请改那个文件后再生成。\n"
    " *\n"
    " *  名单口径（只增不删）：导师基线 129 行 + 后续新增（M3 28 行 + V4 名校 12 行），覆盖\n"
    " *  985(39) / 211(官方 112 立项) / 港五澳三(8) / 点名六所(6)，口径注释见\n"
    " *  tools/campus_master.py 与 docs/PLAN_SCOPE_v4.md §6.5，差异审计见\n"
    " *  tools/campus_compare.py。\n"
    " *\n"
    " *  为什么用受控列表而不让用户乱填：原「××大学」「××大学 」会被当成两所\n"
    " *  学校，「同城 / 同校筛选」就没法做。命中列表的输入被归一；找不到的学校\n"
    " *  照原样收下（降级），仍能注册，只是暂时没有城市。城市是「只看同城」的\n"
    " *  依据（provinceOf 是城市圈分圈的唯一依据，见 circles.js），每行必须填准。\n"
    " *\n"
    " *  新增搜索能力（给校外选择器）：pinyinOf / initialsOf / initialOf /\n"
    " *  search / byInitial，拼音与标签已内置在数据里（方案 A，零运行时依赖）。\n"
    " * ===================================================================== */\n"
)


def _js(o):
    return json.dumps(o, ensure_ascii=False)


def generate_campuses_js():
    rows = rows_meta()
    list_lines = []
    for i, r in enumerate(rows):
        list_lines.append("    [%s, %s, %s]," % (_js(r["name"]), _js(r["province"]), _js(r["city"])))
    pyin_lines = ["    %s," % _js(r["pinyin"]) for r in rows]
    tags_lines = ["    %s," % _js(r["tags"]) for r in rows]

    alias = {
        "电子科大": "电子科技大学", "成电": "电子科技大学", "uestc": "电子科技大学",
        "川大": "四川大学", "西南交大": "西南交通大学", "西财": "西南财经大学",
        "川师": "四川师范大学", "西南科大": "西南科技大学", "北大": "北京大学",
        "清华": "清华大学", "人大": "中国人民大学", "北航": "北京航空航天大学",
        "北理工": "北京理工大学", "北师大": "北京师范大学", "北邮": "北京邮电大学",
        "复旦": "复旦大学", "上交": "上海交通大学", "上海交大": "上海交通大学",
        "同济": "同济大学", "华东师大": "华东师范大学", "华中师大": "华中师范大学",
        "南大": "南京大学", "东南": "东南大学", "河海": "河海大学", "浙大": "浙江大学",
        "杭电": "杭州电子科技大学", "中科大": "中国科学技术大学", "合工大": "合肥工业大学",
        "厦大": "厦门大学", "武大": "武汉大学", "华科": "华中科技大学",
        "中南财大": "中南财经政法大学", "中大": "中山大学", "华工": "华南理工大学",
        "暨大": "暨南大学", "深大": "深圳大学", "南科大": "南方科技大学",
        "港大": "香港大学", "港中文": "香港中文大学", "港科大": "香港科技大学",
        "港理工": "香港理工大学", "港城大": "香港城市大学", "澳大": "澳门大学",
        "澳科大": "澳门科技大学", "哈工大": "哈尔滨工业大学", "吉大": "吉林大学",
        "兰大": "兰州大学", "西交": "西安交通大学", "西安交大": "西安交通大学",
        "西电": "西安电子科技大学", "西北工大": "西北工业大学", "重大": "重庆大学",
        "郑大": "郑州大学", "云大": "云南大学", "贵大": "贵州大学",
        "国防科大": "国防科技大学", "东北财经": "东北财经大学", "东财": "东北财经大学",
    }
    alias.update(ALIAS_ADD)
    alias_lines = ["    %s: %s," % (_js(k), _js(v)) for k, v in sorted(alias.items(), key=lambda kv: kv[0])]

    default_lines = ["    %s: %s," % (_js(k), _js(v))
                     for k, v in sorted(SPECIAL_DEFAULT.items(), key=lambda kv: kv[0])]

    parts = [JS_HEADER]
    parts.append("/* 宿主兼容：浏览器挂 window，Node / 沙箱挂 globalThis（替身同样模拟 window） */\n")
    parts.append("var CAMPUS_HOST = (typeof window !== \"undefined\" ? window :\n")
    parts.append("                (typeof globalThis !== \"undefined\" ? globalThis : {}));\n")
    parts.append("CAMPUS_HOST.CampusList = (function () {\n  \"use strict\";\n\n")
    parts.append("  /* -----------------------------------------------------------\n")
    parts.append("   * 1. 学校：[校名, 省 / 自治区 / 直辖市, 城市]（生成，共 %d 行）\n" % len(rows))
    parts.append("   * ----------------------------------------------------------- */\n")
    parts.append("  var LIST = [\n")
    parts.append("\n".join(list_lines))
    parts.append("  ];\n\n")
    parts.append("  /* -----------------------------------------------------------\n")
    parts.append("   * 1.5 拼音与首字母（与 LIST 一一对应，生成）\n")
    parts.append("   * ----------------------------------------------------------- */\n")
    parts.append("  var PYIN = [\n")
    parts.append("\n".join(pyin_lines))
    parts.append("  ];\n\n")
    parts.append("  /* -----------------------------------------------------------\n")
    parts.append("   * 1.6 标签（与 LIST 一一对应，生成；985 / 211 / 港五澳三 / 知名）\n")
    parts.append("   * ----------------------------------------------------------- */\n")
    parts.append("  var TAGS = [\n")
    parts.append("\n".join(tags_lines))
    parts.append("  ];\n\n")
    parts.append("  /* -----------------------------------------------------------\n")
    parts.append("   * 2. 常见简称 / 别名 → 规范校名（只收没有歧义的）\n")
    parts.append("   * ----------------------------------------------------------- */\n")
    parts.append("  var ALIAS = {\n")
    parts.append("\n".join(alias_lines))
    parts.append("  };\n\n")
    parts.append("  var MAX_LEN = 40;   // 与注册表单的 maxlength 一致\n\n")
    parts.append("  /* -----------------------------------------------------------\n")
    parts.append("   * 2.5 自带括号的「另立门户」校区：\n")
    parts.append("   *    归一化的比较键会丢掉括号（见 key()），于是「香港中文大学（深圳）」\n")
    parts.append("   *    会撞上「香港中文大学」的键 —— 可它是另一所学校，校址在深圳，\n")
    parts.append("   *    不能互相归一。带括号的行注册进 SPECIAL_NOTE，带括号的输入先查它；\n")
    parts.append("   *    查到就落回该校区（带正根城市），查不到才落进 DIFFERENT_CAMPUS 护栏。\n")
    parts.append("   * ----------------------------------------------------------- */\n")
    parts.append("  var SPECIAL_DEFAULT = {\n")
    parts.append("\n".join(default_lines))
    parts.append("  };\n\n")
    parts.append(JSS_RUNTIME)
    return "".join(parts)


JSS_RUNTIME = r"""  /* 比较用的 key：去括号补充说明、所有空白（含全角）、间隔号，再统一小写 */
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
"""


if __name__ == "__main__":
    import sys
    if "--check" in sys.argv:
        rows = rows_meta()
        from collections import Counter
        names = [r["name"] for r in rows]
        dup = [k for k, v in Counter(names).items() if v > 1]
        print("rows=", len(names), "dup=", dup)
        nameset = set(names)
        # 「立项主体名」可能以裸招生办名之外的校区名入库；SPECIAL_DEFAULT 的
        # 裸名（如「中国地质大学」→「中国地质大学（武汉）」）视为已覆盖。
        covered = set(nameset)
        for bare, default in SPECIAL_DEFAULT.items():
            if default in nameset:
                covered.add(bare)
        for s, label in ((SET_985, "985"), (SET_211, "211"), (SET_GBA, "港五澳三"), (SET_SIX, "点名六所")):
            missing = sorted(s - covered)
            print(label, "count=", len(s), "missing_from_list=", missing)
        print("pinyin sample:")
        for r in rows[:6]:
            print("  ", r["name"], r["pinyin"], r["initials"], r["tags"])
    else:
        text = generate_campuses_js()
        with io.open(os.path.join(ROOT, "assets", "js", "campuses.js"), "w",
                     encoding="utf-8", newline="\n") as f:
            f.write(text)
        print("wrote assets/js/campuses.js (%d chars)" % len(text))
