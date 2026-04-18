#!/usr/bin/env python3
"""
Unified production pipeline — executes all post-director phases in one call.

Usage:
  python3 run_production.py <project_dir> [options]

Requires:
  - <project_dir>/output/script.json
  - <project_dir>/output/director_bible.json

Phases:
  1. asset-gen:   Generate character/scene images (AWB API batch)
  2. storyboard:  Generate shot prompts (Claude API batch parallel)
  3. video-gen:   Submit video generation (AWB API batch)
  4. editing:     Assemble final cuts (Gemini + ffmpeg batch)
  5. post:        Music + subtitles (Gemini + ffmpeg batch)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = Path(__file__).parent
VIDEO_GEN_SKILL_DIR = SCRIPT_DIR.parent
PRODUCER_SKILLS = VIDEO_GEN_SKILL_DIR.parent
PROJECT_ROOT = SCRIPT_DIR.parents[5]
DIRECTOR_SKILLS = PROJECT_ROOT / "agents" / "director" / ".claude" / "skills"

# Phase scripts
PHASE_SCRIPTS = {
    "asset-gen": DIRECTOR_SKILLS / "asset-gen/scripts/generate_all_assets.py",
    "storyboard": None,  # Custom: parallel Claude API calls (storyboard_batch.py in same dir)
    "video-gen": PRODUCER_SKILLS / "video-gen/scripts/batch_generate.py",
    "editing": PRODUCER_SKILLS / "video-editing/scripts/run_pipeline.py",
    "music": PRODUCER_SKILLS / "music-matcher/scripts/run_music_pipeline.py",
    "subtitle": PRODUCER_SKILLS / "subtitle-maker/scripts/run_pipeline.py",
}


def load_required_json(path: Path, name: str) -> dict:
    if not path.exists():
        print(f"[ERROR] {name} not found: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


def run_phase(name: str, cmd: list[str], dry_run: bool = False) -> tuple[bool, str]:
    print(f"\n{'='*60}")
    print(f"[Phase: {name}] {'DRY RUN' if dry_run else 'EXECUTING'}")
    print(f"  cmd: {' '.join(cmd[:5])}...")
    print(f"{'='*60}")

    if dry_run:
        return True, "DRY RUN"

    import subprocess
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=False)
    elapsed = time.time() - t0
    ok = result.returncode == 0
    return ok, f"{'OK' if ok else 'FAILED'} ({elapsed:.0f}s)"


def phase_storyboard(project_dir: Path, bible: dict, script: dict, dry_run: bool) -> tuple[bool, str]:
    """Generate storyboard prompts using parallel Claude API calls."""
    print(f"\n{'='*60}")
    print(f"[Phase: storyboard] {'DRY RUN' if dry_run else 'EXECUTING'}")
    print(f"  Using Claude API directly (not agent) for batch prompt generation")
    print(f"{'='*60}")

    if dry_run:
        episodes = script.get("episodes", [])
        scenes = sum(len(ep.get("scenes", [])) for ep in episodes)
        print(f"  Would generate {scenes} scene prompts across {len(episodes)} episodes")
        return True, "DRY RUN"

    # Import the storyboard batch generator (to be implemented in Task 2.2)
    sys.path.insert(0, str(SCRIPT_DIR))
    try:
        from storyboard_batch import generate_all_storyboards
        return generate_all_storyboards(project_dir, bible, script)
    except ImportError:
        print("[WARN] storyboard_batch.py not yet implemented, skipping")
        return False, "NOT IMPLEMENTED"


def main():
    parser = argparse.ArgumentParser(description="Unified production pipeline")
    parser.add_argument("project_dir", help="Project directory (contains output/)")
    parser.add_argument("--dry-run", action="store_true", help="Show plan without executing")
    parser.add_argument("--phases", help="Comma-separated phases to run (default: all)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip phases with existing output")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    output_dir = project_dir / "output"

    # Load required artifacts
    script = load_required_json(output_dir / "script.json", "script.json")
    bible = load_required_json(output_dir / "director_bible.json", "director_bible.json")

    phases = args.phases.split(",") if args.phases else [
        "asset-gen", "storyboard", "video-gen", "editing", "music", "subtitle"
    ]

    print(f"[PIPELINE] Project: {project_dir}")
    print(f"[PIPELINE] Phases: {', '.join(phases)}")
    print(f"[PIPELINE] {'DRY RUN' if args.dry_run else 'LIVE'}")

    results = {}
    t_start = time.time()

    for phase in phases:
        if phase == "storyboard":
            ok, status = phase_storyboard(project_dir, bible, script, args.dry_run)
        elif phase in PHASE_SCRIPTS and PHASE_SCRIPTS[phase]:
            script_path = PHASE_SCRIPTS[phase]
            if not script_path.exists():
                print(f"[WARN] Script not found: {script_path}")
                results[phase] = "SCRIPT NOT FOUND"
                continue
            ok, status = run_phase(phase, [
                sys.executable, str(script_path), str(output_dir)
            ], dry_run=args.dry_run)
        else:
            results[phase] = "NOT CONFIGURED"
            continue
        results[phase] = status

    # Summary
    elapsed = time.time() - t_start
    summary = {
        "status": "success" if all("OK" in s or "DRY" in s for s in results.values()) else "partial",
        "elapsed_seconds": round(elapsed),
        "phases": results,
    }

    summary_path = output_dir / "production_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"\n[PIPELINE] Summary: {summary_path}")
    print(f"[PIPELINE] Total: {elapsed:.0f}s")


if __name__ == "__main__":
    main()
