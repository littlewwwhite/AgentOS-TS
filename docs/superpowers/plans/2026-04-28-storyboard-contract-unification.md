# Storyboard Contract Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the storyboard system to its minimum: one writer (`apply_storyboard_result`), one read-side gate (`prepare_runtime_storyboard_export`), one shared contract module they both import. Delete every other validator, every legacy fallback, and the scene-level metadata fields that no consumer actually reads.

**Architecture (target end-state, not intermediate):**

```
LLM/Manual ──┐
             ├──► apply_storyboard_result ──► storyboard JSON ──► prepare_runtime_storyboard_export ──► VIDEO
storyboard_batch ──┘         │                                              │
                             └──── both validate via ───────────────────────┘
                                  _shared/storyboard_contract.py
```

Today there are **5 validators** (path_manager, batch_generate.iter_clips, apply_storyboard_result, storyboard_batch.normalize, storyboard_batch.validate_scene_shots) and **2 writers** (apply_storyboard_result, storyboard_batch direct json.dump). After this plan: **2 validators** (one writer, one reader) sharing **1 contract module**, and **1 writer**. iter_clips becomes pure data extraction with zero re-validation because the read gate already enforces the contract upstream.

The shared contract module is **scaffolding** that enables the real reductions (single writer, dead-code deletion, metadata cleanup) — not the goal itself. Its existence is justified only because two truly orthogonal call sites (write boundary vs read boundary) need the same rules.

**Tech Stack:** Python 3, `unittest`, existing `_shared/` skill-shared layer convention.

**Task dependency graph:**

```
Task 1 (shared contract, TDD)
  ├──► Task 2 (path_manager → shared)
  │     └──► Task 3 (batch_generate iter_clips: shared + delete legacy fallbacks)
  ├──► Task 4 (apply_storyboard_result → shared)
  │     └──► Task 6 (storyboard_batch persists via apply ── SINGLE WRITER, climax of plan)
  └──► Task 5 (storyboard_batch.normalize → shared)
              └──► Task 6

Task 7 (Phase 3 investigation, read-only) ── independent, can run anytime
  └──► Task 8 (apply Phase 3 decision)

Task 9 (5ep-duchess regen) ── independent of refactor; user-decision gated
```

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `.claude/skills/_shared/storyboard_contract.py` | Single source of `validate_shot` / `validate_scene_shots` / `validate_storyboard` + constants `SHOT_ID_RE`, `DURATION_MIN`, `DURATION_MAX` + exception `StoryboardContractError` |
| Create | `.claude/skills/_shared/test_storyboard_contract.py` | Unit tests for contract module |
| Modify | `.claude/skills/video-gen/scripts/path_manager.py` | Drop local `_MINIMAL_SHOT_ID_RE` / `_validate_minimal_shots`; import from `_shared` |
| Modify | `.claude/skills/video-gen/scripts/batch_generate.py` | `iter_clips` validates via shared module; delete `clips[]` / `clip_id` fallbacks |
| Modify | `.claude/skills/storyboard/scripts/apply_storyboard_result.py` | `load_payload` calls shared `validate_shot` per shot |
| Modify | `.claude/skills/storyboard/scripts/storyboard_batch.py` | `normalize_scene_shots` / `validate_scene_shots` import shared constants & validator; `generate_all_storyboards` writes via `apply_storyboard_result` (Phase 2) |
| Modify | `.claude/skills/storyboard/scripts/test_storyboard_batch.py` | Update fixtures to assert pipeline-state sync side effects after Phase 2 |
| Modify | `.claude/skills/video-gen/scripts/test_runtime_storyboard_gate.py` | Re-target import to shared module; keep gate-coverage assertions |

**Boundary discipline:** The contract module knows nothing about `pipeline_state`, `aos-cli`, or filesystem layout. It accepts plain dicts and raises typed exceptions. Pipeline-state syncing stays inside `apply_storyboard_result`. Filesystem reads stay inside `path_manager.prepare_runtime_storyboard_export`.

---

## Tasks

### Task 1: Create shared storyboard contract module (TDD)

**Files:**
- Create: `.claude/skills/_shared/storyboard_contract.py`
- Test: `.claude/skills/_shared/test_storyboard_contract.py`

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/_shared/test_storyboard_contract.py`:

```python
#!/usr/bin/env python3
"""Tests for the single-source storyboard contract module.

Covers each branch of validate_shot / validate_scene_shots / validate_storyboard
so the five existing call sites can be collapsed onto this module without
regressing behaviour.
"""
import unittest

from storyboard_contract import (
    DURATION_MAX,
    DURATION_MIN,
    SHOT_ID_RE,
    StoryboardContractError,
    validate_scene_shots,
    validate_shot,
    validate_storyboard,
)


