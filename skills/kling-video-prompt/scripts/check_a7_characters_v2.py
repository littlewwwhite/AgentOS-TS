#!/usr/bin/env python3
"""
A7 检查：characters 字段完整性检查（v2版本）
检查提示词中提到的所有人物（无论是否用【】标记）是否都在 characters 字段中
"""

import json
import sys
from pathlib import Path


def check_a7_characters(json_path: str, auto_fix: bool = False):
    """
    检查并修复 characters 字段完整性

    Args:
        json_path: JSON 文件路径
        auto_fix: 是否自动修复
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    issues = []
    fixed_count = 0

    for scene in data.get('scenes', []):
        scene_id = scene.get('scene_id', '')
        # 获取该场景中所有可能出现的人物
        characters_all = set(scene.get('characters_all', []))

        for segment in scene.get('segments', []):
            segment_id = segment.get('segment_id', '')
            characters_field = set(segment.get('characters', []))

            # 获取提示词
            prompt_cn_key = f"{segment_id}_prompts_cn"
            prompt_cn = segment.get(prompt_cn_key, '')

            if not prompt_cn:
                continue

            # 查找提示词中提到的所有人物
            mentioned_characters = set()
            for char in characters_all:
                if char in prompt_cn:
                    mentioned_characters.add(char)

            # 检查缺失的人物
            missing = mentioned_characters - characters_field

            if missing:
                issue = {
                    'segment_id': segment_id,
                    'characters_field': list(characters_field),
                    'mentioned_in_prompt': list(mentioned_characters),
                    'missing': list(missing)
                }
                issues.append(issue)

                if auto_fix:
                    # 自动补全缺失的人物
                    # 按照在提示词中首次出现的顺序添加
                    current_chars = segment.get('characters', [])
                    for char in characters_all:  # 保持 characters_all 的顺序
                        if char in missing and char not in current_chars:
                            current_chars.append(char)
                    segment['characters'] = current_chars
                    fixed_count += 1

    # 输出报告
    if issues:
        print(f"\n[A7 检查] 发现 {len(issues)} 个 segment 的 characters 字段不完整：\n")
        for issue in issues:
            print(f"  {issue['segment_id']}:")
            print(f"    当前 characters: {issue['characters_field']}")
            print(f"    提示词中提到: {issue['mentioned_in_prompt']}")
            print(f"    缺失: {issue['missing']}")
            print()

        if auto_fix:
            # 保存修复后的文件
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"[自动修复] 已补全 {fixed_count} 个 segment 的 characters 字段")
            print(f"[自动修复] 文件已保存：{json_path}\n")
        else:
            print("[提示] 使用 --fix 参数可自动修复这些问题\n")

        return False
    else:
        print("[A7 检查] 所有 segment 的 characters 字段完整\n")
        return True


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='A7 检查：characters 字段完整性')
    parser.add_argument('json_file', help='JSON 文件路径')
    parser.add_argument('--fix', action='store_true', help='自动修复问题')

    args = parser.parse_args()

    if not Path(args.json_file).exists():
        print(f"错误：文件不存在 {args.json_file}")
        sys.exit(1)

    success = check_a7_characters(args.json_file, auto_fix=args.fix)
    sys.exit(0 if success else 1)
