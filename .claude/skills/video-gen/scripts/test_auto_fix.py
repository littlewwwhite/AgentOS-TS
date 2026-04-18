#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试自动修复人物连续性功能"""

import sys
sys.path.insert(0, 'scripts')

from generate_episode_json import has_character_in_action

# 测试用例
characters = ["李渊", "李世民", "李建成", "白行风", "灵霜"]

test_cases = [
    # 真正的环境镜头（应该返回False，需要添加远景）
    ("大殿内景，金色光柱从穹顶直射而下", False, "纯环境描述"),
    ("巍峨大殿，烛火摇曳", False, "环境+光线描述"),
    ("镜头缓缓推进，展现大殿全貌", False, "镜头运动描述"),
    ("阳光透过窗户洒在地面上", False, "光线描述"),
    ("昏暗寝宫，烛火摇曳", False, "环境描述"),

    # 包含角色名称（应该返回True）
    ("李渊站在龙椅前，表情凝重", True, "包含角色名称"),
    ("李世民转身离开，李建成紧随其后", True, "包含多个角色"),
    ("白行风一袭白衣立于光柱中央", True, "包含角色名称"),

    # 缺少主语的人物动作（应该返回True，不需要添加远景）
    ("双手结印按在丹田位置，额头青筋暴起", True, "身体部位-双手+额头"),
    ("瞳孔骤缩，身体僵住", True, "身体部位-瞳孔+身体"),
    ("嘴角勾起一抹不易察觉的冷笑", True, "身体部位-嘴角+表情"),
    ("手掌从腹部缓缓抽出，掌心托着一颗金色内丹", True, "身体部位-手掌+腹部"),
    ("眼神温柔", True, "身体部位-眼神"),
    ("脸色惨白如纸，额头冷汗密布", True, "身体部位-脸色+额头"),
    ("泪水滑落", True, "表情特征-泪水"),
    ("鲜血喷涌而出，染红白衣", True, "血迹特征"),

    # 人物动作词（应该返回True）
    ("他走向大殿中央", True, "人物动作词-他走"),
    ("盘膝坐在床边，深吸一口气", True, "人物动作词-盘膝"),
    ("猛地撕开衣襟，右手化掌刀刺入自己腹部", True, "人物动作词-撕开+刺入+右手"),
]

print("测试 has_character_in_action() 函数（优化版）")
print("=" * 80)

passed = 0
failed = 0

for action_text, expected, description in test_cases:
    result = has_character_in_action(action_text, characters)
    status = "[OK]" if result == expected else "[FAIL]"

    if result == expected:
        passed += 1
    else:
        failed += 1

    print(f"{status} {description}")
    print(f"  文本: {action_text}")
    print(f"  预期: {expected}, 实际: {result}")
    if result != expected:
        print(f"  >>> 测试失败！")
    print()

print("=" * 80)
print(f"测试完成！通过: {passed}/{len(test_cases)}, 失败: {failed}/{len(test_cases)}")
