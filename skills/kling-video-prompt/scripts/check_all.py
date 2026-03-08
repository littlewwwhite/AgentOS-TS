#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
综合格式检查脚本
同时检查 prompts 和 props 字段格式
"""

import json
import sys
from pathlib import Path


# Props 字段禁止的关键词
FORBIDDEN_PROPS_KEYWORDS = {
    "床榻", "床", "桌", "椅子", "红木", "家具", "屏风", "地板", "凳",
    "门", "窗", "墙", "柱", "廊", "梁", "门槛", "府门", "宫门",
    "烛火", "灯火", "光", "影", "阴影", "光斑", "光线",
    "被", "枕", "褥", "帐", "锦被",
    "地砖", "石板", "台阶", "粗布", "布帘"
    # 注意: 轮椅、拐杖等辅助工具应该写入 props（因角色特殊状态而存在）
}

# 允许的特殊道具（即使包含禁止关键词也允许）
ALLOWED_PROPS = {
    "轮椅", "拐杖", "眼镜"
}


def check_json_format(json_file):
    """综合检查 JSON 文件格式"""

    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    prompts_errors = []
    props_errors = []
    placeholder_errors = []

    # 占位符模式
    placeholder_patterns = [
        "待添加", "TODO", "to be added", "to be filled",
        "根据剧本内容添加", "Detailed descriptions to be added",
        "[", "]"  # 检查方括号（通常用于占位符）
    ]

    # 遍历所有 scenes 和 segments
    for scene in data.get('scenes', []):
        scene_id = scene.get('scene_id', 'Unknown')

        for segment in scene.get('segments', []):
            segment_id = segment.get('segment_id', 'Unknown')

            # === 检查 Prompts 字段 ===
            prompts_field = f"{segment_id}_prompts"
            prompts_cn_field = f"{segment_id}_prompts_cn"

            # 检查错误的 prompts 字段
            if 'prompts' in segment:
                prompts_value = segment['prompts']
                if isinstance(prompts_value, dict):
                    prompts_errors.append(f"{segment_id}: prompts 是对象类型,应该是字符串")
                else:
                    prompts_errors.append(f"{segment_id}: 使用了错误的字段名 'prompts',应该是 '{prompts_field}'")

            # 检查字段命名和类型
            if prompts_field not in segment:
                prompts_errors.append(f"{segment_id}: 缺少 '{prompts_field}' 字段")
            elif not isinstance(segment[prompts_field], str):
                prompts_errors.append(f"{segment_id}: '{prompts_field}' 必须是字符串类型")
            else:
                # 检查占位符
                prompts_content = segment[prompts_field]
                for pattern in placeholder_patterns:
                    if pattern in prompts_content:
                        placeholder_errors.append(f"{segment_id}: '{prompts_field}' 包含占位符文本")
                        break

            if prompts_cn_field not in segment:
                prompts_errors.append(f"{segment_id}: 缺少 '{prompts_cn_field}' 字段")
            elif not isinstance(segment[prompts_cn_field], str):
                prompts_errors.append(f"{segment_id}: '{prompts_cn_field}' 必须是字符串类型")
            else:
                # 检查占位符
                prompts_cn_content = segment[prompts_cn_field]
                for pattern in placeholder_patterns:
                    if pattern in prompts_cn_content:
                        placeholder_errors.append(f"{segment_id}: '{prompts_cn_field}' 包含占位符文本")
                        break

            # === 检查 Props 字段 ===
            props = segment.get('props', [])
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
                    props_errors.append({
                        "segment_id": segment_id,
                        "scene": segment.get('scene', 'N/A'),
                        "invalid_props": invalid_props
                    })

    # 输出报告
    print(f"\n=== JSON 格式综合检查报告 ===")
    print(f"文件: {json_file}\n")

    # Prompts 检查结果
    print("=" * 50)
    print("1. Prompts 字段检查")
    print("=" * 50)
    if prompts_errors:
        print(f"[ERROR] 发现 {len(prompts_errors)} 个 prompts 格式错误:")
        for error in prompts_errors:
            print(f"  - {error}")
    else:
        print("[OK] Prompts 字段格式正确")

    # 占位符检查结果
    print("\n" + "=" * 50)
    print("2. Prompts 占位符检查")
    print("=" * 50)
    if placeholder_errors:
        print(f"[ERROR] 发现 {len(placeholder_errors)} 个 segment 包含占位符:")
        for error in placeholder_errors:
            print(f"  - {error}")
        print("\n  提示: 必须根据剧本内容生成完整的提示词,不能使用占位符")
    else:
        print("[OK] 无占位符文本")

    # Props 检查结果
    print("\n" + "=" * 50)
    print("3. Props 字段检查")
    print("=" * 50)
    if props_errors:
        print(f"[ERROR] 发现 {len(props_errors)} 个 segment 的 props 有问题:")
        for error in props_errors:
            print(f"  - {error['segment_id']} ({error['scene']}): {error['invalid_props']}")
    else:
        print("[OK] Props 字段内容正确")

    # 总结
    print("\n" + "=" * 50)
    print("检查总结")
    print("=" * 50)
    total_errors = len(prompts_errors) + len(placeholder_errors) + len(props_errors)
    if total_errors == 0:
        print("[OK] 所有检查通过!")
        return 0
    else:
        print(f"[ERROR] 发现 {total_errors} 个问题,请修正后重新检查")
        return 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python check_all.py <json_file>")
        sys.exit(1)

    json_file = sys.argv[1]
    if not Path(json_file).exists():
        print(f"错误: 文件不存在: {json_file}")
        sys.exit(1)

    sys.exit(check_json_format(json_file))