def _shot(idx: int = 1, **overrides) -> dict:
    base = {
        "id": f"scn_001_clip{idx:03d}",
        "duration": 5,
        "prompt": "镜头提示词 with @act_001",
    }
    base.update(overrides)
    return base


class ValidateShotTest(unittest.TestCase):
    def test_accepts_minimal_shot(self) -> None:
        validate_shot(_shot(), "shot")

    def test_rejects_non_dict(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "must be an object"):
            validate_shot([], "shot")

    def test_rejects_bad_id(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "id must match"):
            validate_shot(_shot(id="clip_001"), "shot")

    def test_rejects_missing_id(self) -> None:
        bad = _shot()
        bad.pop("id")
        with self.assertRaisesRegex(StoryboardContractError, "id must match"):
            validate_shot(bad, "shot")

    def test_rejects_duration_below_range(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, r"\[4, 15\]"):
            validate_shot(_shot(duration=3), "shot")

    def test_rejects_duration_above_range(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, r"\[4, 15\]"):
            validate_shot(_shot(duration=16), "shot")

    def test_rejects_bool_as_duration(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "duration must be int"):
            validate_shot(_shot(duration=True), "shot")

    def test_rejects_blank_prompt(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "prompt must be"):
            validate_shot(_shot(prompt="   "), "shot")

    def test_ignores_extra_runtime_fields(self) -> None:
        validate_shot(_shot(lsi={"url": "https://x"}, first_frame_url="https://y"), "shot")


class ValidateSceneShotsTest(unittest.TestCase):
    def test_accepts_sequenced_shots(self) -> None:
        validate_scene_shots([_shot(1), _shot(2), _shot(3)], "scene")

    def test_rejects_empty_list(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "shots\\[\\] missing or empty"):
            validate_scene_shots([], "scene")

    def test_rejects_out_of_sequence_clip_numbers(self) -> None:
        shots = [_shot(1), _shot(3)]
        with self.assertRaisesRegex(StoryboardContractError, "out of sequence"):
            validate_scene_shots(shots, "scene")

    def test_propagates_shot_failure(self) -> None:
        shots = [_shot(1), _shot(2, duration=2)]
        with self.assertRaisesRegex(StoryboardContractError, r"\[4, 15\]"):
            validate_scene_shots(shots, "scene")


class ValidateStoryboardTest(unittest.TestCase):
    def test_accepts_minimal_document(self) -> None:
        data = {
            "episode_id": "ep001",
            "scenes": [{"scene_id": "scn_001", "shots": [_shot(1)]}],
        }
        validate_storyboard(data, "doc")

    def test_rejects_missing_scenes(self) -> None:
        with self.assertRaisesRegex(StoryboardContractError, "scenes\\[\\] missing or empty"):
            validate_storyboard({"episode_id": "ep001"}, "doc")

    def test_rejects_blank_scene_id(self) -> None:
        data = {"episode_id": "ep001", "scenes": [{"scene_id": "  ", "shots": [_shot(1)]}]}
        with self.assertRaisesRegex(StoryboardContractError, "scene_id must"):
            validate_storyboard(data, "doc")


