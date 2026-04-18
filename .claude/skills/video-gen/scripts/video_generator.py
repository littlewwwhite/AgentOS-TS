#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video Generator
自动调用内置视频生成 API 重新生成视频（无需外部 skill 依赖）
"""

import sys
import os
import json
import re
from typing import Optional, Dict
from pathlib import Path

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# 导入内置 API 模块
sys.path.insert(0, os.path.dirname(__file__))
import video_api


def get_next_version_filename(base_dir: str, segment_id: str, episode: str = "001", shot_id: str = None, clip_version: str = None) -> str:
    """
    根据segment_id生成标准命名格式的文件名，并自动递增版本号

    CLIP 级命名格式: ep###-scn###-clip###-###.mp4
    例如: ep001-scn001-clip002-001.mp4, ep001-scn001-clip002-002.mp4

    SHOT 级命名格式: ep###-scn###-clip###-[CLIP版本号]-shot###.mp4 或 ep###-scn###-clip###-[CLIP版本号]-shot###-###.mp4
    例如: ep001-scn001-clip002-002-shot001.mp4, ep001-scn001-clip002-002-shot001-002.mp4

    Args:
        base_dir: 视频保存目录
        segment_id: 片段ID，如 "SCN001-CLIP002"
        episode: 集数，如 "001"
        shot_id: 时间切片ID，如 "SHOT001"（可选，用于 SHOT 级视频）
        clip_version: CLIP 级视频版本号，如 "002"（可选，用于 SHOT 级视频）

    Returns:
        完整的文件路径
    """
    # 解析segment_id (格式: SCN###-CLIP###)
    match = re.match(r'SCN(\d+)-CLIP(\d+)', segment_id, re.IGNORECASE)
    if not match:
        raise ValueError(f"Invalid segment_id format: {segment_id}")

    scn_num = match.group(1).zfill(3)
    clip_num = match.group(2).zfill(3)

    # 构建基础文件名模式
    if shot_id and clip_version:
        # SHOT 级视频命名
        shot_match = re.match(r'SHOT(\d+)', shot_id, re.IGNORECASE)
        if not shot_match:
            raise ValueError(f"Invalid shot_id format: {shot_id}")
        shot_num = shot_match.group(1).zfill(3)
        base_pattern = f"ep{episode}-scn{scn_num}-clip{clip_num}-{clip_version}-shot{shot_num}"
    else:
        # CLIP 级视频命名
        base_pattern = f"ep{episode}-scn{scn_num}-clip{clip_num}"

    # 查找已存在的版本号
    base_path = Path(base_dir)
    base_path.mkdir(parents=True, exist_ok=True)

    existing_versions = []

    if shot_id and clip_version:
        # SHOT 级视频：查找 base_pattern.mp4 和 base_pattern-###.mp4
        for file in base_path.glob(f"{base_pattern}*.mp4"):
            if file.stem == base_pattern:
                # 没有版本号后缀，这是第一个版本
                existing_versions.append(1)
            else:
                # 提取版本号
                version_match = re.search(r'-(\d+)$', file.stem)
                if version_match:
                    existing_versions.append(int(version_match.group(1)))
    else:
        # CLIP 级视频：查找 base_pattern-###.mp4
        for file in base_path.glob(f"{base_pattern}-*.mp4"):
            # 提取版本号
            version_match = re.search(r'-(\d+)\.mp4$', file.name)
            if version_match:
                existing_versions.append(int(version_match.group(1)))

    # 确定文件名
    if shot_id and clip_version:
        # SHOT 级视频
        if not existing_versions:
            # 第一次生成，不带版本号
            filename = f"{base_pattern}.mp4"
        else:
            # 需要版本号
            next_version = max(existing_versions) + 1
            filename = f"{base_pattern}-{str(next_version).zfill(3)}.mp4"
    else:
        # CLIP 级视频
        next_version = max(existing_versions, default=0) + 1
        filename = f"{base_pattern}-{str(next_version).zfill(3)}.mp4"

    return str(base_path / filename)


def generate_video_with_anime_workbench(
    prompt: str,
    segment_id: str,
    duration: float,
    output_dir: str,
    model_code: str = video_api.DEFAULT_MODEL_CODE,
    handle_code: str = "",
    subjects: list = None,
    quality: str = "720",
    ratio: str = "16:9",
    timeout: int = 1830,
    poll_interval: int = 10
) -> Dict:
    """
    使用内置 AnimeWorkbench API 生成视频

    Args:
        prompt: 优化后的提示词。
                主体参考模式下可用 {主体名} 占位，如 "{萧禾} 站在演武场中央"。
                如果没有 {} 占位符，所有主体会自动插入到提示词开头。
        segment_id: 片段ID
        duration: 期望时长（秒）
        output_dir: 输出目录
        model_code: 模型编码（默认 KeLing3_Omni_VideoCreate_tencent，即可灵3.0 Omni）
        handle_code: 处理器编码
        subjects: 主体参考列表（可选）。
                  每项: {"element_id": "ext_xxx", "name": "萧禾", "desc": "可爱少女"}
                  传入则启用可灵3.0 Omni 主体参考生视频模式。
        quality: 视频质量（默认 "720"）
        timeout: 超时时间（秒）
        poll_interval: 轮询间隔（秒）

    Returns:
        生成结果字典
    """
    print(f"\n[GEN] 开始生成视频: {segment_id}")
    print(f"[INFO] 提示词长度: {len(prompt)} 字符")
    print(f"[INFO] 期望时长: {duration}秒")
    print(f"[INFO] 模型: {model_code}")
    if subjects:
        print(f"[INFO] 主体参考: {', '.join(s.get('name', s['element_id']) for s in subjects)}")

    # 生成标准命名的文件路径
    video_path = get_next_version_filename(output_dir, segment_id)

    # 调用内置 API 一站式生成
    result = video_api.create_video(
        prompt=prompt,
        model_code=model_code,
        handle_code=handle_code,
        subjects=subjects,
        duration=str(int(duration)),
        quality=quality,
        ratio=ratio,
        output_path=video_path,
        timeout=timeout,
        poll_interval=poll_interval,
    )

    if result["success"]:
        return {
            "success": True,
            "message": result["message"],
            "video_path": result["video_path"] or video_path,
            "video_url": result.get("video_url"),
            "task_id": result["task_id"],
        }
    else:
        return {
            "success": False,
            "message": result["message"],
            "video_path": None,
            "task_id": result.get("task_id"),
        }


def generate_video(
    prompt: str,
    segment_id: str,
    duration: float,
    output_dir: str,
    api_key: Optional[str] = None,
    **kwargs
) -> Dict:
    """
    生成视频（统一接口）

    Args:
        prompt: 优化后的提示词
        segment_id: 片段ID
        duration: 期望时长（秒）
        output_dir: 输出目录
        api_key: API密钥（保留参数，兼容性）
        **kwargs: 其他参数

    Returns:
        生成结果字典
    """
    # 使用内置 AnimeWorkbench API
    return generate_video_with_anime_workbench(
        prompt=prompt,
        segment_id=segment_id,
        duration=duration,
        output_dir=output_dir,
        **kwargs
    )


if __name__ == "__main__":
    # 测试
    prompt = "测试提示词：一个女孩在花园里奔跑"
    result = generate_video(
        prompt=prompt,
        segment_id="SCN001-CLIP001",
        duration=5.0,
        output_dir="output"
    )
    print(f"\n生成结果: {json.dumps(result, ensure_ascii=False, indent=2)}")
