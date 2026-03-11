#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JSON文件清理脚本
删除所有临时、备份和中间文件，只保留最终的 ep{集数}_shots.json 文件
"""

import os
import sys
from pathlib import Path
import re


def clean_json_files(directory):
    """清理指定目录中的临时JSON文件"""

    directory = Path(directory)
    if not directory.exists():
        print(f"错误: 目录不存在: {directory}")
        return 1

    # 定义要删除的文件模式（临时文件、备份文件等）
    patterns_to_delete = [
        r'ep\d+_shots_backup\.json',
        r'ep\d+_shots_bak\.json',
        r'ep\d+_shots_temp\.json',
        r'ep\d+_shots_test\.json',
        r'ep\d+_shots_draft\.json',
        r'ep\d+_shots_progress\.json',
        r'ep\d+_shots_structure\.json',
        r'ep\d+_shots_corrected\.json',
        r'ep\d+_shots_fixed\.json',
        r'ep\d+_shots_merged\.json',
        r'ep\d+_shots_combined\.json',
        r'ep\d+_shots_final\.json',
        r'ep\d+_shots_v\d+\.json',
    ]

    # 编译正则表达式
    compiled_patterns = [re.compile(pattern) for pattern in patterns_to_delete]

    # 查找要删除的文件
    files_to_delete = []
    for file in directory.glob("ep*_shots*.json"):
        filename = file.name

        # 检查是否匹配任何要删除的模式
        for pattern in compiled_patterns:
            if pattern.match(filename):
                files_to_delete.append(file)
                break

    if not files_to_delete:
        print(f"[OK] 没有找到需要清理的临时文件")
        return 0

    # 显示要删除的文件
    print(f"\n=== 发现 {len(files_to_delete)} 个临时文件 ===\n")
    for file in files_to_delete:
        size = file.stat().st_size / 1024  # KB
        print(f"  - {file.name} ({size:.1f} KB)")

    # 确认删除
    print(f"\n是否删除这些文件? (y/n): ", end="")
    response = input().strip().lower()

    if response != 'y':
        print("[取消] 未删除任何文件")
        return 0

    # 删除文件
    deleted_count = 0
    for file in files_to_delete:
        try:
            file.unlink()
            print(f"[删除] {file.name}")
            deleted_count += 1
        except Exception as e:
            print(f"[错误] 无法删除 {file.name}: {e}")

    print(f"\n[完成] 成功删除 {deleted_count} 个文件")

    # 显示保留的最终文件
    final_files = list(directory.glob("ep*_shots.json"))
    if final_files:
        print(f"\n=== 保留的最终文件 ===\n")
        for file in sorted(final_files):
            size = file.stat().st_size / 1024  # KB
            print(f"  ✓ {file.name} ({size:.1f} KB)")

    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python clean_json_files.py <目录路径>")
        print("示例: python clean_json_files.py D:\\jiaoben-claude\\03-video\\juben")
        sys.exit(1)

    directory = sys.argv[1]
    sys.exit(clean_json_files(directory))