class ConstantsTest(unittest.TestCase):
    def test_duration_bounds(self) -> None:
        self.assertEqual(DURATION_MIN, 4)
        self.assertEqual(DURATION_MAX, 15)

    def test_shot_id_regex(self) -> None:
        self.assertIsNotNone(SHOT_ID_RE.match("scn_001_clip001"))
        self.assertIsNone(SHOT_ID_RE.match("scn_1_clip1"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/_shared
python3 -m unittest test_storyboard_contract -v
```

Expected: `ModuleNotFoundError: No module named 'storyboard_contract'`

- [ ] **Step 3: Write the contract module**

Create `.claude/skills/_shared/storyboard_contract.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/_shared
python3 -m unittest test_storyboard_contract -v
```

Expected: `Ran 17 tests` … `OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add .claude/skills/_shared/storyboard_contract.py .claude/skills/_shared/test_storyboard_contract.py
git commit -m "feat(_shared): add storyboard_contract single source of truth"
```

---

### Task 2: video-gen path_manager → shared contract

**Files:**
- Modify: `.claude/skills/video-gen/scripts/path_manager.py:13-71` (the import block + `_MINIMAL_SHOT_ID_RE` + `_validate_minimal_shots` defined earlier this session)
- Modify: `.claude/skills/video-gen/scripts/path_manager.py:309-318` (the call site inside `prepare_runtime_storyboard_export`)
- Test: `.claude/skills/video-gen/scripts/test_runtime_storyboard_gate.py` (no behaviour change; keep as integration smoke for the gate)

- [ ] **Step 1: Replace local validator with shared import**

Open `.claude/skills/video-gen/scripts/path_manager.py`. Replace lines 1–71 (imports through the closing `raise ValueError(...)` of `_validate_minimal_shots`) with:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Video Path Manager & Name Parser
Manages hierarchical path structure (ep -> scn) and video naming conventions.

Path structure:
    ${OUTPUT_ROOT}/ep001/scn001/ep001_scn001_clip001.mp4
    ${OUTPUT_ROOT}/ep001/scn001/ep001_scn001_clip001.json
    ${OUTPUT_ROOT}/ep001/scn001/ep001_scn001_clip001_002.mp4  (version 2)
"""

import json
import re
import shutil
import sys
import urllib.request
import ssl
from pathlib import Path
from typing import Optional, Dict

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from storyboard_contract import StoryboardContractError, validate_storyboard
```

- [ ] **Step 2: Replace the call site to use the shared validator**

In the same file, find the block inside `prepare_runtime_storyboard_export` that reads:

```python
    try:
        runtime_data = json.loads(runtime_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Runtime storyboard {runtime_path} is not valid JSON: {exc}") from exc
    _validate_minimal_shots(runtime_data, str(runtime_path))

    return runtime_path, source_kind
```

Replace with:

```python
    try:
        runtime_data = json.loads(runtime_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Runtime storyboard {runtime_path} is not valid JSON: {exc}"
        ) from exc
    try:
        validate_storyboard(runtime_data, str(runtime_path))
    except StoryboardContractError as exc:
        raise ValueError(
            f"{exc}. Legacy storyboard schema — regenerate via storyboard finalize gate."
        ) from exc

    return runtime_path, source_kind
```

- [ ] **Step 3: Run gate tests to verify behaviour preserved**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/video-gen/scripts
python3 -m unittest test_runtime_storyboard_gate -v
```

Expected: `Ran 8 tests` … `OK`

- [ ] **Step 4: Run full video-gen test suite for regression**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/video-gen/scripts
python3 -m unittest discover -p "test_*.py" 2>&1 | tail -3
```

Expected: `Ran 48 tests` … `OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add .claude/skills/video-gen/scripts/path_manager.py
git commit -m "refactor(video-gen): path_manager uses shared storyboard_contract"
```

---

### Task 3: video-gen batch_generate → shared contract + delete legacy fallback

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py:55-60` (imports)
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py:93-138` (`iter_clips` body)

- [ ] **Step 1: Add shared contract import**

In `.claude/skills/video-gen/scripts/batch_generate.py`, find the existing import block around line 55:

```python
from path_manager import VideoReviewPaths, prepare_runtime_storyboard_export
```

Add immediately after it (insert as a new line):

```python
from storyboard_contract import StoryboardContractError, validate_shot
```

The `_SHARED_DIR` sys.path insertion is already done by `path_manager.py` import side-effect, but to keep `batch_generate.py` self-contained add at the top with other path setup (search for the existing `_SHARED_DIR` pattern in this file or add near the imports):

```python
_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))
```

If `_SHARED_DIR` is already defined elsewhere in `batch_generate.py`, skip the duplication.

- [ ] **Step 2: Rewrite `iter_clips` to enforce minimal contract and drop legacy fallbacks**

Find the existing `iter_clips` definition (lines 93–138) and replace with:

```python
def iter_clips(data: dict) -> list:
    """Iterate generation units from a runtime storyboard.

    The runtime storyboard has already passed validate_storyboard at the
    prepare_runtime_storyboard_export boundary. This function only re-validates
    each shot to surface a clip-scoped error label and to extract the runtime
    fields (lsi etc.) that the contract module deliberately ignores.

    Required shot fields: {id, duration, prompt} per minimal contract.
    Runtime-injected fields (lsi.url, lsi.video_url) are read defensively.
    """
    result = []
    for scene in data["scenes"]:
        scene_id = scene["scene_id"]
        for shot in scene["shots"]:
            label = f"{scene_id}/{shot.get('id', '?')}"
            try:
                validate_shot(shot, label)
            except StoryboardContractError as exc:
                raise ValueError(str(exc)) from exc

            shot_id = shot["id"]
            normalized_clip_id = re.sub(r"[_\-]", "", shot_id)
            normalized_clip_id = re.sub(
                r"(scn\d+)(clip\d+)", r"\1_\2", normalized_clip_id
            )

            lsi_dict = shot.get("lsi") or {}
            result.append({
                "clip_id": normalized_clip_id,
                "scene_id": scene_id,
                "full_prompts": shot["prompt"],
                "duration_seconds": shot["duration"],
                "prompt_version": 0,
                "lsi_url": lsi_dict.get("url", "") or "",
                "lsi_video_url": lsi_dict.get("video_url", "") or "",
            })

    return result
```

Note the deletions:
- `scene.get('shots') or scene.get('clips') or []` → `scene["shots"]` (legacy `clips[]` fallback removed)
- `shot.get('id') or shot.get('clip_id')` → `shot["id"]` (legacy `clip_id` fallback removed)
- `scene_actors` and `scene_location` extraction (Task 7 will resolve their fate; they are unused by current callers per investigation in that task)
- `'actors': scene_actors,` and `'location': scene_location,` keys in the result dict (their downstream readers will be confirmed in Task 7)

⚠ If Task 7 finds `scene_actors` / `scene_location` are still consumed downstream, add them back at that task as enrichment from `script.json` rather than from storyboard — the storyboard contract should not carry them.

- [ ] **Step 3: Run iter_clips-related tests**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/video-gen/scripts
python3 -m unittest test_video_generation_scheduling test_duration_manifest test_fake_e2e_generation -v 2>&1 | tail -15
```

Expected: all tests pass. If any test fails because it stubbed `scene_actors` or `clips[]`, update the test fixture to use the minimal `{shots: [{id, duration, prompt}]}` shape.

- [ ] **Step 4: Run full video-gen test suite**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/video-gen/scripts
python3 -m unittest discover -p "test_*.py" 2>&1 | tail -3
```

Expected: `Ran 48 tests` … `OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add .claude/skills/video-gen/scripts/batch_generate.py
git commit -m "refactor(video-gen): iter_clips uses shared contract; drop legacy clips[] fallback"
```

---

### Task 4: storyboard apply_storyboard_result.load_payload → shared contract

**Files:**
- Modify: `.claude/skills/storyboard/scripts/apply_storyboard_result.py:7-46` (imports + `load_payload`)

- [ ] **Step 1: Add shared contract import**

In `.claude/skills/storyboard/scripts/apply_storyboard_result.py`, find the existing import block (around lines 6–20) which already does `sys.path.insert(0, str(REPO_ROOT / "scripts"))`. Add the `_SHARED_DIR` insertion after the existing `REPO_ROOT` block:

```python
REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from pipeline_state import ensure_state, update_artifact, update_episode, update_stage
from storyboard_contract import (
    StoryboardContractError,
    validate_shot,
)
```

- [ ] **Step 2: Replace the per-shot validation in `load_payload`**

Find the existing `load_payload` function (lines 23–46). Replace its body with:

```python
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
        try:
            validate_shot(shot, f"storyboard payload.shots[{index}]")
        except StoryboardContractError as exc:
            raise ValueError(str(exc)) from exc
    return payload
```

Note: this preserves the single-scene wrapper checks (`episode_id` + `scene_id` at top level) that are local to this entry path and not part of the document-wide contract. The shot-shape rules are now in one place.

- [ ] **Step 3: Run apply_storyboard_result tests**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/storyboard/scripts
python3 -m unittest test_pipeline_state_bridge -v 2>&1 | tail -10
```

Expected: all bridge tests pass with no behaviour change.

- [ ] **Step 4: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add .claude/skills/storyboard/scripts/apply_storyboard_result.py
git commit -m "refactor(storyboard): apply_storyboard_result uses shared contract"
```

---

### Task 5: storyboard_batch normalize/validate → shared contract

**Files:**
- Modify: `.claude/skills/storyboard/scripts/storyboard_batch.py:25-35` (imports + `_SHARED_DIR`)
- Modify: `.claude/skills/storyboard/scripts/storyboard_batch.py:170-235` (delete `_SHOT_ID_RE`, `_DURATION_MIN`, `_DURATION_MAX`; rewrite `normalize_scene_shots` and `validate_scene_shots`)

- [ ] **Step 1: Add shared contract import alongside aos_cli_model**

In `.claude/skills/storyboard/scripts/storyboard_batch.py`, find the existing `_SHARED_DIR` block (around lines 28–33). After the `from aos_cli_model import aos_cli_model_run` line, append:

```python
from storyboard_contract import (
    DURATION_MAX,
    DURATION_MIN,
    SHOT_ID_RE,
    StoryboardContractError,
    validate_scene_shots as _contract_validate_scene_shots,
    validate_shot,
)
```

The local `validate_scene_shots` is renamed on import to free the name for the existing wrapper that returns a `(bool, str)` tuple expected by callers.

- [ ] **Step 2: Delete the duplicated constants near line 170**

Find and delete these lines (they are now provided by the shared module):

```python
_SHOT_ID_RE = re.compile(r"^scn_(\d{3})_clip(\d{3})$")
_DURATION_MIN = 4
_DURATION_MAX = 15
```

(The exact line numbers may shift after Task 4; search for `_SHOT_ID_RE` to locate.)

- [ ] **Step 3: Rewrite `normalize_scene_shots`**

Replace the existing `normalize_scene_shots` (around lines 178–214) with:

```python
def normalize_scene_shots(raw_output, scene: dict | None = None) -> list[dict]:
    """Coerce LLM output into a clean [{id, duration, prompt}] list.

    Accepts a list of dicts (canonical) or a single dict; rejects anything else.
    Strips unknown fields; backfills `id` from scene_id + ordinal when missing.
    Final structural validation is delegated to storyboard_contract.validate_shot.
    """
    if isinstance(raw_output, dict):
        raw_items = raw_output.get("shots", [raw_output])
    elif isinstance(raw_output, list):
        raw_items = raw_output
    else:
        raise ValueError(
            f"storyboard output must be a JSON array; got {type(raw_output).__name__}"
        )

    scene_id_raw = (scene or {}).get("scene_id", "")
    m = re.match(r"scn_?(\d+)", str(scene_id_raw))
    scene_num = f"{int(m.group(1)):03d}" if m else "000"

    normalized = []
    for index, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            raise ValueError(
                f"shot[{index - 1}] must be an object, got {type(item).__name__}"
            )
        candidate = {
            "id": item.get("id") or f"scn_{scene_num}_clip{index:03d}",
            "duration": item.get("duration"),
            "prompt": item.get("prompt"),
        }
        try:
            validate_shot(candidate, f"shot[{index - 1}]")
        except StoryboardContractError as exc:
            raise ValueError(str(exc)) from exc
        normalized.append(candidate)

    return normalized
```

- [ ] **Step 4: Rewrite the wrapper `validate_scene_shots`**

Replace the existing `validate_scene_shots` (around lines 217–234) with:

```python
def validate_scene_shots(shots: list[dict], scene: dict | None) -> tuple[bool, str]:
    """Final post-normalization check returning a (ok, message) tuple.

    Delegates structural rules (id format, duration range, sequence) to
    storyboard_contract.validate_scene_shots; this wrapper preserves the
    legacy tuple-return signature used by generate_all_storyboards logging.
    """
    label = f"scene({(scene or {}).get('scene_id', '?')})"
    try:
        _contract_validate_scene_shots(shots, label)
    except StoryboardContractError as exc:
        return False, str(exc)
    total = sum(sh["duration"] for sh in shots)
    return True, f"shots={len(shots)} total_duration={total}s"
```

- [ ] **Step 5: Run storyboard_batch tests**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/storyboard/scripts
python3 -m unittest test_storyboard_batch -v 2>&1 | tail -15
```

Expected: all tests pass. If a test asserts the exact text of an error message that has changed (e.g. "duration=3 out of range" → "duration must be int in [4, 15] (got 3)"), update the test assertion to match the new wording.

- [ ] **Step 6: Run full storyboard test suite**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/storyboard/scripts
python3 -m unittest discover -p "test_*.py" 2>&1 | tail -3
```

Expected: `Ran 23 tests` … `OK`

- [ ] **Step 7: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add .claude/skills/storyboard/scripts/storyboard_batch.py .claude/skills/storyboard/scripts/test_storyboard_batch.py
git commit -m "refactor(storyboard): storyboard_batch uses shared contract"
```

---

### Task 6: storyboard_batch writes via apply_storyboard_result (Phase 2)

**Files:**
- Modify: `.claude/skills/storyboard/scripts/storyboard_batch.py:327-410` (`generate_all_storyboards` write block — currently lines 385-409 do the direct `json.dump`)
- Modify: `.claude/skills/storyboard/scripts/test_storyboard_batch.py` (test that asserts pipeline-state side effect after the change)

- [ ] **Step 1: Import apply_storyboard_result**

At the top of `storyboard_batch.py`, after the contract import block from Task 5, add:

```python
from apply_storyboard_result import apply_storyboard_result
```

This works because `apply_storyboard_result.py` is in the same `scripts/` directory and already importable.

- [ ] **Step 2: Replace the direct json.dump block**

Find the block in `generate_all_storyboards` that currently writes drafts directly (around lines 385–409, looking for `draft_root = output_dir / "storyboard" / "draft"` and the subsequent `json.dump`). Replace it with per-scene calls to `apply_storyboard_result`:

```python
        for ep in episodes:
            ep_id = ep.get("episode_id") or ep.get("ep_id", "unknown")
            for scene in ep.get("scenes", []):
                scene_id = scene.get("scene_id", "unknown")
                shots = storyboards.get((ep_id, scene_id), [])
                if not shots:
                    continue
                payload = {
                    "episode_id": ep_id,
                    "scene_id": scene_id,
                    "shots": shots,
                }
                apply_storyboard_result(project_dir, payload, finalize_stage=False)
                print(f"  -> wrote {ep_id}/{scene_id} via apply_storyboard_result")
```

This deletes the `draft_root.mkdir`, the manual `json.dump`, and the `with open(...)` block. Pipeline-state sync now happens once per scene inside `apply_storyboard_result`.

- [ ] **Step 3: Update the storyboard_batch test that asserts draft side effects**

Open `.claude/skills/storyboard/scripts/test_storyboard_batch.py` and find any test (e.g. `test_writes_draft_without_mutating_script`) that asserts on the draft file contents or the absence of `pipeline-state.json`. Adjust:

```python
    # After:
    state_path = project_dir / "pipeline-state.json"
    self.assertTrue(state_path.exists(), "apply_storyboard_result must sync pipeline-state")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    self.assertIn("STORYBOARD", state["stages"])
    self.assertEqual(state["stages"]["STORYBOARD"]["status"], "partial")
```

If the test previously asserted "no pipeline-state side effect," that assertion is now wrong — invert it. If it asserted that the draft has shape `{episode_id, status: "draft", scenes: [...]}`, that shape is preserved by `apply_storyboard_result` (it writes the same envelope).

- [ ] **Step 4: Run storyboard test suite**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/.claude/skills/storyboard/scripts
python3 -m unittest discover -p "test_*.py" 2>&1 | tail -3
```

Expected: `Ran 23 tests` … `OK` (test count may rise if Task 6 adds an assertion in a new method).

- [ ] **Step 5: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add .claude/skills/storyboard/scripts/storyboard_batch.py .claude/skills/storyboard/scripts/test_storyboard_batch.py
git commit -m "refactor(storyboard): storyboard_batch persists drafts via apply_storyboard_result"
```

---

### Task 7: Investigate scene-level metadata usage at the VIDEO boundary (Phase 3)

**Files:**
- Read-only investigation. Output is a decision recorded inline in this plan and applied in Task 8.

- [ ] **Step 1: Grep all consumers of scene-level actors/locations/props**

Run these from the repo root and capture results:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
grep -rn "scene\.get(['\"]actors['\"])\|scene_actors\|scene\.get(['\"]locations['\"])\|scene_location\|scene\.get(['\"]props['\"])" \
  .claude/skills/video-gen/scripts/ \
  .claude/skills/storyboard/scripts/ 2>/dev/null
```

Expected: identify every consumer of these scene-level fields after the Task 3 deletions in `iter_clips`.

- [ ] **Step 2: Grep callers of `clip['actors']` / `clip['location']` from the iter_clips output**

```bash
grep -rn "clip\[['\"]actors['\"]\]\|clip\.get(['\"]actors['\"])\|clip\[['\"]location['\"]\]\|clip\.get(['\"]location['\"])" \
  .claude/skills/video-gen/scripts/ 2>/dev/null
```

Expected: confirm whether any downstream of `iter_clips` reads these keys after Task 3 removed them from the output dict.

- [ ] **Step 3: Document the decision in this plan**

Edit `docs/superpowers/plans/2026-04-28-storyboard-contract-unification.md` (this file). Add a `Task 7 finding:` block under this task with one of:

```markdown
**Task 7 finding (DELETE):** No consumer of scene_actors / scene_location after iter_clips. Remove all references; storyboard contract stays minimal.
```

OR

```markdown
**Task 7 finding (KEEP via script.json enrich):** `<consumer>` at `<path>:<line>` reads `clip['actors']`. These will be enriched at the VIDEO boundary by joining `iter_clips` output with `script.json` episode/scene data. Storyboard JSON itself stays minimal.
```

OR

```markdown
**Task 7 finding (KEEP in storyboard):** Strong reason `<reason>` to carry these in storyboard. Add to STORYBOARD_SCHEMA.md as a documented optional extension and update validate_scene to tolerate them.
```

- [ ] **Step 4: Commit the documented finding**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add docs/superpowers/plans/2026-04-28-storyboard-contract-unification.md
git commit -m "docs(plan): record Task 7 scene-metadata investigation outcome"
```

---

### Task 8: Apply the Phase 3 decision

This task's steps depend on the Task 7 outcome. Three branches; execute exactly one.

- [ ] **Branch A — DELETE (most likely):** No follow-up code change needed beyond the deletions already in Task 3. Verify by running:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
python3 -m unittest discover -s .claude/skills/video-gen/scripts -p "test_*.py" 2>&1 | tail -3
python3 -m unittest discover -s .claude/skills/storyboard/scripts -p "test_*.py" 2>&1 | tail -3
python3 -m unittest discover -s .claude/skills/_shared -p "test_*.py" 2>&1 | tail -3
```

Expected: all three suites green. No additional commit; close the task.

- [ ] **Branch B — KEEP via script.json enrich:** Modify `.claude/skills/video-gen/scripts/batch_generate.py:run_batch_generate` (around the `iter_clips` call site) to pass `script.json` data and enrich each clip dict before downstream use:

```python
def _enrich_with_script_metadata(clips: list, script_data: dict, episode_id: str) -> list:
    """Join iter_clips output with script.json scene-level actors/locations.

    storyboard JSON itself is the minimal {id, duration, prompt} contract;
    actors/locations belong in script.json (the long-half-life domain model)
    and are enriched here at the VIDEO boundary, not at the storyboard layer.
    """
    episode = next(
        (e for e in script_data.get("episodes", [])
         if str(e.get("episode_id", "")).lower().replace("_", "")
            == episode_id.lower().replace("_", "")),
        None,
    )
    if not episode:
        return clips
    by_scene = {
        s["scene_id"]: s for s in episode.get("scenes", []) or []
        if isinstance(s, dict) and s.get("scene_id")
    }
    for clip in clips:
        scene = by_scene.get(clip["scene_id"])
        if not scene:
            continue
        clip["actors"] = [a["actor_id"] for a in scene.get("actors") or [] if a.get("actor_id")]
        locs = scene.get("locations") or []
        clip["location"] = locs[0]["location_id"] if locs and locs[0].get("location_id") else ""
    return clips
```

Wire the call after `clips = iter_clips(data)`. Add a unit test for the enrichment.

- [ ] **Branch C — KEEP in storyboard:** Update `.claude/skills/_shared/storyboard_contract.py` to tolerate optional `actors[]` / `locations[]` / `props[]` at the scene level (no validation other than "is list of dicts"). Update `.claude/skills/video-gen/references/STORYBOARD_SCHEMA.md` and `.claude/skills/video-gen/references/SHOT_VALIDATION_RULES.md` to document them as optional extensions. Add tests for the optional shape.

- [ ] **Step (any branch): Run all three test suites and commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
python3 -m unittest discover -s .claude/skills/_shared -p "test_*.py" 2>&1 | tail -3
python3 -m unittest discover -s .claude/skills/storyboard/scripts -p "test_*.py" 2>&1 | tail -3
python3 -m unittest discover -s .claude/skills/video-gen/scripts -p "test_*.py" 2>&1 | tail -3
git add -A
git commit -m "refactor(storyboard): apply Phase 3 decision per Task 7 finding"
```

---

### Task 9: Restore 5ep-duchess/ep001 to its original 5×15s intent (USER DECISION)

**Context:** During emergency triage this session the legacy `output/storyboard/approved/ep001_storyboard.json` was rewritten by mechanically splitting each of 4 PARTs into 5 S-blocks → 20 shots × duration=4. The original prompt intent was "5 段 × 3s = 15s 长镜头" with all 5 beats inside one shot — the video model natively supports multi-beat single-shot prompts (per `feedback_video_model_multibeat_prompt` memory). Keeping the 20×4s split would freeze the wrong precedent into the rebuilt contract.

This task is **independent of Tasks 1–8** and is gated on user choice. Do NOT execute without the user explicitly choosing branch A or B.

- [ ] **Step 1: User chooses branch**

  - **Branch A — Keep current 20×4s shape, defer regen.** No code change. Add a note to `workspace/5ep-duchess/output/storyboard/approved/.regen-deferred.md` recording that the original 4×15s intent was sacrificed for triage and should be regenerated when next touching ep001.
  - **Branch B — Regenerate now to 4 shots × 15s with 5-beat prompts.** Execute Steps 2–5 below.

- [ ] **Step 2 (Branch B only): Restore from backup and regenerate via storyboard skill**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/workspace/5ep-duchess
cp output/storyboard/approved/ep001_storyboard.json.pre_minimal_split.bak \
   draft/storyboard/legacy_ep001_pre_split.json   # archive copy
# Then re-run storyboard skill or manually author 4 shots × duration=15 with embedded multi-beat prompts.
```

For each of the 4 original PARTs, the new shot is one entry of:

```json
{
  "id": "scn_001_clipNNN",
  "duration": 15,
  "prompt": "[0-3] <S1 beat> | [3-6] <S2 beat> | [6-9] <S3 beat> | [9-12] <S4 beat> | [12-15] <S5 beat>"
}
```

The `[t-t]` time markers stay inside the prompt — that's where the model expects multi-beat structure. The earlier session already extracted the per-S-block content; lift those texts directly.

- [ ] **Step 3 (Branch B): Validate via the read gate**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
python3 -c "
import sys
sys.path.insert(0, '.claude/skills/_shared')
sys.path.insert(0, '.claude/skills/video-gen/scripts')
from path_manager import prepare_runtime_storyboard_export
import tempfile, shutil
runtime, kind = prepare_runtime_storyboard_export(
    requested_storyboard_path='workspace/5ep-duchess/output/storyboard/approved/ep001_storyboard.json',
    output_root='workspace/5ep-duchess/output/ep001',
    episode=1,
)
print('OK', kind, runtime)
"
```

Expected: `OK approved …/ep001_storyboard.json`

- [ ] **Step 4 (Branch B): Sample one shot through video-gen dry-run** (optional but recommended before consuming Ark quota)

Use the existing `test_fake_e2e_generation` fixture pattern or a single-shot Ark call to verify the 15s multi-beat prompt produces a coherent video.

- [ ] **Step 5: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add workspace/5ep-duchess/
git commit -m "fix(5ep-duchess): restore ep001 to 4 shots × 15s multi-beat (was triage 20×4s)"
```

---

## Self-Review Checklist (run after writing, fix inline if needed)

- ✅ **Spec coverage:** Scaffolding in Tasks 1–5; structural climax (single writer + dead-code deletion) in Tasks 3 & 6; metadata cleanup in Tasks 7–8; 5ep-duchess restoration (user-gated) in Task 9.
- ✅ **No placeholders:** Every code block is concrete; no "TBD" / "implement later". Task 8 has explicit branches A/B/C with full code for each.
- ✅ **Type consistency:** `validate_shot` / `validate_scene_shots` / `validate_storyboard` names and signatures stable across all tasks. `StoryboardContractError` consistently caught and re-raised as `ValueError` at boundaries that historically raised `ValueError`.
- ✅ **TDD:** Task 1 writes tests before module. Tasks 2–6 lean on existing test suites (already covering behaviour) and update fixtures only when string match shifts.
- ✅ **Granularity:** Each task is 5–15 minutes of work and produces one focused commit. Task 6 (single writer) is the largest at ~20 min because it touches both producer and test fixture.
- ✅ **DRY:** Eliminating 5 validators → 2 + 1 shared module is the whole point.
- ✅ **YAGNI:** No speculative features. Task 7 investigates before Task 8 acts. Task 9 is gated on explicit user choice.
- ✅ **Hierarchy clarity:** The Architecture section names Tasks 1–5 as "scaffolding" and Tasks 3, 6, 8 as the actual structural wins — preventing future readers from mistaking shared-module extraction as the goal.

---

## Engineering Philosophy Mapping

| User principle | Where it shows up in this plan |
|---|---|
| 拒绝补丁式规则堆砌 | The plan is structured to **eliminate** the patches (5 validators → 2; 2 writers → 1; iter_clips defensive layer → deleted), not just consolidate them. Task 1's shared module is the smallest abstraction needed; without Tasks 3, 6, 8 it would itself be a patch. |
| 正交性是架构核心 | After Task 6, write-side validation and read-side gate are the two genuinely orthogonal concerns sharing one contract. Today's 5 validators conflate them. |
| 半衰期意识 | `storyboard_contract.py` (long half-life: encodes the video-model interface) lives in `_shared/`; call-site error-message wrapping (short half-life) stays at boundaries. The contract module deliberately does NOT know about pipeline_state, filesystem, or aos-cli. |
| Occam 剃刀 | A single Python module — no new directory, no class hierarchy, no plugin system. Module is created only because 2 truly independent call sites need identical rules. If Phase 2 collapsed writers to 1 AND we tolerated the read gate as the sole validator, the module wouldn't exist. We need it because read and write are different boundaries with the same contract. |
| 贝叶斯更新 | Task 7 grep-investigates before Task 8 decides. The prior assumption "scene-level actors/locations are needed" is treated as a current belief to update, not a fact. |
| 反复迭代仍不满意时回到起点 | This plan exists because the prior "add a read gate" round suppressed the symptom but left the underlying duplication. We returned to the structural question rather than continuing to polish gates. |
| YAGNI | No "validate_episode" / "validate_project" abstractions. No plugin contracts. The module exposes exactly what 2 call sites need today. |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-storyboard-contract-unification.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session with checkpoints between commits.

Which approach?
