#!/usr/bin/env python3
# input: output directory containing ep*.mp4 files + optional pre-existing segments/results JSONs
# output: compose-*.mp4 files with background music mixed in
# pos: one-shot music pipeline — chains analyze → (MCP match check) → compose

"""
One-shot music pipeline: analyze video mood, then compose BGM.

The full pipeline has three phases:
  1. batch_analyze.py   — Gemini video analysis → output/segments-{stem}.json
  2. MCP match_music    — vector music matching  → output/results-{stem}.json
                          (must be run by a Claude agent with MCP access, NOT automated here)
  3. batch_compose.py   — ffmpeg BGM composition → output/compose-{stem}.mp4

This script handles phases 1 and 3. Phase 2 requires Claude agent MCP tool access and
cannot be automated via subprocess. If results-*.json files are missing, this script will
print clear instructions for the agent to complete Phase 2 before re-running.

Usage:
  python3 run_music_pipeline.py <output_dir> [options]

  <output_dir>   Directory containing ep*.mp4 files (and output/ sub-dir for JSONs)

Options:
  --episodes     Comma-separated episode stems to process, e.g. ep001,ep002
                 (default: all ep*.mp4 in <output_dir>)
  --workers      Concurrency for analyze and compose phases (default: 3)
  --rank         Which match rank to use for composition (default: 1 = top match)
  --volume       BGM volume in dB (default: -6)
  --recursive    Scan subdirectories for videos
  --skip-analyze Skip Phase 1 even if segments JSONs are missing (for re-compose only)

Examples:
  # Full pipeline from scratch (phase 2 must be done by agent afterwards)
  python3 run_music_pipeline.py /project/output

  # Only selected episodes
  python3 run_music_pipeline.py /project/output --episodes ep001,ep003

  # Re-compose only (segments + results JSONs already present)
  python3 run_music_pipeline.py /project/output --skip-analyze
"""

import argparse
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))


def find_episode_videos(output_dir: Path, episodes: list[str] | None, recursive: bool) -> list[Path]:
    """Scan output_dir for ep*.mp4 files, optionally filtered by episode list."""
    from batch_analyze import scan_videos

    all_videos = scan_videos(str(output_dir), recursive=recursive)

    # Filter to ep* pattern
    ep_videos = [v for v in all_videos if v.stem.startswith("ep")]

    if episodes:
        stems = set(episodes)
        ep_videos = [v for v in ep_videos if v.stem in stems]

    return ep_videos


def run_analyze(output_dir: Path, workers: int, recursive: bool) -> tuple[bool, int, int, int]:
    """
    Run batch_analyze.py on output_dir.

    Returns (all_ok, success, failed, skipped).
    """
    import subprocess

    analyze_script = SCRIPT_DIR / "batch_analyze.py"
    cmd = [sys.executable, str(analyze_script), str(output_dir),
           "--workers", str(workers)]
    if recursive:
        cmd.append("--recursive")

    print(f"\n[Phase 1] Running batch_analyze.py ...")
    print(f"  cmd: {' '.join(cmd)}\n")

    result = subprocess.run(cmd, cwd=str(output_dir))
    return result.returncode == 0


def check_mcp_results(videos: list[Path], json_dir: Path) -> tuple[list[Path], list[Path]]:
    """
    Check which videos have results-*.json (MCP phase 2 output).

    Returns (ready, missing) video lists.
    """
    ready = []
    missing = []
    for v in videos:
        results_path = json_dir / f"results-{v.stem}.json"
        if results_path.exists():
            ready.append(v)
        else:
            missing.append(v)
    return ready, missing


def run_compose(output_dir: Path, rank: int, volume: float, workers: int, recursive: bool) -> bool:
    """Run batch_compose.py on output_dir."""
    import subprocess

    compose_script = SCRIPT_DIR / "batch_compose.py"
    json_dir = output_dir / "output"
    cmd = [sys.executable, str(compose_script), str(output_dir),
           "--output", str(json_dir),
           "--rank", str(rank),
           "--volume", str(volume),
           "--workers", str(workers)]
    if recursive:
        cmd.append("--recursive")

    print(f"\n[Phase 3] Running batch_compose.py ...")
    print(f"  cmd: {' '.join(cmd)}\n")

    result = subprocess.run(cmd, cwd=str(output_dir))
    return result.returncode == 0


