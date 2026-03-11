#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
C-Level Video Generator
C 级（时间切片）视频生成器
支持从完整镜头中提取单个时间切片并生成 3-5 秒视频
"""

import sys
import os
import json
import re
from pathlib import Path
from typing import Optional, Dict, List, Tuple

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# 添加脚本目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from video_generator import generate_video_with_anime_workbench


def parse_storyboard_file(storyboard_path: str, segment_id: str) -> Optional[Dict]:
    """
    从分镜脚本文件中解析指定镜头的信息

    Args:
        storyboard_path: 分镜脚本文件路径
        segment_id: 镜头ID (如 "SC01-L02")

    Returns:
        Dict: 包含镜头信息的字典，包括所有时间切片
    """
    try:
        with open(storyboard_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 查找对应的镜头段落
        # 格式: **SC01-L02** ｜ 【中景 · 9:16】 ｜ 5s
        pattern = rf'\*\*{segment_id}\*\*[^\n]*\n(.*?)(?=\n\*\*SC\d+-L\d+\*\*|\Z)'
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)

        if not match:
            print(f"[WARN] 未找到镜头 {segment_id} 的分镜信息")
            return None

        segment_content = match.group(1)

        # 提取基本信息
        shot_info = {
            "segment_id": segment_id,
            "time_slices": [],
            "scene_description": "",
            "audio": "",
            "dialogue": ""
        }

        # 提取时间切片 (C01, C02, C03...)
        # 格式: C01 (00-1.5s): Slow Dolly In，演武场正午硬光...
        slice_pattern = r'(C\d+)\s*\(([^)]+)\)[:\s]*([^\n]+)'
        slices = re.findall(slice_pattern, segment_content)

        for slice_id, time_range, description in slices:
            shot_info["time_slices"].append({
                "id": slice_id,
                "time_range": time_range,
                "description": description.strip()
            })

        # 提取场景描述
        scene_match = re.search(r'🎬\s*画面[：:]\s*\n(.*?)(?=🔊|💬|📋|\Z)', segment_content, re.DOTALL)
        if scene_match:
            shot_info["scene_description"] = scene_match.group(1).strip()

        # 提取音效
        audio_match = re.search(r'🔊\s*音效[：:]\s*([^\n]+)', segment_content)
        if audio_match:
            shot_info["audio"] = audio_match.group(1).strip()

        # 提取对白
        dialogue_match = re.search(r'💬\s*对白[：:]\s*([^\n]+)', segment_content)
        if dialogue_match:
            shot_info["dialogue"] = dialogue_match.group(1).strip()

        return shot_info

    except Exception as e:
        print(f"[ERROR] 解析分镜文件失败: {e}")
        return None


def extract_c_slice_info(shot_info: Dict, c_id: str) -> Optional[Dict]:
    """
    从镜头信息中提取指定的时间切片

    Args:
        shot_info: 镜头信息字典
        c_id: 时间切片ID (如 "C02")

    Returns:
        Dict: 时间切片信息
    """
    c_id_upper = c_id.upper()

    for slice_info in shot_info["time_slices"]:
        if slice_info["id"].upper() == c_id_upper:
            return slice_info

    print(f"[WARN] 未找到时间切片 {c_id}")
    return None


def build_c_level_prompt(
    shot_info: Dict,
    c_slice: Dict,
    context_slices: List[Dict] = None
) -> str:
    """
    构建 C 级视频生成提示词
    将单个时间切片的描述扩展为完整的 3-5 秒视频提示词

    Args:
        shot_info: 完整镜头信息
        c_slice: 目标时间切片信息
        context_slices: 前后时间切片（用于补充上下文）

    Returns:
        str: 完整的视频生成提示词
    """
    prompt_parts = []

    # 1. 核心描述（来自 C 切片）
    core_description = c_slice["description"]
    prompt_parts.append(core_description)

    # 2. 补充上下文信息（如果有前后切片）
    if context_slices:
        context_info = []
        for ctx in context_slices:
            if ctx["id"] != c_slice["id"]:
                context_info.append(f"[上下文] {ctx['description']}")
        if context_info:
            prompt_parts.append("\n".join(context_info))

    # 3. 添加音效信息（如果有）
    if shot_info.get("audio"):
        prompt_parts.append(f"音效: {shot_info['audio']}")

    # 4. 添加对白信息（如果有）
    if shot_info.get("dialogue") and shot_info["dialogue"] != "（无台词，动作主导）":
        prompt_parts.append(f"对白: {shot_info['dialogue']}")

    # 组合成完整提示词
    full_prompt = "\n".join(prompt_parts)

    return full_prompt


def get_c_level_filename(
    base_dir: str,
    segment_id: str,
    l_version: str,
    c_id: str,
    episode: str = "01"
) -> str:
    """
    生成 C 级视频的标准文件名

    命名格式: ep##-sc##-l##-[L版本号]-c##.mp4
    例如: ep01-sc01-l02-02-c01.mp4

    Args:
        base_dir: 视频保存目录
        segment_id: 镜头ID (如 "SC01-L02")
        l_version: L 级视频的版本号 (如 "02")
        c_id: 时间切片ID (如 "C01")
        episode: 集数 (如 "01")

    Returns:
        str: 完整的文件路径
    """
    # 解析 segment_id (格式: SC##-L##)
    match = re.match(r'SC(\d+)-L(\d+)', segment_id, re.IGNORECASE)
    if not match:
        raise ValueError(f"Invalid segment_id format: {segment_id}")

    sc_num = match.group(1).zfill(2)
    l_num = match.group(2).zfill(2)

    # 解析 c_id (格式: C##)
    c_match = re.match(r'C(\d+)', c_id, re.IGNORECASE)
    if not c_match:
        raise ValueError(f"Invalid c_id format: {c_id}")

    c_num = c_match.group(1).zfill(2)

    # 构建基础文件名模式
    base_pattern = f"ep{episode}-sc{sc_num}-l{l_num}-{l_version}-c{c_num}"

    # 查找已存在的版本号
    base_path = Path(base_dir)
    base_path.mkdir(parents=True, exist_ok=True)

    existing_versions = []
    for file in base_path.glob(f"{base_pattern}*.mp4"):
        # 检查是否有版本号后缀
        if file.stem == base_pattern:
            # 没有版本号后缀，这是第一个版本
            existing_versions.append(1)
        else:
            # 提取版本号
            version_match = re.search(r'-(\d+)$', file.stem)
            if version_match:
                existing_versions.append(int(version_match.group(1)))

    # 确定文件名
    if not existing_versions:
        # 第一次生成，不带版本号
        filename = f"{base_pattern}.mp4"
    else:
        # 需要版本号
        next_version = max(existing_versions) + 1
        filename = f"{base_pattern}-{str(next_version).zfill(2)}.mp4"

    return str(base_path / filename)


def generate_c_level_video(
    storyboard_path: str,
    segment_id: str,
    c_id: str,
    l_version: str,
    output_dir: str,
    episode: str = "01",
    duration: float = 5.0,
    model_code: str = "kling-v2",
    max_retries: int = 3
) -> Dict:
    """
    生成 C 级（时间切片）视频

    Args:
        storyboard_path: 分镜脚本文件路径
        segment_id: 镜头ID (如 "SC01-L02")
        c_id: 时间切片ID (如 "C02")
        l_version: 基于的 L 版本号 (如 "02")
        output_dir: 输出目录
        episode: 集数
        duration: 视频时长（秒，默认5秒）
        model_code: 模型编码
        max_retries: 最大重试次数

    Returns:
        Dict: 生成结果
    """
    print("=" * 60)
    print("[C-LEVEL] C 级视频生成")
    print("=" * 60)
    print(f"镜头: {segment_id}")
    print(f"切片: {c_id}")
    print(f"基于版本: ep{episode}-sc{segment_id.split('-')[0][2:]}-l{segment_id.split('-')[1][1:]}-{l_version}")
    print(f"时长: {duration}秒")
    print("=" * 60 + "\n")

    # 1. 解析分镜脚本
    print("[STEP 1/4] 解析分镜脚本")
    print("-" * 60)
    shot_info = parse_storyboard_file(storyboard_path, segment_id)
    if not shot_info:
        return {
            "success": False,
            "message": f"未找到镜头 {segment_id} 的分镜信息",
            "video_path": None
        }

    print(f"[OK] 找到镜头信息，共 {len(shot_info['time_slices'])} 个时间切片")

    # 2. 提取目标切片
    print(f"\n[STEP 2/4] 提取时间切片 {c_id}")
    print("-" * 60)
    c_slice = extract_c_slice_info(shot_info, c_id)
    if not c_slice:
        return {
            "success": False,
            "message": f"未找到时间切片 {c_id}",
            "video_path": None
        }

    print(f"[OK] 切片信息:")
    print(f"  ID: {c_slice['id']}")
    print(f"  时间范围: {c_slice['time_range']}")
    print(f"  描述: {c_slice['description'][:50]}...")

    # 3. 构建提示词
    print(f"\n[STEP 3/4] 构建视频生成提示词")
    print("-" * 60)

    # 获取前后切片作为上下文
    c_index = next((i for i, s in enumerate(shot_info['time_slices']) if s['id'] == c_slice['id']), -1)
    context_slices = []
    if c_index > 0:
        context_slices.append(shot_info['time_slices'][c_index - 1])
    if c_index < len(shot_info['time_slices']) - 1:
        context_slices.append(shot_info['time_slices'][c_index + 1])

    prompt = build_c_level_prompt(shot_info, c_slice, context_slices)
    print(f"[OK] 提示词已生成 ({len(prompt)} 字符)")
    print(f"\n提示词内容:")
    print("-" * 60)
    print(prompt)
    print("-" * 60)

    # 4. 生成视频（支持重试）
    print(f"\n[STEP 4/4] 生成视频（最多重试 {max_retries} 次）")
    print("-" * 60)

    for attempt in range(1, max_retries + 1):
        print(f"\n[尝试 {attempt}/{max_retries}]")

        # 生成文件名
        video_path = get_c_level_filename(
            base_dir=output_dir,
            segment_id=segment_id,
            l_version=l_version,
            c_id=c_id,
            episode=episode
        )

        print(f"[INFO] 目标文件: {Path(video_path).name}")

        # 调用视频生成
        result = generate_video_with_anime_workbench(
            prompt=prompt,
            segment_id=f"{segment_id}-{c_id}",
            duration=duration,
            output_dir=output_dir,
            model_code=model_code
        )

        if result.get("success") and result.get("video_path"):
            # 重命名为标准格式
            generated_path = result["video_path"]
            if generated_path != video_path:
                try:
                    Path(generated_path).rename(video_path)
                    print(f"[OK] 已重命名为标准格式: {Path(video_path).name}")
                except Exception as e:
                    print(f"[WARN] 重命名失败: {e}")
                    video_path = generated_path

            print(f"\n[SUCCESS] C 级视频生成成功!")
            print(f"[FILE] {video_path}")

            return {
                "success": True,
                "message": "C 级视频生成成功",
                "video_path": video_path,
                "segment_id": segment_id,
                "c_id": c_id,
                "l_version": l_version,
                "attempt": attempt
            }
        else:
            print(f"[FAIL] 生成失败: {result.get('message', '未知错误')}")
            if attempt < max_retries:
                print(f"[RETRY] 准备重试...")

    # 所有尝试都失败
    return {
        "success": False,
        "message": f"C 级视频生成失败（已重试 {max_retries} 次）",
        "video_path": None
    }


def main():
    """命令行入口"""
    import argparse

    parser = argparse.ArgumentParser(
        description="C 级（时间切片）视频生成器"
    )
    parser.add_argument(
        "storyboard",
        help="分镜脚本文件路径"
    )
    parser.add_argument(
        "segment_id",
        help="镜头ID (如 SC01-L02)"
    )
    parser.add_argument(
        "c_id",
        help="时间切片ID (如 C02)"
    )
    parser.add_argument(
        "l_version",
        help="基于的 L 版本号 (如 02)"
    )
    parser.add_argument(
        "-o", "--output-dir",
        default="workspace/output",
        help="输出目录（默认: workspace/output）"
    )
    parser.add_argument(
        "-e", "--episode",
        default="01",
        help="集数（默认: 01）"
    )
    parser.add_argument(
        "-d", "--duration",
        type=float,
        default=5.0,
        help="视频时长（秒，默认: 5.0）"
    )
    parser.add_argument(
        "-m", "--model",
        default="kling-v2",
        help="模型编码（默认: kling-v2）"
    )
    parser.add_argument(
        "-r", "--max-retries",
        type=int,
        default=3,
        help="最大重试次数（默认: 3）"
    )

    args = parser.parse_args()

    try:
        result = generate_c_level_video(
            storyboard_path=args.storyboard,
            segment_id=args.segment_id,
            c_id=args.c_id,
            l_version=args.l_version,
            output_dir=args.output_dir,
            episode=args.episode,
            duration=args.duration,
            model_code=args.model,
            max_retries=args.max_retries
        )

        print("\n" + "=" * 60)
        if result["success"]:
            print("[DONE] C 级视频生成完成!")
            print(f"[FILE] {result['video_path']}")
        else:
            print("[FAIL] C 级视频生成失败")
            print(f"[ERROR] {result['message']}")
        print("=" * 60)

        return 0 if result["success"] else 1

    except Exception as e:
        print(f"\n[ERROR] 程序执行失败: {e}")
        import traceback
        traceback.print_exc()
        return 2


if __name__ == "__main__":
    exit(main())
