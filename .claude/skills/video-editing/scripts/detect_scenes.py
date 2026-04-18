#!/usr/bin/env python3
"""
视频切镜检测脚本 — 基于 PySceneDetect

支持两种检测模式:
  - content:  固定阈值 (ContentDetector)，适合已知素材风格、参数已调好的场景
  - adaptive: 动态阈值 (AdaptiveDetector)，自动适应画面运动强度，打斗/对话通吃

依赖: pip install scenedetect av

用法:
  python detect_scenes.py <video_or_dir> [options]

示例:
  python detect_scenes.py ./test-video/test-4.mp4
  python detect_scenes.py ./test-video/ --mode adaptive
  python detect_scenes.py ./test-video/ --mode content --threshold 37
  python detect_scenes.py ./test-video/ -o results.json
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# 在任何 av/scenedetect import 之前，抑制 C 层 ffmpeg/swscaler 警告
try:
    import av
    av.logging.set_level(av.logging.ERROR)
except Exception:
    os.environ.setdefault("AV_LOG_LEVEL", "error")

try:
    import cv2
    cv2.setLogLevel(0)
except Exception:
    pass

# Python 层 libav logger 也抑制（兜底）
logging.getLogger("libav").setLevel(logging.ERROR)

from scenedetect import open_video, SceneManager
from scenedetect.detectors import AdaptiveDetector, ContentDetector


def detect_scenes(
    video_path: str,
    mode: str = "adaptive",
    threshold: float = 37.0,
    adaptive_threshold: float = 3.0,
    min_content_val: float = 15.0,
    window_width: int = 2,
    min_scene_sec: float = 1.0,
) -> dict:
    """对单个视频做切镜检测，返回结构化结果。"""
    video = open_video(video_path, backend="pyav")
    fps = video.frame_rate
    duration = video.duration.get_seconds()
    min_scene_len = max(1, int(fps * min_scene_sec))

    sm = SceneManager()

    if mode == "content":
        sm.add_detector(
            ContentDetector(threshold=threshold, min_scene_len=min_scene_len)
        )
    else:
        sm.add_detector(
            AdaptiveDetector(
                adaptive_threshold=adaptive_threshold,
                min_scene_len=min_scene_len,
                min_content_val=min_content_val,
                window_width=window_width,
            )
        )

    sm.detect_scenes(video, show_progress=False)
    scenes = sm.get_scene_list()

    scene_list = []
    for i, (start, end) in enumerate(scenes):
        scene_list.append(
            {
                "scene": i + 1,
                "start": round(start.get_seconds(), 3),
                "end": round(end.get_seconds(), 3),
                "start_timecode": start.get_timecode(),
                "end_timecode": end.get_timecode(),
                "duration": round(end.get_seconds() - start.get_seconds(), 3),
            }
        )

    return {
        "file": str(video_path),
        "fps": round(fps, 2),
        "duration": round(duration, 3),
        "mode": mode,
        "params": {
            "threshold": threshold if mode == "content" else None,
            "adaptive_threshold": adaptive_threshold if mode == "adaptive" else None,
            "min_content_val": min_content_val if mode == "adaptive" else None,
            "window_width": window_width if mode == "adaptive" else None,
            "min_scene_sec": min_scene_sec,
            "min_scene_len_frames": min_scene_len,
        },
        "total_scenes": len(scenes),
        "total_cuts": max(0, len(scenes) - 1),
        "cut_points": [s["start"] for s in scene_list[1:]],
        "scenes": scene_list,
    }


def main():
    parser = argparse.ArgumentParser(description="视频切镜检测")
    parser.add_argument("input", help="视频文件或包含视频的目录")
    parser.add_argument(
        "--mode",
        choices=["content", "adaptive"],
        default="adaptive",
        help="检测模式: content=固定阈值, adaptive=动态阈值 (default: adaptive)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=37.0,
        help="content 模式的固定阈值 (default: 37)",
    )
    parser.add_argument(
        "--adaptive-threshold",
        type=float,
        default=3.0,
        help="adaptive 模式的偏离倍率 (default: 3.0)",
    )
    parser.add_argument(
        "--min-content-val",
        type=float,
        default=15.0,
        help="adaptive 模式的最小变化量门槛 (default: 15.0)",
    )
    parser.add_argument(
        "--window-width",
        type=int,
        default=2,
        help="adaptive 模式的滑动窗口半径/帧数 (default: 2)",
    )
    parser.add_argument(
        "--min-scene-sec",
        type=float,
        default=1.0,
        help="最小镜头时长/秒，自动乘以 fps 得到帧数 (default: 1.0)",
    )
    parser.add_argument("-o", "--output", help="输出 JSON 文件路径")
    parser.add_argument(
        "--quiet", action="store_true", help="安静模式，只输出 JSON"
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

    if input_path.is_file():
        videos = [input_path]
    elif input_path.is_dir():
        videos = sorted(
            [f for f in input_path.iterdir() if f.suffix.lower() in video_exts]
        )
    else:
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    if not videos:
        print(f"Error: no video files in {input_path}", file=sys.stderr)
        sys.exit(1)

    results = []
    for vpath in videos:
        if not args.quiet:
            print(f"Analyzing: {vpath.name} ...", file=sys.stderr)

        result = detect_scenes(
            str(vpath),
            mode=args.mode,
            threshold=args.threshold,
            adaptive_threshold=args.adaptive_threshold,
            min_content_val=args.min_content_val,
            window_width=args.window_width,
            min_scene_sec=args.min_scene_sec,
        )
        results.append(result)

        if not args.quiet:
            print(
                f"  → {result['total_scenes']} scenes, "
                f"{result['total_cuts']} cuts, "
                f"fps={result['fps']}, "
                f"duration={result['duration']}s",
                file=sys.stderr,
            )
            if result["cut_points"]:
                print(
                    f"  → cuts at: {result['cut_points']}s",
                    file=sys.stderr,
                )
            print(file=sys.stderr)

    output = results if len(results) > 1 else results[0]
    json_str = json.dumps(output, ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(json_str, encoding="utf-8")
        if not args.quiet:
            print(f"Results saved to: {args.output}", file=sys.stderr)
    else:
        print(json_str)


if __name__ == "__main__":
    main()
