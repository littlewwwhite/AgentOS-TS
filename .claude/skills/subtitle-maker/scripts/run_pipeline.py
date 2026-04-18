#!/usr/bin/env python3
"""
Subtitle one-shot pipeline — runs Phase 0→5 for all episodes in one call.

Usage:
  python3 run_pipeline.py /path/to/project/output [--episodes ep001,ep002]
  python3 run_pipeline.py /path/to/project/output --script /path/to/script.json
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
    """Find episode MP4 files (final cuts from video-editing)."""
    eps = []
    for p in sorted(output_dir.iterdir()):
        if not p.is_dir() or not p.name.startswith("ep"):
            continue
        mp4 = p / f"{p.name}.mp4"
        if mp4.exists():
            eps.append(mp4)
    if filter_eps:
        eps = [p for p in eps if p.parent.name in filter_eps]
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
    parser = argparse.ArgumentParser(description="Subtitle one-shot pipeline")
    parser.add_argument("output_dir", help="Project output directory")
    parser.add_argument("--episodes", help="Comma-separated episode list", default=None)
    parser.add_argument("--script", help="Path to script.json for glossary extraction", default=None)
    parser.add_argument("--lang", help="Force language (zh/ja/ko/en)", default=None)
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    episodes = find_episodes(output_dir, args.episodes.split(",") if args.episodes else None)
    if not episodes:
        print(f"[ERROR] No episode MP4 files found in {output_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"[PIPELINE] {len(episodes)} episodes: {', '.join(p.parent.name for p in episodes)}")

    # Phase 0: env check
    ok, _ = run_phase("phase0_check.py", [], "Phase0/check")
    if not ok:
        print("[ERROR] Environment check failed", file=sys.stderr)
        sys.exit(1)

    # Phase 1: glossary (if script.json provided)
    script_path = args.script
    if not script_path:
        candidate = output_dir / "script.json"
        if candidate.exists():
            script_path = str(candidate)

    glossary_path = None
    if script_path:
        glossary_path = str(output_dir / "subtitle_glossary.json")
        run_phase("phase1_glossary.py", [script_path, "-o", glossary_path], "Phase1/glossary")

    results = {}
    for ep_mp4 in episodes:
        ep_name = ep_mp4.parent.name
        ep_dir = ep_mp4.parent

        # Phase 2: transcribe
        srt_path = str(ep_dir / f"{ep_name}.srt")
        phase2_args = [str(ep_mp4), "-o", srt_path]
        if glossary_path:
            phase2_args += ["--glossary", glossary_path]
        if args.lang:
            phase2_args += ["--lang", args.lang]
        ok2, s2 = run_phase("phase2_transcribe.py", phase2_args, f"Phase2/{ep_name}")

        # Phase 3: SRT (may be integrated into phase2)
        ok3, s3 = run_phase("phase3_srt.py", [srt_path], f"Phase3/{ep_name}") if ok2 else (False, "skipped")

        # Phase 4: burn subtitles
        burned_path = str(ep_dir / f"{ep_name}_subtitled.mp4")
        ok4, s4 = run_phase("phase4_burn.py", [str(ep_mp4), srt_path, "-o", burned_path],
                            f"Phase4/{ep_name}") if ok3 else (False, "skipped")

        # Phase 5: XML subtitle track
        xml_path = str(ep_dir / f"{ep_name}_subtitle.xml")
        ok5, s5 = run_phase("phase5_xml.py", [srt_path, "-o", xml_path],
                            f"Phase5/{ep_name}") if ok3 else (False, "skipped")

        results[ep_name] = {"transcribe": s2, "srt": s3, "burn": s4, "xml": s5}

    # Summary
    summary_path = output_dir / "subtitle_summary.json"
    with open(summary_path, "w") as f:
        json.dump({"episodes": results}, f, indent=2, ensure_ascii=False)
    print(f"\n[PIPELINE] Summary: {summary_path}")


if __name__ == "__main__":
    main()
