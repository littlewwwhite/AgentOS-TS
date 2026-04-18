#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
去除剧本中的服饰颜色描述（批量优化版）
使用批量处理方式提升处理速度
"""

import json
import os
import sys
import argparse
from google import genai
from google.genai import types

# 加载配置
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config_loader import get_gemini_config

_gemini_cfg = get_gemini_config()
GEMINI_BASE_URL = _gemini_cfg.get("base_url", "https://aihubmix.com/gemini")
GEMINI_API_KEY = _gemini_cfg.get("api_key", "")
GEMINI_COLOR_REMOVAL_MODEL = _gemini_cfg.get("color_removal_model", "gemini-3.1-pro-preview")


def _resolve_project_root(explicit=None):
    """Resolve project root directory.

    Priority: explicit arg > PROJECT_DIR env var > CWD
    """
    if explicit:
        return explicit
    env_dir = os.environ.get('PROJECT_DIR')
    if env_dir and os.path.isdir(env_dir):
        return env_dir
    return os.getcwd()

PROJECT_ROOT = _resolve_project_root()


def remove_costume_colors_batch(script_path, output_path=None, batch_size=10):
    """使用 Gemini 模型批量去除剧本中的服饰颜色描述

    参数:
        script_path: 输入剧本JSON文件路径
        output_path: 输出剧本JSON文件路径（可选）
        batch_size: 每批处理的 content 数量

    返回:
        输出文件路径
    """
    print("正在使用 Gemini 模型去除服饰颜色描述（批量处理模式）...")

    # 读取原始剧本
    with open(script_path, 'r', encoding='utf-8') as f:
        script_data = json.load(f)

    # 配置 Gemini API
    http_options = types.HttpOptions(base_url=GEMINI_BASE_URL) if GEMINI_BASE_URL else None
    client = genai.Client(api_key=GEMINI_API_KEY, http_options=http_options)
    model_name = GEMINI_COLOR_REMOVAL_MODEL

    # 步骤1: 收集所有 content 字段及其引用
    print("步骤1: 收集所有 content 字段...")
    content_refs = []  # 存储 (action对象, 原始content, 索引) 的列表

    for episode in script_data.get('episodes', []):
        for scene in episode.get('scenes', []):
            for action in scene.get('actions', []):
                original_content = action.get('content', '')
                if original_content:
                    idx = len(content_refs)
                    content_refs.append((action, original_content, idx))

    total_count = len(content_refs)
    print(f"  找到 {total_count} 个 content 字段")
    print(f"  批量大小: {batch_size} 个/批")
    print(f"  预计批次: {(total_count + batch_size - 1) // batch_size} 批")

    # 步骤2: 批量处理所有 content 字段
    print("\n步骤2: 批量处理 content 字段...")
    modified_count = 0
    processed_count = 0

    # 分批处理
    for batch_start in range(0, total_count, batch_size):
        batch_end = min(batch_start + batch_size, total_count)
        batch = content_refs[batch_start:batch_end]

        # 构建批量提示词
        batch_prompt = "请去除以下文本中关于服饰颜色的描述，保持其他内容不变。\n\n"
        batch_prompt += "处理规则：\n"
        batch_prompt += "1. 去除所有服饰颜色相关的描述（如：白衣、红衣、黑衣等）\n"
        batch_prompt += "2. 保持其他内容完全不变\n"
        batch_prompt += "3. 按照输入的顺序，用 [TEXT_N] 标记每段文本的输出\n\n"

        for i, (_, content, idx) in enumerate(batch):
            batch_prompt += f"[TEXT_{i}]\n{content}\n\n"

        batch_prompt += "请按照 [TEXT_0], [TEXT_1], [TEXT_2]... 的格式输出处理后的文本，每段文本前加上对应的标记。"

        try:
            response = client.models.generate_content(model=model_name, contents=[batch_prompt])
            result_text = response.text.strip()

            # 解析批量结果
            results = []
            current_text = []
            current_idx = None

            for line in result_text.split('\n'):
                # 检查是否是标记行
                if line.startswith('[TEXT_'):
                    # 保存上一段文本
                    if current_idx is not None and current_text:
                        results.append('\n'.join(current_text).strip())
                        current_text = []

                    # 提取索引
                    try:
                        current_idx = int(line.split('_')[1].split(']')[0])
                    except:
                        current_idx = len(results)
                else:
                    if current_idx is not None:
                        current_text.append(line)

            # 保存最后一段
            if current_idx is not None and current_text:
                results.append('\n'.join(current_text).strip())

            # 更新 content
            for i, (action, original_content, _) in enumerate(batch):
                if i < len(results):
                    new_content = results[i]
                    if new_content and new_content != original_content:
                        action['content'] = new_content
                        modified_count += 1
                        print(f"  已修改 ({modified_count}/{processed_count + i + 1}): {original_content[:50]}...")

            processed_count += len(batch)
            print(f"  批次进度: {processed_count}/{total_count} ({processed_count*100//total_count}%)")

        except Exception as e:
            print(f"  警告: 批次处理失败 ({batch_start}-{batch_end}) - {str(e)}")
            print(f"  回退到逐个处理...")

            # 回退到逐个处理
            for action, original_content, idx in batch:
                try:
                    single_prompt = f"""请去除以下文本中关于服饰颜色的描述，保持其他内容不变。只返回修改后的文本，不要添加任何解释或说明。

