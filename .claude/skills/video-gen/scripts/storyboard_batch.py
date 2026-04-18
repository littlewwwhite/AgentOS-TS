#!/usr/bin/env python3
"""
Batch storyboard generation using parallel Claude API calls.

Two-pass architecture:
  Pass 0: Claude reads full script -> generates per-episode director notes (1 call)
  Pass 1: Claude generates per-scene shot prompts (N parallel calls, minimal context)

Usage:
  python3 storyboard_batch.py <project_dir> [--dry-run] [--episodes ep001,ep002]
  python3 storyboard_batch.py <project_dir> --concurrency 5
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = Path(__file__).parent
PROMPT_FILE = SCRIPT_DIR / "prompts" / "storyboard_system.txt"


def normalize_scene_shots(raw_output) -> list[dict]:
    """Normalize storyboard model output to [{source_refs, prompt}]."""
    if isinstance(raw_output, dict):
        raw_items = raw_output.get("shots", [raw_output])
    elif isinstance(raw_output, list):
        raw_items = raw_output
    else:
        raw_items = [raw_output]

    normalized = []
    for item in raw_items:
        if isinstance(item, str):
            normalized.append({
                "source_refs": [],
                "prompt": item,
            })
            continue

        if isinstance(item, dict):
            prompt = item.get("prompt")
            if prompt:
                normalized.append({
                    "source_refs": item.get("source_refs", []),
                    "prompt": prompt,
                })
                continue

        normalized.append({
            "source_refs": [],
            "prompt": json.dumps(item, ensure_ascii=False) if not isinstance(item, str) else item,
        })

    return normalized


def load_claude_client():
    """Initialize Anthropic client from env vars."""
    try:
        import anthropic
    except ImportError:
        print("[ERROR] pip install anthropic", file=sys.stderr)
        sys.exit(1)

    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[ERROR] ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return anthropic.Anthropic(**kwargs)


def generate_scene_prompt(client, system_prompt: str, ep_notes: str, scene: dict, model: str) -> dict:
    """Generate storyboard prompt for a single scene via Claude API."""
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"导演笔记:\n{ep_notes}\n\n场景:\n{json.dumps(scene, ensure_ascii=False)}\n\n生成分镜提示词 JSON:",
        }],
    )
    text = response.content[0].text
    # Extract JSON from response
    try:
        # Try to parse directly
        return normalize_scene_shots(json.loads(text))
    except json.JSONDecodeError:
        # Try to find JSON in markdown code block
        import re
        match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
        if match:
            return normalize_scene_shots(json.loads(match.group(1)))
        return normalize_scene_shots(text)


def generate_all_storyboards(project_dir: Path, bible: dict, script: dict,
                              dry_run: bool = False, concurrency: int = 5,
                              model: str = "claude-sonnet-4-6") -> tuple[bool, str]:
    """Main entry: generate storyboards for all episodes."""
    output_dir = project_dir / "output"
    episodes = script.get("episodes", [])

    total_scenes = sum(len(ep.get("scenes", [])) for ep in episodes)
    print(f"[storyboard] {len(episodes)} episodes, {total_scenes} scenes, concurrency={concurrency}")

    if dry_run:
        for ep in episodes:
            ep_id = ep.get("ep_id", "?")
            n_scenes = len(ep.get("scenes", []))
            print(f"  DRY RUN: {ep_id} -> {n_scenes} scenes")
        return True, f"DRY RUN ({total_scenes} scenes)"

    # Load system prompt
    system_prompt = PROMPT_FILE.read_text() if PROMPT_FILE.exists() else "Generate video storyboard prompts."

    # Initialize Claude client
    client = load_claude_client()

    # Per-episode director notes from bible
    ep_notes_map = bible.get("episodes", {})
    global_style = json.dumps(bible.get("global_style", {}), ensure_ascii=False)

    t0 = time.time()

    # Parallel scene prompt generation
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {}
        for ep in episodes:
            ep_id = ep.get("ep_id", "unknown")
            ep_notes = json.dumps(ep_notes_map.get(ep_id, {}), ensure_ascii=False)
            full_notes = f"全局风格: {global_style}\n\n本集导演笔记: {ep_notes}"

            for scene in ep.get("scenes", []):
                future = pool.submit(
                    generate_scene_prompt, client, system_prompt, full_notes, scene, model
                )
                futures[future] = (ep_id, scene.get("scene_id", "unknown"))

        # Collect results
        storyboards = {}  # (ep_id, scene_id) -> [shots]
        for future in as_completed(futures):
            ep_id, scene_id = futures[future]
            try:
                shots = future.result()
                storyboards[(ep_id, scene_id)] = shots
                print(f"  OK {ep_id}/{scene_id}: {len(shots)} shots")
            except Exception as e:
                print(f"  FAIL {ep_id}/{scene_id}: {e}", file=sys.stderr)
                storyboards[(ep_id, scene_id)] = []

    # Write storyboard JSONs and merge shots back into script.json
    for ep in episodes:
        ep_id = ep.get("ep_id", "unknown")
        scene_payloads = []
        for scene in ep.get("scenes", []):
            scene_id = scene.get("scene_id", "unknown")
            shots = storyboards.get((ep_id, scene_id), [])
            scene["shots"] = shots
            scene_payloads.append({
                "scene_id": scene_id,
                "shots": shots,
            })
        ep_dir = output_dir / ep_id
        ep_dir.mkdir(parents=True, exist_ok=True)
        sb_path = ep_dir / f"{ep_id}_storyboard.json"
        with open(sb_path, "w") as f:
            json.dump({"episode": ep_id, "scenes": scene_payloads}, f, indent=2, ensure_ascii=False)
        print(f"  -> {sb_path}")

    with open(output_dir / "script.json", "w") as f:
        json.dump(script, f, indent=2, ensure_ascii=False)
    print(f"  -> {output_dir / 'script.json'}")

    elapsed = time.time() - t0
    return True, f"OK ({total_scenes} scenes, {elapsed:.0f}s)"


def main():
    parser = argparse.ArgumentParser(description="Batch storyboard generation")
    parser.add_argument("project_dir", help="Project directory")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--episodes", help="Comma-separated episode filter")
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--model", default="claude-sonnet-4-6")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    output_dir = project_dir / "output"

    script = json.loads((output_dir / "script.json").read_text())
    bible = json.loads((output_dir / "director_bible.json").read_text())

    if args.episodes:
        ep_filter = set(args.episodes.split(","))
        script["episodes"] = [ep for ep in script["episodes"] if ep.get("ep_id") in ep_filter]

    ok, status = generate_all_storyboards(
        project_dir, bible, script,
        dry_run=args.dry_run, concurrency=args.concurrency, model=args.model
    )
    print(f"\n[storyboard] {status}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
