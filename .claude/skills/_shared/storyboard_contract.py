#!/usr/bin/env python3
"""Single source of truth for the minimal storyboard shot contract.

Contract: each shot has exactly the structural fields {id, duration, prompt}.
- id matches ^scn_\\d{3}_clip\\d{3}$
- duration is int in [DURATION_MIN, DURATION_MAX]
- prompt is non-empty string after strip()

Runtime-only fields (lsi, first_frame_url, last_frame_url) are tolerated —
batch_generate injects them and they are not part of the canonical contract.

Used by:
  storyboard skill: apply_storyboard_result, storyboard_batch
  video-gen skill : path_manager, batch_generate
"""
from __future__ import annotations

import re
from typing import Any

DURATION_MIN = 4
DURATION_MAX = 15
SHOT_ID_RE = re.compile(r"^scn_(\d{3})_clip(\d{3})$")


class StoryboardContractError(ValueError):
    """Raised when a shot or storyboard violates the minimal-schema contract."""


def validate_shot(shot: Any, label: str) -> None:
    if not isinstance(shot, dict):
        raise StoryboardContractError(
            f"{label}: must be an object, got {type(shot).__name__}"
        )
    sid = shot.get("id")
    if not isinstance(sid, str) or not SHOT_ID_RE.match(sid):
        raise StoryboardContractError(
            f"{label}.id must match ^scn_\\d{{3}}_clip\\d{{3}}$ (got {sid!r})"
        )
    duration = shot.get("duration")
    if (
        not isinstance(duration, int)
        or isinstance(duration, bool)
        or duration < DURATION_MIN
        or duration > DURATION_MAX
    ):
        raise StoryboardContractError(
            f"{label}.duration must be int in [{DURATION_MIN}, {DURATION_MAX}] "
            f"(got {duration!r})"
        )
    prompt = shot.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise StoryboardContractError(f"{label}.prompt must be a non-empty string")


def validate_scene_shots(shots: Any, label: str) -> None:
    if not isinstance(shots, list) or not shots:
        raise StoryboardContractError(f"{label}.shots[] missing or empty")
    expected = 1
    for index, shot in enumerate(shots):
        validate_shot(shot, f"{label}.shots[{index}]")
        m = SHOT_ID_RE.match(shot["id"])
        clip_num = int(m.group(2))
        if clip_num != expected:
            raise StoryboardContractError(
                f"{label}.shots[{index}].id={shot['id']!r} out of sequence; "
                f"expected clip{expected:03d}"
            )
        expected += 1


def validate_storyboard(data: Any, label: str) -> None:
    if not isinstance(data, dict):
        raise StoryboardContractError(f"{label} must be an object")
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise StoryboardContractError(f"{label}.scenes[] missing or empty")
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            raise StoryboardContractError(
                f"{label}.scenes[{index}] must be an object"
            )
        scene_id = scene.get("scene_id")
        if not isinstance(scene_id, str) or not scene_id.strip():
            raise StoryboardContractError(
                f"{label}.scenes[{index}].scene_id must be a non-empty string"
            )
        validate_scene_shots(
            scene.get("shots"),
            f"{label}.scenes[{index}]({scene_id})",
        )
