#!/usr/bin/env python3
# input: project directory plus stage/artifact/episode mutation arguments
# output: deterministic updates to workspace pipeline-state.json
# pos: shared state writer CLI used by skills and console-adjacent tooling

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STAGE_ORDER = [
    "SCRIPT",
    "VISUAL",
    "STORYBOARD",
    "VIDEO",
    "EDITING",
    "MUSIC",
    "SUBTITLE",
]

STAGE_OWNER = {
    "SCRIPT": "writer",
    "VISUAL": "visual",
    "STORYBOARD": "director",
    "VIDEO": "production",
    "EDITING": "post",
    "MUSIC": "post",
    "SUBTITLE": "post",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def default_stage(stage: str) -> dict[str, Any]:
    return {
        "status": "not_started",
        "updated_at": None,
        "artifacts": [],
        "notes": None,
        "owner_role": STAGE_OWNER.get(stage, "producer"),
        "revision": 0,
        "locked": False,
    }


def default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "updated_at": now_iso(),
        "current_stage": "SCRIPT",
        "next_action": "review SCRIPT",
        "last_error": None,
        "stages": {stage: default_stage(stage) for stage in STAGE_ORDER},
        "episodes": {},
        "artifacts": {},
        "change_requests": [],
    }


def state_path(project_dir: str) -> Path:
    return Path(project_dir).resolve() / "pipeline-state.json"


def load_or_init(project_dir: str) -> tuple[Path, dict[str, Any]]:
    path = state_path(project_dir)
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise SystemExit("pipeline-state.json must be a JSON object")
        data.setdefault("version", 1)
        data.setdefault("updated_at", now_iso())
        data.setdefault("current_stage", "SCRIPT")
        data.setdefault("next_action", "review SCRIPT")
        data.setdefault("last_error", None)
        data.setdefault("stages", {})
        data.setdefault("episodes", {})
        data.setdefault("artifacts", {})
        data.setdefault("change_requests", [])
        for stage in STAGE_ORDER:
            data["stages"].setdefault(stage, default_stage(stage))
        return path, data
    path.parent.mkdir(parents=True, exist_ok=True)
    return path, default_state()


