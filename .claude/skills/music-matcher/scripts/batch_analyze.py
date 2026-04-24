"""
批量视频分析：扫描目录下所有视频，并发调 Gemini 分析，输出 segments JSON
用法：python batch_analyze.py <视频目录> [--workers 3] [--recursive]
输出：output/segments-<视频名>.json（无时间戳，支持断点续传）
"""

import os
import sys
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from dotenv import load_dotenv

# 复用 analyze_video.py 的核心函数
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from analyze_video import (
    compress_video, upload_video, analyze_with_gemini, parse_time,
    SKILL_DIR, DEFAULT_ENV, GEMINI_API_KEY, GEMINI_BASE_URL,
)

# 配置加载（analyze_video 导入时已加载，这里确保一致）
if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
load_dotenv(override=False)

OUTPUT_DIR = Path.cwd() / "output"
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}


def scan_videos(directory: str, recursive: bool = False) -> list[Path]:
    """扫描目录下的视频文件，按文件名排序

    Args:
        directory: 目录路径
        recursive: 是否递归扫描子目录
    """
    video_dir = Path(directory)
    if not video_dir.is_dir():
        raise NotADirectoryError(f"不是有效目录: {directory}")

    if recursive:
        # 递归扫描所有子目录
        videos = [
            f for f in video_dir.rglob("*")
            if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS
        ]
    else:
        # 只扫描当前目录
        videos = [
            f for f in sorted(video_dir.iterdir())
            if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS
        ]
    return sorted(videos)


def analyze_single(video_path: Path, idx: int, total: int) -> dict:
    """分析单个视频，返回结果字典"""
    stem = video_path.stem
    output_path = OUTPUT_DIR / f"segments-{stem}.json"

    # 断点续传：已有输出则跳过
    if output_path.exists():
        print(f"[{idx}/{total}] 跳过 {video_path.name}（已有 segments）")
        return {"video": video_path.name, "status": "skipped"}

    print(f"[{idx}/{total}] 正在分析 {video_path.name}...")
    try:
        from google import genai as google_genai
        from google.genai import types as genai_types
        client = google_genai.Client(
            api_key=GEMINI_API_KEY,
            http_options=genai_types.HttpOptions(base_url=GEMINI_BASE_URL),
        )

        compressed = compress_video(str(video_path))
        upload_path = compressed or str(video_path)
        video_file = upload_video(upload_path, client)
        if compressed:
            Path(compressed).unlink(missing_ok=True)

        segments = analyze_with_gemini(video_file, stem, client)

        # 计算 duration_seconds
        for seg in segments:
            start_sec = parse_time(seg["start"])
            end_sec = parse_time(seg["end"])
            seg["duration_seconds"] = round(end_sec - start_sec, 2)

        # 保存（固定命名，无时间戳）
        OUTPUT_DIR.mkdir(exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(segments, f, ensure_ascii=False, indent=2)

        music_count = sum(1 for s in segments if s.get("needs_music"))
        print(f"[{idx}/{total}] {video_path.name} 完成: {len(segments)} 片段, {music_count} 需配乐")
        return {"video": video_path.name, "status": "success", "segments": len(segments)}

    except Exception as e:
        print(f"[{idx}/{total}] {video_path.name} 失败: {e}")
        return {"video": video_path.name, "status": "failed", "error": str(e)}


def main():
    import argparse
    parser = argparse.ArgumentParser(description="批量视频分析")
    parser.add_argument("directory", help="视频目录路径")
    parser.add_argument("--workers", type=int, default=3, help="并发数（默认3）")
    parser.add_argument("-r", "--recursive", action="store_true", help="递归扫描子目录")
    args = parser.parse_args()

    if not GEMINI_API_KEY:
        print("请设置 GEMINI_API_KEY 环境变量（值使用 ChatFire key）")
        sys.exit(1)

    videos = scan_videos(args.directory, recursive=args.recursive)
    if not videos:
        hint = "（尝试加 --recursive 递归扫描子目录）" if not args.recursive else ""
        print(f"目录中未找到视频文件: {args.directory}{hint}")
        sys.exit(1)

    total = len(videos)
    mode = "递归" if args.recursive else "当前目录"
    print(f"\n找到 {total} 个视频文件（{mode}），并发数: {args.workers}")
    print(f"输出目录: {OUTPUT_DIR}\n")

    OUTPUT_DIR.mkdir(exist_ok=True)
    results = []

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(analyze_single, v, i, total): v
            for i, v in enumerate(videos, 1)
        }
        for future in as_completed(futures):
            results.append(future.result())

    elapsed = time.time() - t0
    success = sum(1 for r in results if r["status"] == "success")
    failed = sum(1 for r in results if r["status"] == "failed")
    skipped = sum(1 for r in results if r["status"] == "skipped")

    print(f"\n{'='*50}")
    print(f"批量分析完成 ({elapsed:.1f}s)")
    print(f"  成功: {success} | 失败: {failed} | 跳过: {skipped} | 总计: {total}")

    if failed > 0:
        print("\n失败列表:")
        for r in results:
            if r["status"] == "failed":
                print(f"  - {r['video']}: {r['error']}")


if __name__ == "__main__":
    main()
