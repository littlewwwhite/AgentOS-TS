#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Props 字段检查脚本
用于验证生成的 JSON 文件中 props 字段是否符合规则
"""

import json
import sys
from pathlib import Path


# 定义不应该出现在 props 中的环境元素关键词
FORBIDDEN_PROPS_KEYWORDS = {
    # 场所家具
    "床榻", "床", "桌", "椅子", "红木", "家具", "屏风", "地板", "凳",
    # 建筑结构
    "门", "窗", "墙", "柱", "廊", "梁", "门槛", "府门", "宫门",
    # 光影效果
    "烛火", "灯火", "光", "影", "阴影", "光斑", "光线",
    # 床上用品
    "被", "枕", "褥", "帐", "锦被",
    # 其他固有元素
    "地砖", "石板", "台阶", "粗布", "布帘"
    # 注意: 轮椅、拐杖等辅助工具应该写入 props（因角色特殊状态而存在）
}

# 允许的特殊道具（即使包含禁止关键词也允许）
ALLOWED_PROPS = {
    "轮椅", "拐杖", "眼镜"
}


def check_props_field(json_file):
    """检查 JSON 文件中的 props 字段"""

    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    errors = []
    warnings = []

    # 遍历所有 scenes 和 segments
    for scene in data.get('scenes', []):
        scene_id = scene.get('scene_id', 'Unknown')

        for segment in scene.get('segments', []):
            segment_id = segment.get('segment_id', 'Unknown')
            props = segment.get('props', [])
            scene_name = segment.get('scene', '')

            if props:
                invalid_props = []
                for prop in props:
                    # 先检查是否在允许列表中
                    if prop in ALLOWED_PROPS:
                        continue

                    # 检查是否包含禁止的关键词
                    for forbidden in FORBIDDEN_PROPS_KEYWORDS:
                        if forbidden in prop:
                            invalid_props.append(prop)
                            break

                if invalid_props:
                    errors.append({
                        "segment_id": segment_id,
                        "scene": scene_name,
                        "invalid_props": invalid_props,
                        "all_props": props
                    })

    # 输出报告
    print(f"\n=== Props 字段检查报告 ===")
    print(f"文件: {json_file}")
    print(f"\n检查规则:")
    print(f"  - 禁止将场景中固有的环境元素写入 props")
    print(f"  - 包括: 建筑结构、场所家具、光影效果、床上用品等")
    print(f"  - 应写入 props 的是角色专门携带或使用的具体道具")
    print(f"  - 判断标准: 该物品是否因场景或人物身份而自然存在?")

    if errors:
        print(f"\n[ERROR] 发现 {len(errors)} 个 segment 的 props 字段有问题:")
        for error in errors:
            print(f"\n  {error['segment_id']}:")
            print(f"    场景: {error['scene']}")
            print(f"    错误的 props: {error['invalid_props']}")
            print(f"    建议: 删除这些场景固有元素,只保留角色携带的道具")

    if not errors:
        print(f"\n[OK] 所有 props 字段符合规则!")
        return 0
    else:
        print(f"\n[ERROR] 检查未通过,请修正上述 props 字段")
        return 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python check_props_field.py <json_file>")
        sys.exit(1)

    json_file = sys.argv[1]
    if not Path(json_file).exists():
        print(f"错误: 文件不存在: {json_file}")
        sys.exit(1)

    sys.exit(check_props_field(json_file))