def write_state(path: Path, state: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def ensure_state(project_dir: str) -> dict[str, Any]:
    path, state = load_or_init(project_dir)
    write_state(path, state)
    return state


def update_stage(
    project_dir: str,
    stage: str,
    status: str,
    *,
    next_action: str | None = None,
    artifact: str | None = None,
    note: str | None = None,
    locked: bool | None = None,
) -> dict[str, Any]:
    path, state = load_or_init(project_dir)
    ts = now_iso()
    stage_state = deepcopy(state["stages"].get(stage, default_stage(stage)))
    stage_state["status"] = status
    stage_state["updated_at"] = ts
    stage_state["owner_role"] = stage_state.get("owner_role") or STAGE_OWNER.get(stage, "producer")
    stage_state["revision"] = int(stage_state.get("revision") or 0) + 1
    if note is not None:
        stage_state["notes"] = note
    if locked is not None:
        stage_state["locked"] = locked
    if artifact:
        existing = list(stage_state.get("artifacts") or [])
        if artifact not in existing:
            existing.append(artifact)
        stage_state["artifacts"] = existing

    state["stages"][stage] = stage_state
    state["current_stage"] = stage
    state["updated_at"] = ts
    if next_action is not None:
        state["next_action"] = next_action
    write_state(path, state)
    return state


def update_artifact(
    project_dir: str,
    path_key: str,
    kind: str,
    owner_role: str,
    status: str,
    *,
    editable: bool = True,
    note: str | None = None,
) -> dict[str, Any]:
    path, state = load_or_init(project_dir)
    ts = now_iso()
    artifacts = state.setdefault("artifacts", {})
    existing = deepcopy(artifacts.get(path_key, {}))
    existing["kind"] = kind
    existing["owner_role"] = owner_role
    existing["status"] = status
    existing["editable"] = editable
    existing["revision"] = int(existing.get("revision") or 0) + 1
    existing["depends_on"] = list(existing.get("depends_on") or [])
    existing["invalidates"] = list(existing.get("invalidates") or [])
    existing["updated_at"] = ts
    if note is not None:
        existing["notes"] = note
    else:
        existing.setdefault("notes", None)
    artifacts[path_key] = existing
    state["updated_at"] = ts
    write_state(path, state)
    return state


def update_episode(
    project_dir: str,
    episode: str,
    kind: str,
    status: str,
    *,
    artifact: str | None = None,
    generated: int | None = None,
    failed: int | None = None,
) -> dict[str, Any]:
    path, state = load_or_init(project_dir)
    ts = now_iso()
    episodes = state.setdefault("episodes", {})
    episode_entry = deepcopy(episodes.get(episode, {}))
    entry: dict[str, Any] = {"status": status}
    if artifact is not None:
        entry["artifact"] = artifact
    if generated is not None:
        entry["generated"] = generated
    if failed is not None:
        entry["failed"] = failed
    episode_entry[kind] = entry
    episodes[episode] = episode_entry
    state["updated_at"] = ts
    write_state(path, state)
    return state


def ensure_cmd(args: argparse.Namespace) -> int:
    ensure_state(args.project_dir)
    return 0


def stage_cmd(args: argparse.Namespace) -> int:
    update_stage(
        args.project_dir,
        args.stage,
        args.status,
        next_action=args.next_action,
        artifact=args.artifact,
        note=args.note,
        locked=args.locked,
    )
    return 0


def artifact_cmd(args: argparse.Namespace) -> int:
    update_artifact(
        args.project_dir,
        args.path,
        args.kind,
        args.owner_role,
        args.status,
        editable=args.editable,
        note=args.note,
    )
    return 0


def episode_cmd(args: argparse.Namespace) -> int:
    update_episode(
        args.project_dir,
        args.episode,
        args.kind,
        args.status,
        artifact=args.artifact,
        generated=args.generated,
        failed=args.failed,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Update pipeline-state.json deterministically.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ensure_parser = subparsers.add_parser("ensure")
    ensure_parser.add_argument("--project-dir", required=True)
    ensure_parser.set_defaults(func=ensure_cmd)

    stage_parser = subparsers.add_parser("stage")
    stage_parser.add_argument("--project-dir", required=True)
    stage_parser.add_argument("--stage", choices=STAGE_ORDER, required=True)
    stage_parser.add_argument("--status", required=True)
    stage_parser.add_argument("--next-action")
    stage_parser.add_argument("--artifact")
    stage_parser.add_argument("--note")
    stage_parser.add_argument("--locked", action=argparse.BooleanOptionalAction, default=None)
    stage_parser.set_defaults(func=stage_cmd)

    artifact_parser = subparsers.add_parser("artifact")
    artifact_parser.add_argument("--project-dir", required=True)
    artifact_parser.add_argument("--path", required=True)
    artifact_parser.add_argument("--kind", required=True)
    artifact_parser.add_argument("--owner-role", required=True)
    artifact_parser.add_argument("--status", required=True)
    artifact_parser.add_argument("--editable", action=argparse.BooleanOptionalAction, default=True)
    artifact_parser.add_argument("--note")
    artifact_parser.set_defaults(func=artifact_cmd)

    episode_parser = subparsers.add_parser("episode")
    episode_parser.add_argument("--project-dir", required=True)
    episode_parser.add_argument("--episode", required=True)
    episode_parser.add_argument("--kind", choices=["storyboard", "video", "editing", "music", "subtitle"], required=True)
    episode_parser.add_argument("--status", required=True)
    episode_parser.add_argument("--artifact")
    episode_parser.add_argument("--generated", type=int)
    episode_parser.add_argument("--failed", type=int)
    episode_parser.set_defaults(func=episode_cmd)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
