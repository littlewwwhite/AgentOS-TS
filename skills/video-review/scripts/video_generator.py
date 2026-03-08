#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video Generator
自动调用视频生成API重新生成视频
"""

import sys
import os
import time
import json
import subprocess
import re
from typing import Optional, Dict
from pathlib import Path

# 配置UTF-8输出（Windows兼容）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')


def get_next_version_filename(base_dir: str, segment_id: str, episode: str = "01", c_id: str = None, l_version: str = None) -> str:
    """
    根据segment_id生成标准命名格式的文件名，并自动递增版本号

    L 级命名格式: ep##-sc##-l##-##.mp4
    例如: ep01-sc01-l02-01.mp4, ep01-sc01-l02-02.mp4

    C 级命名格式: ep##-sc##-l##-[L版本号]-c##.mp4 或 ep##-sc##-l##-[L版本号]-c##-##.mp4
    例如: ep01-sc01-l02-02-c01.mp4, ep01-sc01-l02-02-c01-02.mp4

    Args:
        base_dir: 视频保存目录
        segment_id: 片段ID，如 "SC01-L02"
        episode: 集数，如 "01"
        c_id: 时间切片ID，如 "C01"（可选，用于 C 级视频）
        l_version: L 级视频版本号，如 "02"（可选，用于 C 级视频）

    Returns:
        完整的文件路径
    """
    # 解析segment_id (格式: SC##-L##)
    match = re.match(r'SC(\d+)-L(\d+)', segment_id, re.IGNORECASE)
    if not match:
        raise ValueError(f"Invalid segment_id format: {segment_id}")

    sc_num = match.group(1).zfill(2)
    l_num = match.group(2).zfill(2)

    # 构建基础文件名模式
    if c_id and l_version:
        # C 级视频命名
        c_match = re.match(r'C(\d+)', c_id, re.IGNORECASE)
        if not c_match:
            raise ValueError(f"Invalid c_id format: {c_id}")
        c_num = c_match.group(1).zfill(2)
        base_pattern = f"ep{episode}-sc{sc_num}-l{l_num}-{l_version}-c{c_num}"
    else:
        # L 级视频命名
        base_pattern = f"ep{episode}-sc{sc_num}-l{l_num}"

    # 查找已存在的版本号
    base_path = Path(base_dir)
    base_path.mkdir(parents=True, exist_ok=True)

    existing_versions = []

    if c_id and l_version:
        # C 级视频：查找 base_pattern.mp4 和 base_pattern-##.mp4
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
        # L 级视频：查找 base_pattern-##.mp4
        for file in base_path.glob(f"{base_pattern}-*.mp4"):
            # 提取版本号
            version_match = re.search(r'-(\d+)\.mp4$', file.name)
            if version_match:
                existing_versions.append(int(version_match.group(1)))

    # 确定文件名
    if c_id and l_version:
        # C 级视频
        if not existing_versions:
            # 第一次生成，不带版本号
            filename = f"{base_pattern}.mp4"
        else:
            # 需要版本号
            next_version = max(existing_versions) + 1
            filename = f"{base_pattern}-{str(next_version).zfill(2)}.mp4"
    else:
        # L 级视频
        next_version = max(existing_versions, default=0) + 1
        filename = f"{base_pattern}-{str(next_version).zfill(2)}.mp4"

    return str(base_path / filename)


def generate_video_with_anime_workbench(
    prompt: str,
    segment_id: str,
    duration: float,
    output_dir: str,
    model_code: str = "kling-v1.6",
    handle_code: str = "",
    timeout: int = 600,
    poll_interval: int = 10
) -> Dict:
    """
    使用 anime-material-workbench API 生成视频

    Args:
        prompt: 优化后的提示词
        segment_id: 片段ID
        duration: 期望时长（秒）
        output_dir: 输出目录
        model_code: 模型编码（默认 kling-v1.6）
        handle_code: 处理器编码
        timeout: 超时时间（秒）
        poll_interval: 轮询间隔（秒）

    Returns:
        生成结果字典
    """
    print(f"\n[GEN] 开始生成视频: {segment_id}")
    print(f"[INFO] 提示词长度: {len(prompt)} 字符")
    print(f"[INFO] 期望时长: {duration}秒")
    print(f"[INFO] 模型: {model_code}")

    # video-create skill 脚本路径
    video_create_dir = Path("D:/Zhuchen/Projects/.claude/skills/video-create/scripts")
    submit_script = video_create_dir / "submit_video_create.py"
    poll_script = video_create_dir / "poll_video_create_task.py"

    if not submit_script.exists():
        return {
            "success": False,
            "message": f"video-create skill 未找到: {submit_script}",
            "video_path": None,
            "task_id": None
        }

    # 准备提示词参数
    prompt_params = {
        "duration": str(duration),
        "aspect_ratio": "9:16"  # 默认竖屏
    }

    try:
        # 1. 提交生成任务
        print(f"[SUBMIT] 提交视频生成任务...")

        submit_cmd = [
            "python",
            str(submit_script),
            "--model-code", model_code,
            "--prompt", prompt,
            "--prompt-params", json.dumps(prompt_params)
        ]

        if handle_code:
            submit_cmd.extend(["--handle-code", handle_code])

        result = subprocess.run(
            submit_cmd,
            capture_output=True,
            text=True,
            encoding='utf-8'
        )

        if result.returncode != 0:
            return {
                "success": False,
                "message": f"提交任务失败: {result.stderr}",
                "video_path": None,
                "task_id": None
            }

        # 解析任务ID
        output_lines = result.stdout.strip().split('\n')
        task_id = None
        for line in output_lines:
            if line.startswith("taskId:"):
                task_id = line.split(":", 1)[1].strip()
                break

        if not task_id:
            return {
                "success": False,
                "message": "未获取到任务ID",
                "video_path": None,
                "task_id": None
            }

        print(f"[OK] 任务已提交: {task_id}")

        # 2. 轮询任务状态
        print(f"[POLL] 等待视频生成完成...")

        poll_cmd = [
            "python",
            str(poll_script),
            "--task-id", task_id,
            "--interval", str(poll_interval),
            "--timeout", str(timeout)
        ]

        poll_result = subprocess.run(
            poll_cmd,
            capture_output=True,
            text=True,
            encoding='utf-8'
        )

        if poll_result.returncode != 0:
            return {
                "success": False,
                "message": f"任务执行失败或超时",
                "video_path": None,
                "task_id": task_id
            }

        # 3. 解析结果并下载视频
        print(f"[OK] 视频生成完成!")
        print(f"[NOTE] 任务ID: {task_id}")

        # 从轮询结果中提取视频URL
        video_url = None
        for line in poll_result.stdout.split('\n'):
            if 'https://' in line and '.mp4' in line:
                # 提取URL
                url_match = re.search(r'https://[^\s]+\.mp4[^\s]*', line)
                if url_match:
                    video_url = url_match.group(0)
                    break

        if video_url:
            # 生成标准命名的文件路径
            video_path = get_next_version_filename(output_dir, segment_id)
            print(f"[DOWNLOAD] 下载视频到: {video_path}")

            # 下载视频
            import urllib.request
            try:
                urllib.request.urlretrieve(video_url, video_path)
                print(f"[OK] 视频已保存: {video_path}")

                return {
                    "success": True,
                    "message": "视频生成并下载成功",
                    "video_path": video_path,
                    "task_id": task_id
                }
            except Exception as e:
                print(f"[WARN] 下载失败: {e}")
                return {
                    "success": True,
                    "message": "视频生成成功但下载失败",
                    "video_path": None,
                    "video_url": video_url,
                    "task_id": task_id
                }
        else:
            print(f"[WARN] 未能从输出中提取视频URL")
            return {
                "success": True,
                "message": "视频生成成功但未获取到下载链接",
                "video_path": None,
                "task_id": task_id
            }

    except Exception as e:
        return {
            "success": False,
            "message": f"生成过程出错: {str(e)}",
            "video_path": None,
            "task_id": None
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
    # 使用 anime-material-workbench API
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
        segment_id="SC01-L01",
        duration=5.0,
        output_dir="output"
    )
    print(f"\n生成结果: {json.dumps(result, ensure_ascii=False, indent=2)}")