def print_mcp_instructions(missing_videos: list[Path], json_dir: Path) -> None:
    """Print instructions for the Claude agent to complete Phase 2 MCP matching."""
    print("\n" + "=" * 60)
    print("[Phase 2] MCP music matching required")
    print("=" * 60)
    print(f"\n{len(missing_videos)} video(s) need MCP match_music calls before composition:\n")
    for v in missing_videos:
        segments_path = json_dir / f"segments-{v.stem}.json"
        results_path = json_dir / f"results-{v.stem}.json"
        status = "SEGMENTS READY" if segments_path.exists() else "SEGMENTS MISSING"
        print(f"  [{status}] {v.name}")
        print(f"    segments: {segments_path}")
        print(f"    results:  {results_path}  ← MISSING")

    print("""
Instructions for Claude agent:
  For each video with SEGMENTS READY, read the segments JSON and call:
    mcp__anime-mcp__match_music(segments=[...])
  Save the returned results to output/results-{stem}.json.

  For videos with SEGMENTS MISSING, run Phase 1 first or check batch_analyze output.

  Once all results-*.json files are written, re-run this script to complete composition:
    python3 run_music_pipeline.py <output_dir> --skip-analyze
""")


def main():
    parser = argparse.ArgumentParser(
        description="One-shot music pipeline: analyze → (MCP match) → compose BGM",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("output_dir", help="Directory containing ep*.mp4 files")
    parser.add_argument("--episodes", help="Comma-separated episode stems (e.g. ep001,ep002)")
    parser.add_argument("--workers", type=int, default=3, help="Concurrency for analyze/compose (default: 3)")
    parser.add_argument("--rank", type=int, default=1, help="Match rank for composition (default: 1)")
    parser.add_argument("--volume", type=float, default=-6.0, help="BGM volume dB (default: -6)")
    parser.add_argument("--recursive", action="store_true", help="Scan subdirectories")
    parser.add_argument("--skip-analyze", action="store_true",
                        help="Skip Phase 1 (assume segments JSONs already exist)")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    json_dir = output_dir / "output"

    if not output_dir.is_dir():
        print(f"[ERROR] Directory not found: {output_dir}", file=sys.stderr)
        sys.exit(1)

    episodes = [e.strip() for e in args.episodes.split(",")] if args.episodes else None

    print(f"[PIPELINE] output_dir:  {output_dir}")
    print(f"[PIPELINE] json_dir:    {json_dir}")
    print(f"[PIPELINE] episodes:    {', '.join(episodes) if episodes else 'all ep*'}")
    print(f"[PIPELINE] workers:     {args.workers}")
    print(f"[PIPELINE] rank/volume: {args.rank} / {args.volume}dB")

    t_start = time.time()

    # ------------------------------------------------------------------
    # Phase 1: Gemini video analysis
    # ------------------------------------------------------------------
    if not args.skip_analyze:
        ok = run_analyze(output_dir, workers=args.workers, recursive=args.recursive)
        if not ok:
            print("[ERROR] Phase 1 (batch_analyze) failed — aborting.", file=sys.stderr)
            sys.exit(1)
        print("[Phase 1] DONE")
    else:
        print("[Phase 1] SKIPPED (--skip-analyze)")

    # ------------------------------------------------------------------
    # Phase 2: Check MCP results coverage
    # ------------------------------------------------------------------
    videos = find_episode_videos(output_dir, episodes, args.recursive)
    if not videos:
        print(f"[ERROR] No ep*.mp4 files found in {output_dir}", file=sys.stderr)
        sys.exit(1)

    ready, missing = check_mcp_results(videos, json_dir)

    print(f"\n[Phase 2] MCP results check: {len(ready)} ready, {len(missing)} missing")

    if missing:
        print_mcp_instructions(missing, json_dir)
        # Still attempt to compose for episodes that are ready
        if not ready:
            print("[PIPELINE] No videos ready for composition. Exiting.")
            sys.exit(2)  # exit code 2 = partial: MCP phase pending
        print(f"[PIPELINE] Proceeding with {len(ready)} ready episode(s).\n")
    else:
        print("[Phase 2] All results JSONs present — proceeding to composition.")

    # ------------------------------------------------------------------
    # Phase 3: FFmpeg BGM composition
    # ------------------------------------------------------------------
    ok = run_compose(
        output_dir,
        rank=args.rank,
        volume=args.volume,
        workers=args.workers,
        recursive=args.recursive,
    )

    elapsed = time.time() - t_start
    print(f"\n{'=' * 60}")
    if ok:
        print(f"[PIPELINE] DONE ({elapsed:.0f}s)")
        if missing:
            print(f"[PIPELINE] WARNING: {len(missing)} episode(s) skipped (MCP results missing)")
            sys.exit(2)
    else:
        print(f"[PIPELINE] Phase 3 (batch_compose) FAILED ({elapsed:.0f}s)", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
