# -*- coding: utf-8 -*-
"""校园名单差异审计：campus_master 权威集合 vs 生成产物 campuses.js。

用途：每次改名单 / 生成 campuses.js 后运行，确认：
  1) 985(39) / 211(官方 112 立项) / 港五澳三(8) / 点名六所(6) / 知名(16) 全覆盖；
  2) 基线 129 行「只增不删」（导师基线逐行仍在）；
  3) LIST 行数 = 169，TAGS 与 LIST 一一对应；
  4) 211 立项口径：112 = 39 所 985 + 73 所非 985，拆校区不增加立项数。

退出码：0 全部通过；1 有差异。
"""

import io
import os
import re
import sys


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 权威集合直接来自数据源（唯一事实源，避免两边漂移）
import campus_master as CM

SET_985 = CM.SET_985
SET_211 = CM.SET_211          # 立项名集合（112 = 39 + 73）
SET_GBA = CM.SET_GBA
SET_SIX = CM.SET_SIX
SET_KNOWN = CM.SET_KNOWN      # 知名大学（原点名六所 + V4-4 新增非 985/211）
SPECIAL_DEFAULT = CM.SPECIAL_DEFAULT

# 基线 129 行（导师名单）——从本仓库 HEAD 固化的只增不删基线。
# 若 HEAD 列表有变动，先更新此处，并在注释写明原因。
BASELINE_129 = [
    "北京大学", "清华大学", "中国人民大学", "北京航空航天大学", "北京理工大学",
    "北京师范大学", "北京邮电大学", "北京交通大学", "北京科技大学", "中央财经大学",
    "对外经济贸易大学", "中国政法大学", "北京外国语大学", "南开大学", "天津大学",
    "天津医科大学", "河北工业大学", "复旦大学", "上海交通大学", "同济大学",
    "华东师范大学", "华东理工大学", "上海大学", "东华大学", "上海财经大学",
    "上海外国语大学", "重庆大学", "西南大学", "西南政法大学", "重庆邮电大学",
    "重庆交通大学", "河北大学", "燕山大学", "河北师范大学", "太原理工大学",
    "山西大学", "内蒙古大学", "东北大学", "辽宁大学", "大连理工大学",
    "大连海事大学", "东北财经大学", "吉林大学", "东北师范大学", "哈尔滨工业大学",
    "哈尔滨工程大学", "东北林业大学", "南京大学", "东南大学", "南京航空航天大学",
    "南京理工大学", "河海大学", "南京师范大学", "苏州大学", "江南大学",
    "中国矿业大学", "浙江大学", "杭州电子科技大学", "浙江工业大学", "宁波大学",
    "中国科学技术大学", "合肥工业大学", "安徽大学", "厦门大学", "集美大学",
    "福州大学", "华侨大学", "南昌大学", "江西财经大学", "山东大学",
    "山东师范大学", "中国海洋大学", "青岛大学", "郑州大学", "河南大学",
    "武汉大学", "华中科技大学", "武汉理工大学", "华中师范大学", "华中农业大学",
    "中南财经政法大学", "中南大学", "湖南大学", "湖南师范大学", "国防科技大学",
    "湘潭大学", "湖南科技大学", "中山大学", "华南理工大学", "暨南大学",
    "华南师范大学", "广东工业大学", "深圳大学", "南方科技大学", "汕头大学",
    "香港大学", "香港中文大学", "香港科技大学", "香港理工大学", "香港城市大学",
    "澳门大学", "澳门科技大学", "广西大学", "海南大学", "电子科技大学",
    "四川大学", "西南交通大学", "西南财经大学", "成都理工大学", "四川师范大学",
    "西南石油大学", "成都信息工程大学", "西华大学", "西南科技大学", "贵州大学",
    "云南大学", "昆明理工大学", "西藏大学", "西安交通大学", "西北工业大学",
    "西安电子科技大学", "西北大学", "陕西师范大学", "长安大学", "兰州大学",
    "青海大学", "宁夏大学", "新疆大学", "石河子大学",
]


def read_campuses_js():
    """返回 (names, tags)：LIST 的校名行与 TAGS 的并行数组。"""
    path = os.path.join(ROOT, "assets", "js", "campuses.js")
    with io.open(path, encoding="utf-8") as f:
        src = f.read()
    m_list = re.search(r"var LIST = \[(.*?)\];", src, re.S)
    m_tags = re.search(r"var TAGS = \[(.*?)\];", src, re.S)
    if not m_list or not m_tags:
        raise SystemExit("无法在 campuses.js 里定位 LIST / TAGS 块")
    names = re.findall(r'\["(.*?)"\s*,\s*"', m_list.group(1))
    tags = [
        re.findall(r'"([^"]*)"', t)
        for t in re.findall(r"\[(.*?)\]", m_tags.group(1), re.S)
    ]
    return names, tags


def covered_mapping():
    """校名行 + SPECIAL_DEFAULT 裸名的可命中集合：{可输入名: 目标规范名}。"""
    names, _ = read_campuses_js()
    mapping = {n: n for n in names}
    for bare, default in SPECIAL_DEFAULT.items():
        if default in names:
            mapping[bare] = default
    return mapping


def main():
    names, tags = read_campuses_js()
    problems = []
    notes = []

    # 1) 行数约束：基线不删，总量 = 169
    n = len(names)
    if len(tags) != n:
        problems.append("TAGS 行数 %d 与 LIST 行数 %d 不一致" % (len(tags), n))
    if n != 169:
        problems.append("LIST 行数 = %d（应为 169）" % n)

    miss_baseline = set(BASELINE_129) - set(names)
    if miss_baseline:
        problems.append("基线 129 行中有 %d 所缺失：%s"
                        % (len(miss_baseline), "、".join(sorted(miss_baseline))))

    # 2) 权威集合全覆盖（立项名 ↔ 可命中名，用 SPECIAL_DEFAULT 兜底）
    mapping = covered_mapping()
    hit = set(mapping)
    checks = [
        ("985", SET_985, 39),
        ("211 立项(112=39+73)", SET_211, 112),
        ("港五澳三", SET_GBA, 8),
        ("点名六所", SET_SIX, 6),
        ("知名", SET_KNOWN, 16),
    ]
    for label, wanted, expect in checks:
        if len(wanted) != expect:
            problems.append("%s 权威集合长度 = %d（应为 %d）" % (label, len(wanted), expect))
        missing = sorted(wanted - hit)
        if missing:
            problems.append("%s 缺 %d 所：%s" % (label, len(missing), "、".join(missing)))

    # 3) 每个立项名的 tags 一致性（产物 tag 必须等于权威推导 tag）
    for i, nm in enumerate(names):
        tg = set(tags[i]) if i < len(tags) else set()
        their_tags = set(CM.tags_of(nm))
        if tg != their_tags:
            problems.append("第 %d 行 %s 的 tags=%s 与权威推导 %s 不一致"
                            % (i + 1, nm, sorted(tg), sorted(their_tags)))
    if not problems:
        notes.append("985=39、211 立项=112(985 39+非985 73)、港五澳三=8、点名六所=6、知名=16")
        notes.append("基线 129 行全部仍在，总量 169，TAGS 与 LIST 一一对应")

    print("校园名单差异审计")
    print("=" * 46)
    print("LIST 行数：%d（含基线 %d 行 + 后续新增 %d 行）"
          % (n, len(BASELINE_129), n - len(BASELINE_129)))
    for k in notes:
        print("  OK  " + k)
    for p in problems:
        print("  FAIL " + p)
    print("-" * 46)
    print("checks run: %d   failures: %d"
          % (5 + len(BASELINE_129) + 1 + n, len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
