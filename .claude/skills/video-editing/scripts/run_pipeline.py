#!/usr/bin/env python3
"""
Video editing one-shot pipeline — runs Phase 1→2→3 for all episodes in one call.

Replaces 89+ agent tool calls with a single Bash invocation.

Usage:
  python3 run_pipeline.py /path/to/project/output [--episodes ep001,ep002]
  python3 run_pipeline.py /path/to/project/output --skip-existing
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent


def find_episodes(output_dir: Path, filter_eps: list[str] | None = None) -> list[Path]:
    eps = sorted(p for p in output_dir.iterdir()
                 if p.is_dir() and p.name.startswith("ep") and p.name[2:].isdigit())
    if filter_eps:
        eps = [p for p in eps if p.name in filter_eps]
    return eps


def run_phase(script: str, args: list[str], label: str) -> tuple[bool, str]:
    cmd = [sys.executable, str(SCRIPT_DIR / script)] + args
    print(f"\n{'='*60}")
    print(f"[{label}] {' '.join(cmd)}")
    print(f"{'='*60}")
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=False)
    elapsed = time.time() - t0
    ok = result.returncode == 0
    status = "OK" if ok else f"FAILED (exit {result.returncode})"
    print(f"[{label}] {status} ({elapsed:.1f}s)")
    return ok, status


def main():
    parser = argparse.ArgumentParser(description="Video editing one-shot pipeline")
    parser.add_argument("output_dir", help="Project output directory containing ep{NNN}/ folders")
    parser.add_argument("--episodes", help="Comma-separated episode list (default: all)", default=None)
    parser.add_argument("--skip-existing", action="store_true", help="Skip phases with existing output")
    parser.add_argument("--concurrency", type=int, default=2, help="Parallel workers for Phase 2")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    if not output_dir.exists():
        print(f"[ERROR] Output directory not found: {output_dir}", file=sys.stderr)
        sys.exit(1)

    filter_eps = args.episodes.split(",") if args.episodes else None
    episodes = find_episodes(output_dir, filter_eps)
    if not episodes:
        print(f"[ERROR] No episode directories found in {output_dir}", file=sys.stderr)
        sys.exit(1)

    ep_names = [ep.name for ep in episodes]
    print(f"[PIPELINE] {len(episodes)} episodes: {', '.join(ep_names)}")
    print(f"[PIPELINE] skip_existing={args.skip_existing}, concurrency={args.concurrency}")

    results = {}
    pipeline_ok = True
    t_start = time.time()

    # ── Phase 1: Analyze all episodes ──
    skip_args = ["--skip-existing"] if args.skip_existing else []
    for ep in episodes:
        ok, status = run_phase(
            "phase1_analyze.py",
            [str(ep), "-o", str(output_dir)] + skip_args,
            f"Phase1/{ep.name}",
        )
        results[f"phase1/{ep.name}"] = status
        if not ok:
            print(f"[WARN] Phase 1 failed for {ep.name}, continuing with remaining episodes")

    # ── Phase 2: Assemble all episodes ──
    for ep in episodes:
        ok, status = run_phase(
            "phase2_assemble.py",
            [str(ep), "-o", str(output_dir), "--storyboard", "auto",
             "--concurrency", str(args.concurrency)] + skip_args,
            f"Phase2/{ep.name}",
        )
        results[f"phase2/{ep.name}"] = status
        if not ok:
            print(f"[WARN] Phase 2 failed for {ep.name}, continuing with remaining episodes")

    # ── Phase 3: Merge all episodes at once ──
    ok, status = run_phase(
        "phase3_merge.py",
        [str(ep) for ep in episodes],
        "Phase3/merge-all",
    )
    results["phase3/merge-all"] = status
    if not ok:
        pipeline_ok = False

    # ── Summary ──
    elapsed = time.time() - t_start
    print(f"\n{'='*60}")
    print(f"[PIPELINE] COMPLETE in {elapsed:.0f}s")
    print(f"{'='*60}")

    # Check outputs
    final_outputs = []
    for ep in episodes:
        mp4 = output_dir / ep.name / f"{ep.name}.mp4"
        xml = output_dir / ep.name / f"{ep.name}.xml"
        final_outputs.append({
            "episode": ep.name,
            "mp4": str(mp4) if mp4.exists() else None,
            "xml": str(xml) if xml.exists() else None,
        })
        status = "✅" if mp4.exists() else "❌"
        print(f"  {status} {ep.name}: mp4={'yes' if mp4.exists() else 'NO'} xml={'yes' if xml.exists() else 'NO'}")

    # Write summary JSON for agent consumption
    summary = {
        "status": "success" if pipeline_ok else "partial",
        "episodes": len(episodes),
        "elapsed_seconds": round(elapsed),
        "outputs": final_outputs,
        "phase_results": results,
    }
    summary_path = output_dir / "editing_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"\n[PIPELINE] Summary written to: {summary_path}")


if __name__ == "__main__":
    main()
