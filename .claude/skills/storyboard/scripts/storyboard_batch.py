#!/usr/bin/env python3
# input: project script/director bible and storyboard model boundary env vars
# output: per-episode draft storyboard JSON under output/storyboard/draft/
# pos: batch storyboard draft generation helper
"""
Batch storyboard generation using parallel model boundary calls.

Two-pass architecture:
  Pass 0: caller provides or prepares per-episode director notes
  Pass 1: configured text provider generates per-scene shot prompts (N parallel calls)

Usage:
  python3 storyboard_batch.py <project_dir> [--dry-run] [--episodes ep001,ep002]
  python3 storyboard_batch.py <project_dir> --concurrency 5
"""

import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROMPT_FILE = SCRIPT_DIR / "prompts" / "storyboard_system.txt"
DEFAULT_TEXT_MODEL = "gemini-3.1-flash-lite"
_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


def get_default_text_model() -> str:
    return os.environ.get("STORYBOARD_TEXT_MODEL") or os.environ.get(
        "GEMINI_TEXT_MODEL", DEFAULT_TEXT_MODEL
    )


class StoryboardModelClient:
    provider = "aos-cli"

    def __init__(self, project_dir: Path):
        self.project_dir = Path(project_dir).resolve()

    def generate(self, system_prompt: str, user_content: str, model: str | None) -> object:
        request = {
            "apiVersion": "aos-cli.model/v1",
            "task": "storyboard.batch",
            "capability": "generate",
            "output": {"kind": "json"},
            "input": {
                "system": system_prompt,
                "content": user_content,
            },
            "options": {
                "temperature": float(
                    os.environ.get(
                        "STORYBOARD_TEXT_TEMPERATURE",
                        os.environ.get("GEMINI_TEXT_TEMPERATURE", "0.6"),
                    )
                ),
                "maxOutputTokens": int(
                    os.environ.get(
                        "STORYBOARD_TEXT_MAX_OUTPUT_TOKENS",
                        os.environ.get("GEMINI_TEXT_MAX_OUTPUT_TOKENS", "2000"),
                    )
                ),
            },
        }
        if model:
            request["modelPolicy"] = {"model": model}

        with tempfile.TemporaryDirectory(prefix="storyboard-aos-cli-") as tmp:
            request_path = Path(tmp) / "request.json"
            response_path = Path(tmp) / "response.json"
            request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
            completed = aos_cli_model_run(request_path, response_path, cwd=self.project_dir)
            response = _read_response_envelope(response_path)

        if not response:
            if completed.returncode != 0:
                raise RuntimeError(
                    completed.stderr or f"aos-cli failed with exit code {completed.returncode}"
                )
            raise RuntimeError("aos-cli did not write a response envelope")

        if not response.get("ok"):
            error = response.get("error") or {}
            raise RuntimeError(error.get("message") or "aos-cli model generation failed")

        output = response.get("output") or {}
        if "data" in output and output["data"] is not None:
            return output["data"]
        if "text" in output and output["text"]:
            return parse_storyboard_output_text(output["text"])
        raise RuntimeError("aos-cli response missing storyboard output.data/output.text")


def _read_response_envelope(response_path: Path) -> dict:
    if not response_path.exists():
        return {}
    try:
        return json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli response envelope: {response_path}") from exc


def parse_storyboard_output_text(text: str) -> object:
    text = (text or "").strip()
    if not text:
        raise RuntimeError("aos-cli response missing storyboard content")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re

        match = re.search(r"```(?:json)?\s*(\[.*?\]|\{.*?\})\s*```", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        return text


def normalize_scene_shots(raw_output, scene: dict | None = None) -> list[dict]:
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
                    "source_refs": normalize_source_refs(item.get("source_refs", []), scene),
                    "prompt": prompt,
                })
                continue

        normalized.append({
            "source_refs": [],
            "prompt": json.dumps(item, ensure_ascii=False) if not isinstance(item, str) else item,
        })

    return normalized