原文本：
{original_content}

修改后的文本："""

                    response = client.models.generate_content(model=model_name, contents=[single_prompt])
                    new_content = response.text.strip()

                    if new_content != original_content:
                        action['content'] = new_content
                        modified_count += 1
                        print(f"  已修改 ({modified_count}/{processed_count + 1}): {original_content[:50]}...")

                    processed_count += 1
                except Exception as e2:
                    print(f"  警告: 单个处理失败 ({idx}) - {str(e2)}")
                    processed_count += 1
                    continue

    # 步骤3: 保存处理后的剧本
    print("\n步骤3: 保存处理后的剧本...")

    # 确定输出路径
    if not output_path:
        script_dir = os.path.dirname(script_path)
        output_path = os.path.join(script_dir, 'script_no_colors.json')

    # 保存处理后的剧本
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(script_data, f, ensure_ascii=False, indent=2)

    print(f"\n服饰颜色去除完成！")
    print(f"  - 总共处理: {total_count} 个 content 字段")
    print(f"  - 修改数量: {modified_count} 处")
    print(f"  - 输出文件: {output_path}")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description='去除剧本中的服饰颜色描述（批量优化版）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 处理默认剧本文件
  python remove_costume_colors_batch.py

  # 指定批量大小（默认10）
  python remove_costume_colors_batch.py --batch-size 20

  # 指定输入输出文件
  python remove_costume_colors_batch.py --input path/to/script.json --output path/to/output.json

配置:
  Gemini API 密钥和 base_url 从 assets/config.json 的 gemini 段读取
        """
    )

    parser.add_argument(
        '--input', '-i',
        help='输入剧本JSON文件路径（默认: output/script.json）'
    )
    parser.add_argument(
        '--output', '-o',
        help='输出剧本JSON文件路径（默认: output/script_no_colors.json）'
    )
    parser.add_argument(
        '--batch-size', '-b',
        type=int,
        default=10,
        help='每批处理的 content 数量（默认: 10）'
    )
    parser.add_argument(
        '--project-dir',
        default=None,
        help='Project root directory (falls back to PROJECT_DIR env var, then CWD)'
    )

    args = parser.parse_args()

    # Re-initialize PROJECT_ROOT if --project-dir is provided
    global PROJECT_ROOT
    if args.project_dir:
        PROJECT_ROOT = _resolve_project_root(args.project_dir)

    # 确定输入文件路径
    if args.input:
        script_path = args.input
    else:
        # 使用相对路径
        script_path = os.path.join(PROJECT_ROOT, 'output', 'script.json')

    # 检查输入文件是否存在
    if not os.path.exists(script_path):
        print(f"错误: 输入文件不存在: {script_path}")
        sys.exit(1)

    try:
        output_path = remove_costume_colors_batch(script_path, args.output, args.batch_size)
        print(f"\n[成功] 文件已保存到: {output_path}")
        return 0
    except Exception as e:
        print(f"\n[错误] {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
