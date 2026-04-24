#!/usr/bin/env python3
# input: project dir plus one episode-scene storyboard result payload
# output: draft/approved storyboard artifact and synced pipeline-state
# pos: lightweight storyboard artifact bridge for main-session orchestration

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from pipeline_state import ensure_state, update_artifact, update_episode, update_stage


def load_payload(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("storyboard payload must be a JSON object")
    if not isinstance(payload.get("episode_id"), str) or not payload["episode_id"].strip():
        raise ValueError("storyboard payload.episode_id must be a non-empty string")
    if not isinstance(payload.get("scene_id"), str) or not payload["scene_id"].strip():
        raise ValueError("storyboard payload.scene_id must be a non-empty string")
    shots = payload.get("shots")
    if not isinstance(shots, list) or len(shots) == 0:
        raise ValueError("storyboard payload.shots must be a non-empty array")
    for index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            raise ValueError(f"storyboard payload.shots[{index}] must be an object")
        if not isinstance(shot.get("prompt"), str) or not shot["prompt"].strip():
            raise ValueError(f"storyboard payload.shots[{index}].prompt must be a non-empty string")
        source_refs = shot.get("source_refs")
        if not isinstance(source_refs, list) or not all(isinstance(value, int) for value in source_refs):
            raise ValueError(f"storyboard payload.shots[{index}].source_refs must be an integer array")
    return payload


def locate_episode(episodes: list[dict[str, Any]], episode_id: str) -> dict[str, Any]:
    normalized = episode_id.lower().replace("_", "")
    for episode in episodes:
        raw_id = str(episode.get("episode_id", "")).lower().replace("_", "")
        if raw_id == normalized:
            return episode
        number = episode.get("episode")
        if isinstance(number, int) and f"ep{number:03d}" == normalized:
            return episode
    raise ValueError(f"episode not found in script.json: {episode_id}")


def apply_storyboard_result(project_dir: Path, payload: dict[str, Any], finalize_stage: bool = False) -> dict[str, Any]:
    script_path = project_dir / "output" / "script.json"
    if not script_path.exists():
        raise FileNotFoundError(f"script.json not found: {script_path}")

    script_data = json.loads(script_path.read_text(encoding="utf-8"))
    if not isinstance(script_data, dict) or not isinstance(script_data.get("episodes"), list):
        raise ValueError("script.json must contain an episodes array")

    episode = locate_episode(script_data["episodes"], payload["episode_id"])
    scenes = episode.get("scenes")
    if not isinstance(scenes, list):
        raise ValueError("episode.scenes must be an array")

    target_scene = next((scene for scene in scenes if scene.get("scene_id") == payload["scene_id"]), None)
    if not isinstance(target_scene, dict):
        raise ValueError(f"scene not found in script.json: {payload['scene_id']}")

    draft_path = project_dir / "output" / "storyboard" / "draft" / f"{payload['episode_id']}_storyboard.json"
    draft_path.parent.mkdir(parents=True, exist_ok=True)
    if draft_path.exists():
        draft_data = json.loads(draft_path.read_text(encoding="utf-8"))
        if not isinstance(draft_data, dict):
            raise ValueError(f"draft storyboard must be a JSON object: {draft_path}")
        draft_data.setdefault("episode_id", payload["episode_id"])
        draft_data.setdefault("status", "draft")
        draft_data.setdefault("scenes", [])
    else:
        draft_data = {
            "episode_id": payload["episode_id"],
            "status": "draft",
            "scenes": [],
        }

    scene_payload = {
        "scene_id": payload["scene_id"],
        "shots": payload["shots"],
    }
    scenes_out = [scene for scene in draft_data.get("scenes", []) if scene.get("scene_id") != payload["scene_id"]]
    scenes_out.append(scene_payload)
    draft_data["scenes"] = scenes_out
    draft_data["status"] = "draft"
    draft_path.write_text(json.dumps(draft_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    draft_rel = draft_path.relative_to(project_dir).as_posix()
    ensure_state(str(project_dir))
    update_artifact(str(project_dir), draft_rel, "source", "director", "draft")
    update_stage(
        str(project_dir),
        "STORYBOARD",
        "partial",
        next_action="review STORYBOARD",
        artifact=draft_rel,
    )
    update_episode(
        str(project_dir),
        payload["episode_id"],
        "storyboard",
        "draft",
        artifact=draft_rel,
    )

    if finalize_stage:
        approved_path = project_dir / "output" / "storyboard" / "approved" / f"{payload['episode_id']}_storyboard.json"
        approved_path.parent.mkdir(parents=True, exist_ok=True)
        approved_data = dict(draft_data)
        approved_data["status"] = "approved"
        approved_path.write_text(json.dumps(approved_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        approved_rel = approved_path.relative_to(project_dir).as_posix()
        update_artifact(str(project_dir), approved_rel, "source", "director", "completed")
        update_episode(
            str(project_dir),
            payload["episode_id"],
            "storyboard",
            "completed",
            artifact=approved_rel,
        )
        update_stage(
            str(project_dir),
            "STORYBOARD",
            "validated",
            next_action="enter VIDEO",
            artifact=approved_rel,
        )

    return draft_data


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply storyboard result into draft/approved storyboard artifacts")
    parser.add_argument("--project-dir", required=True, help="Project root directory")
    parser.add_argument("--input-json", required=True, help="Path to one episode-scene storyboard payload")
    parser.add_argument("--finalize-stage", action="store_true", help="Promote STORYBOARD stage to validated after apply")
    args = parser.parse_args()

    payload = load_payload(Path(args.input_json).resolve())
    result = apply_storyboard_result(Path(args.project_dir).resolve(), payload, finalize_stage=args.finalize_stage)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
