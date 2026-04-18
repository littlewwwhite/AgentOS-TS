"""
批量合成配乐视频：扫描 results JSON，并发 ffmpeg 合成
用法：python batch_compose.py <视频目录> [--output output/] [--rank 1] [--volume -6] [--workers 4] [--recursive]
输出：output/compose-<视频名>.mp4（无时间戳，支持断点续传）
"""

import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from dotenv import load_dotenv

# 复用 compose.py 和 batch_analyze.py 的核心函数
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from batch_analyze import scan_videos, VIDEO_EXTENSIONS

# 配置加载
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_ENV = SKILL_DIR / "assets" / "default.env"
if DEFAULT_ENV.exists():
    load_dotenv(DEFAULT_ENV, override=False)
load_dotenv(override=False)


def compose_single(video_path: Path, results_path: Path, output_path: Path,
                    rank: int, volume_db: float, idx: int, total: int) -> dict:
    """合成单个视频，在子进程中执行"""
    stem = video_path.stem

    # 断点续传：已有输出则跳过
    if output_path.exists():
        print(f"[{idx}/{total}] 跳过 {stem}（已有 compose）")
        return {"video": stem, "status": "skipped"}

    print(f"[{idx}/{total}] 正在合成 {stem}...")
    try:
        # 子进程中导入，避免序列化问题
        from compose import compose as do_compose

        # compose() 会自动输出到 output/compose-{stem}-{timestamp}.mp4
        # 批量模式需要固定命名，所以我们需要稍微处理一下
        # 直接调用 compose 函数，它的输出路径带时间戳
        # 我们改用底层逻辑来控制输出路径
        do_compose(str(video_path), str(results_path),
                   rank=rank, volume_db=volume_db,
                   output_path=str(output_path))

        if output_path.exists():
            print(f"[{idx}/{total}] {stem} 合成完成")
            return {"video": stem, "status": "success"}
        else:
            print(f"[{idx}/{total}] {stem} 合成后未找到输出文件")
            return {"video": stem, "status": "failed", "error": "输出文件未生成"}

    except Exception as e:
        print(f"[{idx}/{total}] {stem} 合成失败: {e}")
        return {"video": stem, "status": "failed", "error": str(e)}


def main():
    import argparse
    parser = argparse.ArgumentParser(description="批量合成配乐视频")
    parser.add_argument("directory", help="原视频目录路径")
    parser.add_argument("--output", default="output/", help="results/输出目录（默认 output/）")
    parser.add_argument("--rank", type=int, default=1, help="使用第几名匹配（默认1）")
    parser.add_argument("--volume", type=float, default=-6, help="配乐音量dB（默认-6）")
    parser.add_argument("--workers", type=int, default=4, help="并发数（默认4）")
    parser.add_argument("-r", "--recursive", action="store_true", help="递归扫描子目录")
    args = parser.parse_args()

    video_dir = Path(args.directory)
    output_dir = Path(args.output)

    if not video_dir.is_dir():
        print(f"视频目录不存在: {video_dir}")
        sys.exit(1)

    # 扫描视频文件（复用 batch_analyze 的函数）
    videos = scan_videos(str(video_dir), recursive=args.recursive)

    if not videos:
        hint = "（尝试加 --recursive 递归扫描子目录）" if not args.recursive else ""
        print(f"目录中未找到视频文件: {video_dir}{hint}")
        sys.exit(1)

    # 按 stem 匹配 results JSON
    tasks = []
    for v in videos:
        stem = v.stem
        results_path = output_dir / f"results-{stem}.json"
        compose_path = output_dir / f"compose-{stem}.mp4"

        if not results_path.exists():
            print(f"跳过 {v.name}：未找到 results-{stem}.json")
            continue

        tasks.append((v, results_path, compose_path))

    if not tasks:
        print("没有可合成的视频（所有视频均缺少对应的 results JSON）")
        sys.exit(1)

    total = len(tasks)
    print(f"\n找到 {total} 个待合成视频，并发数: {args.workers}")
    print(f"Rank: {args.rank} | 音量: {args.volume}dB\n")

    output_dir.mkdir(exist_ok=True)
    results = []

    t0 = time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                compose_single, v, rp, cp,
                args.rank, args.volume, i, total
            ): v
            for i, (v, rp, cp) in enumerate(tasks, 1)
        }
        for future in as_completed(futures):
            results.append(future.result())

    elapsed = time.time() - t0
    success = sum(1 for r in results if r["status"] == "success")
    failed = sum(1 for r in results if r["status"] == "failed")
    skipped = sum(1 for r in results if r["status"] == "skipped")

    print(f"\n{'='*50}")
    print(f"批量合成完成 ({elapsed:.1f}s)")
    print(f"  成功: {success} | 失败: {failed} | 跳过: {skipped} | 总计: {total}")

    if failed > 0:
        print("\n失败列表:")
        for r in results:
            if r["status"] == "failed":
                print(f"  - {r['video']}: {r['error']}")


if __name__ == "__main__":
    main()