def normalize_source_refs(raw_refs, scene: dict | None = None) -> list[int]:
    if raw_refs is None:
        return []
    if not isinstance(raw_refs, list):
        raw_refs = [raw_refs]

    index_by_id = scene_source_index(scene or {})
    source_count = scene_source_count(scene or {})
    normalized = []
    for raw_ref in raw_refs:
        if isinstance(raw_ref, bool):
            raise ValueError(f"Invalid source_ref: {raw_ref}")
        if isinstance(raw_ref, int):
            index = raw_ref
        elif isinstance(raw_ref, str) and raw_ref in index_by_id:
            index = index_by_id[raw_ref]
        elif isinstance(raw_ref, str) and raw_ref.isdigit():
            index = int(raw_ref)
        else:
            raise ValueError(f"Unknown source_ref: {raw_ref}")
        if source_count == 0 or index < 0 or index >= source_count:
            raise ValueError(f"source_ref out of range: {raw_ref}")
        if index not in normalized:
            normalized.append(index)
    return normalized


def scene_source_index(scene: dict) -> dict[str, int]:
    items = scene_source_items(scene)
    index_by_id = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        for key in ("action_id", "beat_id", "id"):
            value = item.get(key)
            if isinstance(value, str) and value:
                index_by_id[value] = index
    return index_by_id


def scene_source_count(scene: dict) -> int:
    return len(scene_source_items(scene))


def scene_source_items(scene: dict) -> list:
    actions = scene.get("actions")
    if isinstance(actions, list) and actions:
        return actions
    beats = scene.get("beats")
    if isinstance(beats, list):
        return beats
    return []


def load_storyboard_client(project_dir: Path):
    return StoryboardModelClient(project_dir=project_dir)


def generate_scene_prompt(client, system_prompt: str, ep_notes: str, scene: dict, model: str) -> dict:
    raw = client.generate(
        system_prompt=system_prompt,
        user_content=(
            f"导演笔记:\n{ep_notes}\n\n"
            f"场景 JSON:\n{json.dumps(scene, ensure_ascii=False)}\n\n"
            "请只输出 JSON 数组或对象，source_refs 必须使用当前场 actions[] 的 0-based 整数下标；"
            "若场景只有 beats[]，则使用 beats[] 的 0-based 整数下标。"
            "格式为 [{\"source_refs\": [0], \"prompt\": \"...\"}]。"
        ),
        model=model,
    )
    return normalize_scene_shots(raw, scene)


def generate_all_storyboards(project_dir: Path, bible: dict, script: dict,
                              dry_run: bool = False, concurrency: int = 5,
                              model: str | None = None) -> tuple[bool, str]:
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

    system_prompt = PROMPT_FILE.read_text() if PROMPT_FILE.exists() else "Generate video storyboard prompts."

    client = load_storyboard_client(project_dir=project_dir)
    model = model or get_default_text_model()

    ep_notes_map = bible.get("episodes", {})
    global_style = json.dumps(bible.get("global_style", {}), ensure_ascii=False)

    t0 = time.time()

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

        storyboards = {}
        failures = []
        for future in as_completed(futures):
            ep_id, scene_id = futures[future]
            try:
                shots = future.result()
                storyboards[(ep_id, scene_id)] = shots
                print(f"  OK {ep_id}/{scene_id}: {len(shots)} shots")
            except Exception as e:
                failures.append(f"{ep_id}/{scene_id}: {e}")
                print(f"  FAIL {ep_id}/{scene_id}: {e}", file=sys.stderr)

    elapsed = time.time() - t0
    if failures:
        return False, f"FAILED ({len(failures)} scene failures, {elapsed:.0f}s): " + "; ".join(failures)

    draft_root = output_dir / "storyboard" / "draft"
    draft_root.mkdir(parents=True, exist_ok=True)
    for ep in episodes:
        ep_id = ep.get("ep_id", "unknown")
        scene_payloads = []
        for scene in ep.get("scenes", []):
            scene_id = scene.get("scene_id", "unknown")
            shots = storyboards.get((ep_id, scene_id), [])
            scene_payloads.append({
                "scene_id": scene_id,
                "shots": shots,
            })
        sb_path = draft_root / f"{ep_id}_storyboard.json"
        with open(sb_path, "w") as f:
            json.dump(
                {"episode_id": ep_id, "status": "draft", "scenes": scene_payloads},
                f,
                indent=2,
                ensure_ascii=False,
            )
        print(f"  -> {sb_path}")

    return True, f"OK ({total_scenes} scenes, {elapsed:.0f}s)"


def main():
    parser = argparse.ArgumentParser(description="Batch storyboard generation")
    parser.add_argument("project_dir", help="Project directory")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--episodes", help="Comma-separated episode filter")
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--model", default=get_default_text_model())
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
