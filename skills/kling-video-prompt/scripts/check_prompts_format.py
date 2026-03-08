#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prompts 格式检查脚本
用于验证生成的 JSON 文件中 prompts 字段格式是否正确
"""

import json
import sys
from pathlib import Path


def check_prompts_format(json_file):
    """检查 JSON 文件中的 prompts 格式"""

    with open(json_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    errors = []
    warnings = []

    # 遍历所有 scenes 和 segments
    for scene in data.get('scenes', []):
        scene_id = scene.get('scene_id', 'Unknown')

        for segment in scene.get('segments', []):
            segment_id = segment.get('segment_id', 'Unknown')

            # 检查 C0: prompts 字段格式
            prompts_field = f"{segment_id}_prompts"
            prompts_cn_field = f"{segment_id}_prompts_cn"

            # 检查是否存在错误的 prompts 字段名
            if 'prompts' in segment:
                prompts_value = segment['prompts']
                if isinstance(prompts_value, dict):
                    errors.append(f"❌ {segment_id}: prompts 字段是对象类型,应该是字符串")
                else:
                    errors.append(f"❌ {segment_id}: 使用了错误的字段名 'prompts',应该是 '{prompts_field}'")

            # 检查 C9: prompts 字段命名
            if prompts_field not in segment:
                errors.append(f"❌ {segment_id}: 缺少 '{prompts_field}' 字段")
            else:
                # 检查 C0: 字段类型
                if not isinstance(segment[prompts_field], str):
                    errors.append(f"❌ {segment_id}: '{prompts_field}' 必须是字符串类型,当前是 {type(segment[prompts_field]).__name__}")
                else:
                    # 检查 C1: 人物一致性前缀
                    if not segment[prompts_field].startswith("Maintain characters exactly as reference images"):
                        warnings.append(f"⚠️ {segment_id}: '{prompts_field}' 缺少人物一致性前缀")

                    # 检查 C2: 英文时间格式
                    if '–' in segment[prompts_field]:  # en dash
                        warnings.append(f"⚠️ {segment_id}: '{prompts_field}' 使用了 en dash (–),应该使用连字符 (-)")

            # 检查 C10: 中文 prompts 存在性
            if prompts_cn_field not in segment:
                errors.append(f"❌ {segment_id}: 缺少 '{prompts_cn_field}' 字段")
            else:
                # 检查 C0: 字段类型
                if not isinstance(segment[prompts_cn_field], str):
                    errors.append(f"❌ {segment_id}: '{prompts_cn_field}' 必须是字符串类型,当前是 {type(segment[prompts_cn_field]).__name__}")
                else:
                    # 检查 C1: 人物一致性前缀
                    if not segment[prompts_cn_field].startswith("保持人物与参考图完全一致"):
                        warnings.append(f"⚠️ {segment_id}: '{prompts_cn_field}' 缺少人物一致性前缀")

                    # 检查 C3: 中文时间格式
                    if '-' in segment[prompts_cn_field] and 's' in segment[prompts_cn_field]:
                        # 简单检查是否有类似 "0-3s" 的模式
                        import re
                        if re.search(r'\d+-\d+s', segment[prompts_cn_field]):
                            warnings.append(f"⚠️ {segment_id}: '{prompts_cn_field}' 使用了连字符 (-),应该使用 en dash (–)")

                    # 检查 C4: 禁止场景转换标记
                    if '【场景建立】' in segment[prompts_cn_field] or '【场景转换' in segment[prompts_cn_field]:
                        warnings.append(f"⚠️ {segment_id}: '{prompts_cn_field}' 包含场景转换标记,应该删除")

    # 输出报告
    print(f"\n=== Prompts 格式检查报告 ===")
    print(f"文件: {json_file}")
    print(f"\n检查项目:")
    print(f"  C0: prompts 字段格式 (必须是字符串)")
    print(f"  C1: 人物一致性前缀")
    print(f"  C2: 英文时间格式 (使用连字符 -)")
    print(f"  C3: 中文时间格式 (使用 en dash –)")
    print(f"  C4: 禁止场景转换标记")
    print(f"  C9: prompts 字段命名")
    print(f"  C10: prompts 字段存在性")

    if errors:
        print(f"\n[ERROR] 发现 {len(errors)} 个错误:")
        for error in errors:
            print(f"  {error}")

    if warnings:
        print(f"\n[WARNING] 发现 {len(warnings)} 个警告:")
        for warning in warnings:
            print(f"  {warning}")

    if not errors and not warnings:
        print(f"\n[OK] 所有检查通过!")
        return 0
    elif errors:
        print(f"\n[ERROR] 检查未通过,请修复上述错误")
        return 1
    else:
        print(f"\n[WARNING] 检查通过,但有警告项")
        return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python check_prompts_format.py <json_file>")
        sys.exit(1)

    json_file = sys.argv[1]
    if not Path(json_file).exists():
        print(f"错误: 文件不存在: {json_file}")
        sys.exit(1)

    sys.exit(check_prompts_format(json_file))
