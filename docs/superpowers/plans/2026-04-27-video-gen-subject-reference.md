# Video-Gen Subject Reference Activation Plan (v2, post-gnhf-merge)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the producer→consumer gap on subject references. The `storyboard` skill (v1.4.0, commit `caa9607`) emits `@act_xxx` / `@loc_xxx` / `@prop_xxx` tokens. The `video-gen` consumer must (a) extract those tokens including the new `@`-form and `prop_*` namespace, (b) rewrite the prompt sent to Ark from `@act_001 …` to `[图1] …` so Ark binds each reference image by 1-based index in `content[]`, and (c) inject the resolved image URLs into `intent.reference_images` so `request_compiler` forwards them through the aos-cli `video.generate` capability into `ArkVideoProvider.build_ark_video_task_body`.

**Architecture:** Add a pure `subject_resolver` module to `video-gen` that owns token extraction + image lookup + `[图N]` prompt rewriting in one place. Wire it into `batch_generate.iter_clips` (or the preprocessing block at line ~673) so `ClipIntent.prompt_text` and `ClipIntent.reference_images` carry the rewritten prompt + ordered image dicts before reaching `request_compiler`. `request_compiler` is unchanged — it already accepts `intent.reference_images` and merges the lsi continuity frame correctly. `video_api` and `config.json` are unchanged — gnhf #40 already finished those layers. `_shared/AOS_CLI_MODEL.md` gains a documented `referenceImages[]` / `referenceVideos[]` block under the `video.generate` capability example.

**Tech Stack:** Python 3.11+, `pytest` for unit tests; existing `_shared/aos_cli_envelope`, `aos_cli_model_submit`, `ArkVideoProvider`. No new runtime deps.

---

## What gnhf P4 Already Did (Do Not Redo)

The following items were in the v1 plan but are already shipped in master:

- `video_api.submit_video` no longer takes `subjects=` and no longer raises `RuntimeError("subject references are not supported …")` (gnhf #40)
- `request_compiler.compile_request` no longer forks on `use_subject_reference`; it unconditionally builds `reference_images` plus the lsi continuity frame
- `config.json` no longer has `seedance2.subject_reference` (and no longer has `provider` / `model_group_code` / `providers[]`); the boundary owns provider routing
- `get_subject_reference_for_model`, `get_provider_for_model`, `build_subject_prompt_params`, `build_image_reference_params`, `map_subject_ids_to_elements`, and the legacy `subjects[]` clip-state field are deleted
- `batch_generate_runtime.py` no longer imports the dropped helpers

**Remaining work is strictly the producer→consumer wire-up that was never present, plus one doc gap.**

---

## Audit Findings (Verified Post-Merge)

- **Producer (storyboard skill, shipped):** `SKILL.md` v1.4.0 + `prompts/storyboard_system.txt` enforce `@act_xxx` / `@loc_xxx` / `@prop_xxx`; static appearance forbidden. Outer envelope `[{ source_refs, prompt }]` carries the markdown.
- **Consumer gap 1 (regex):** `.claude/skills/video-gen/scripts/batch_generate.py:172` `_SUBJECT_ID_PATTERN = re.compile(r'\{((?:act|loc)_\d+)\}')` — does not match `@act_xxx`, does not include `prop_xxx`. Result: `extract_subject_ids` returns `[]` for every storyboard written by the new skill, so `map_subject_ids_to_images` returns `[]`, so `ClipIntent.reference_images` arrives at `request_compiler` empty.
- **Consumer gap 2 (prompt passthrough):** Even if regex matched, no current code rewrites `@act_001 → [图1]`. Ark's multi-image binding requires `[图N]` markers in the prompt that index into `content[]` order — without rewriting, Ark treats `@act_001` as plain text and ignores the corresponding reference image entirely.
- **Consumer gap 3 (legacy `convert_prompt_brackets`):** `batch_generate.py:197` still rewrites `【xxx】 / 【xxx（yyy）】 → {base_name}`. This is a different (older) pre-storyboard-v1.4 format. Keep it for back-compat but do not let it shadow the new resolver.
- **Boundary status (verified):** `aos-cli/src/aos_cli/model/providers/ark_video.py:30-55` accepts `options.referenceImages` and builds Ark `content[]` with `image_url` entries. `video_api.submit_video_generation` at `.claude/skills/video-gen/scripts/video_api.py` (current shape) writes `input.referenceImages = [...]`. **No protocol extension required.**
- **Docs gap:** `.claude/skills/_shared/AOS_CLI_MODEL.md:117-132` Video submit example only documents `{prompt, duration, ratio, quality}`. Real wire shape supports `referenceImages[]` and `referenceVideos[]`.
- **Asset shape (unchanged):** `actors.json` entries have nested state keys (`default`, `中药`, …) each containing `subject_id` + `face_view_url` / `side_view_url` / `back_view_url` / `three_view_url`. Locations/props have flat `image_url` at top level. The existing `load_assets_subject_mapping` in `batch_generate.py:395-460` already handles both shapes correctly — we keep that loader and only swap the regex + add the rewrite step.

---

## File Map

- **New:** `.claude/skills/video-gen/scripts/subject_resolver.py`
  - Pure module: token regex (handles `@`-form + legacy `{...}`-form, supports `act` / `loc` / `prop`), prompt rewriter to `[图N]`, ordered URL list builder.
- **New:** `.claude/skills/video-gen/scripts/test_subject_resolver.py`
  - Unit tests for token extraction, deduplication, prompt rewriting, missing-token soft-fail, mixed @ + legacy form.
- **Modify:** `.claude/skills/video-gen/scripts/batch_generate.py`
  - Replace `_SUBJECT_ID_PATTERN` to also match `@(act|loc|prop)_\d+` (back-compat with `{...}`).
  - In the clip preprocessing block (~line 673), call `resolve_subject_tokens(prompt, …)` to get rewritten `prompt` + ordered `reference_images`. Replace today's `extract_subject_ids` + `map_subject_ids_to_images` two-step with the single resolver call. Keep `convert_prompt_brackets` for the older `【】` form (run it after the resolver so `@`-tokens are already gone).
  - Update the dry-run branch (~line 658) symmetrically.
  - Update doc strings/log lines that reference `{act_xxx}` placeholder mode.
- **Modify:** `.claude/skills/_shared/AOS_CLI_MODEL.md`
  - Extend `video.generate` example with `referenceImages[]` / `referenceVideos[]` (additive — implementation already supports this).
- **Modify:** `.claude/skills/video-gen/SKILL.md`
  - One-paragraph addendum documenting `@token → [图N]` consumption contract and pointing at `subject_resolver.py`.

**Not touched (intentional):**
- `request_compiler.py` — already passes `intent.reference_images` through and merges the continuity frame; no change needed
- `video_api.py` — already removed by gnhf #40
- `config.json` — already simplified by gnhf #40
- `production_types.ClipIntent` — `subjects: list = []` field was kept by gnhf #40 as a vestigial empty list; ignore it (do not remove in this plan to keep diff focused)

---

## Parallelization Decision

All edits land in two adjacent modules (`subject_resolver.py` + `batch_generate.py`) plus two doc files. Tasks 1 and 2 are tightly coupled (the test suite for the resolver locks behavior the consumer relies on). Tasks 3 and 4 are leaf docs.

**Recommendation:** Single agent, sequential. Do not dispatch subagents. Total expected diff: ~250 lines added, ~30 lines deleted/replaced.

---

## Canonical Marker

**Plan canonical id:** `video-gen-subject-reference-2026-04-27-v2`. All commits MUST reference this id in trailer, e.g. `Plan-Id: video-gen-subject-reference-2026-04-27-v2`.

---

### Task 1: Add `subject_resolver` pure module + unit tests

**Files:**
- New: `.claude/skills/video-gen/scripts/subject_resolver.py`
- New: `.claude/skills/video-gen/scripts/test_subject_resolver.py`

- [ ] **Step 1: Write the failing unit test**

Create `test_subject_resolver.py`:

```python
import pytest
from subject_resolver import extract_subject_tokens, resolve_subject_tokens


def test_extracts_at_form_act_loc_prop_in_order():
    prompt = "@act_001 走入 @loc_002，望向 @prop_003"
    assert extract_subject_tokens(prompt) == ["act_001", "loc_002", "prop_003"]


def test_extracts_legacy_brace_form():
    prompt = "{act_001} 走入 {loc_002}"
    assert extract_subject_tokens(prompt) == ["act_001", "loc_002"]


def test_dedupes_repeated_tokens_preserving_first_occurrence():
    prompt = "@act_001 转向 @act_002，@act_001 抬手"
    assert extract_subject_tokens(prompt) == ["act_001", "act_002"]


def test_resolves_to_ordered_image_dicts_and_rewrites_prompt():
    actors = {"act_001": {"default": {"face_view_url": "https://x/a.png", "subject_id": "s1"}}}
    locations = {"loc_002": {"image_url": "https://x/l.png", "subject_id": "s2", "name": "诛仙台"}}
    rewritten, refs = resolve_subject_tokens(
        "@act_001 走入 @loc_002",
        actors=actors, locations=locations, props={},
    )
    assert rewritten == "[图1] 走入 [图2]"
    assert [r["url"] for r in refs] == ["https://x/a.png", "https://x/l.png"]
    # Refs should carry name+display_name+subject_id for downstream logging parity
    assert refs[0]["name"] == "act_001"
    assert refs[1]["display_name"] == "诛仙台"


def test_missing_token_keeps_raw_token_and_skips_url():
    rewritten, refs = resolve_subject_tokens(
        "@act_001 与 @act_999 对话",
        actors={"act_001": {"default": {"face_view_url": "https://x/a.png"}}},
        locations={}, props={},
    )
    assert "@act_999" in rewritten
    assert rewritten.startswith("[图1] 与 @act_999")
    assert [r["url"] for r in refs] == ["https://x/a.png"]


def test_mixed_at_and_brace_forms_in_one_prompt():
    rewritten, refs = resolve_subject_tokens(
        "{act_001} 与 @act_002 在 @loc_003",
        actors={
            "act_001": {"default": {"face_view_url": "https://x/a1.png"}},
            "act_002": {"default": {"face_view_url": "https://x/a2.png"}},
        },
        locations={"loc_003": {"image_url": "https://x/l3.png"}},
        props={},
    )
    assert rewritten == "[图1] 与 [图2] 在 [图3]"
    assert len(refs) == 3


def test_actor_falls_back_through_state_keys():
    # Actor has no 'default' state but has '中药' state with face_view_url
    actors = {"act_001": {"name": "X", "voice": "...", "中药": {"face_view_url": "https://x/y.png"}}}
    _, refs = resolve_subject_tokens(
        "@act_001 出场",
        actors=actors, locations={}, props={},
    )
    assert refs[0]["url"] == "https://x/y.png"
```

Run: `cd .claude/skills/video-gen/scripts && python -m pytest test_subject_resolver.py -x`. **Verify RED** (ImportError).

- [ ] **Step 2: Implement `subject_resolver.py`**

```python
# input: storyboard prompt with @act_xxx/@loc_xxx/@prop_xxx tokens (or legacy {...} form),
#        registered actor/location/prop dicts loaded from output/{actors,locations,props}/*.json
# output: prompt rewritten with [图N] markers + ordered list of reference image dicts
# pos: video-gen consumer-side resolver bridging storyboard producer tokens to Ark referenceImages[]

import re
from typing import Dict, List, Tuple, Optional

# Match @act_001 OR {act_001} OR @prop_002 OR {loc_003}; act/loc/prop only.
_TOKEN_RE = re.compile(r"[@{](act|loc|prop)_(\d+)\}?")


def extract_subject_tokens(prompt: str) -> List[str]:
    seen: List[str] = []
    seen_set: set[str] = set()
    for kind, num in _TOKEN_RE.findall(prompt):
        token = f"{kind}_{num}"
        if token not in seen_set:
            seen.append(token)
            seen_set.add(token)
    return seen


def _actor_image_url(actor: Dict) -> Optional[str]:
    """Walk the nested state dicts in an actor entry; return the first usable url.

    Prefers face_view_url, then three_view_url, then side_view_url.
    """
    for value in actor.values():
        if not isinstance(value, dict):
            continue
        for key in ("face_view_url", "three_view_url", "side_view_url"):
            url = value.get(key)
            if url:
                return url
    return None


def _lookup_image(token: str, actors: Dict, locations: Dict, props: Dict) -> Optional[Dict]:
    if token.startswith("act_"):
        actor = actors.get(token) or {}
        url = _actor_image_url(actor)
        if not url:
            return None
        # Find subject_id from the same state dict that produced the url (best-effort).
        subject_id = ""
        for value in actor.values():
            if isinstance(value, dict) and value.get("subject_id"):
                subject_id = value["subject_id"]
                break
        return {
            "url": url,
            "name": token,
            "display_name": actor.get("name", token),
            "subject_id": subject_id,
        }
    if token.startswith("loc_"):
        loc = locations.get(token) or {}
        url = loc.get("image_url")
        if not url:
            return None
        return {
            "url": url,
            "name": token,
            "display_name": loc.get("name", token),
            "subject_id": loc.get("subject_id", ""),
        }
    if token.startswith("prop_"):
        prop = props.get(token) or {}
        url = prop.get("image_url")
        if not url:
            return None
        return {
            "url": url,
            "name": token,
            "display_name": prop.get("name", token),
            "subject_id": prop.get("subject_id", ""),
        }
    return None


def resolve_subject_tokens(
    prompt: str,
    *,
    actors: Dict,
    locations: Dict,
    props: Dict,
) -> Tuple[str, List[Dict]]:
    """Rewrite tokens in prompt to [图N] markers and return matching reference image dicts.

    Returns:
        (rewritten_prompt, ordered_reference_images)
        - Tokens with no resolvable image are left as-is in the prompt and skipped in refs.
        - [图N] is 1-based and matches reference_images list order.
    """
    tokens = extract_subject_tokens(prompt)
    refs: List[Dict] = []
    token_to_index: Dict[str, int] = {}
    for token in tokens:
        ref = _lookup_image(token, actors, locations, props)
        if ref is None:
            continue
        refs.append(ref)
        token_to_index[token] = len(refs)

    def _replace(match: re.Match[str]) -> str:
        token = f"{match.group(1)}_{match.group(2)}"
        idx = token_to_index.get(token)
        if idx is None:
            return match.group(0)
        return f"[图{idx}]"

    rewritten = _TOKEN_RE.sub(_replace, prompt)
    return rewritten, refs
```

Re-run tests → **expect GREEN**. Fix any failure before moving on.

- [ ] **Step 3: Commit**

```
feat(video-gen): add subject_resolver for @token → [图N] rewrite

Plan-Id: video-gen-subject-reference-2026-04-27-v2
```

---

### Task 2: Wire resolver into `batch_generate.py` preprocessing

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py`

The current preprocessing flow (verified at line 673-729) is:

```
ls['full_prompts']                                  # raw storyboard prompt with @act_001 tokens
  → subject_ids = extract_subject_ids(...)          # GAP: regex misses @-form
  → reference_images = map_subject_ids_to_images(...) # mapping is correct, just receives [] today
  → reference_images.append(lsi)                    # continuity frame still applied below
  → prompt = convert_prompt_brackets(...)           # legacy 【xxx】 → {base_name}
  → ClipIntent(prompt_text=prompt, reference_images=[...], ...)
```

After this task:

```
ls['full_prompts']
  → prompt_with_indices, resolved_refs = resolve_subject_tokens(prompt, actors=..., locations=..., props=...)
  → reference_images = list(resolved_refs)
  → reference_images.append(lsi)
  → prompt = convert_prompt_brackets(prompt_with_indices)   # safe: 【】 form is orthogonal to @-tokens
  → ClipIntent(prompt_text=prompt, reference_images=reference_images, ...)
```

- [ ] **Step 1: Update `_SUBJECT_ID_PATTERN` at line 172**

Replace:

```python
_SUBJECT_ID_PATTERN = re.compile(r'\{((?:act|loc)_\d+)\}')
```

with:

```python
# Matches @act_001 / {act_001} / @prop_002 / {loc_003}. act/loc/prop only.
_SUBJECT_ID_PATTERN = re.compile(r'[@{]((?:act|loc|prop)_\d+)\}?')
```

Update `extract_subject_ids` docstring/examples to mention both forms.

- [ ] **Step 2: Load `props.json` alongside actors and locations**

In `load_assets_subject_mapping` (around line 395-460), add a third loader for `props.json` that mirrors the locations branch (flat `image_url` + `subject_id` per entry). If `props.json` does not exist, log `[INFO] no props.json found; props/* tokens will pass through unresolved` and continue.

- [ ] **Step 3: Replace the two-step at line 658 (dry-run) and line 678 (real run)**

Add `from subject_resolver import resolve_subject_tokens` at module top.

In the dry-run branch:

```python
subject_ids = extract_subject_ids(ls['full_prompts'])  # kept for log parity
prompt_with_indices, resolved_refs = resolve_subject_tokens(
    ls['full_prompts'],
    actors=assets_mapping.get("actors", {}),
    locations=assets_mapping.get("locations", {}),
    props=assets_mapping.get("props", {}),
)
prompt = convert_prompt_brackets(prompt_with_indices)
```

Adjust `assets_mapping` shape if needed — currently it is a flat `Dict[id, entry]`. Either pass three sub-dicts to the resolver, or keep flat and switch resolver to accept it. **Recommendation:** keep three sub-dicts. Refactor `load_assets_subject_mapping` to return `{"actors": {...}, "locations": {...}, "props": {...}}`, and update the two existing callers.

In the real-run branch (line 678 onward):

```python
prompt_with_indices, resolved_refs = resolve_subject_tokens(
    ls['full_prompts'],
    actors=assets_mapping.get("actors", {}),
    locations=assets_mapping.get("locations", {}),
    props=assets_mapping.get("props", {}),
)
reference_images = list(resolved_refs)
if reference_images:
    print(f"  [{ls_id}] {len(reference_images)} 参考图映射 (image-reference mode)")
lsi_url = ls.get('lsi_url', '')
if lsi_url:
    reference_images.append({
        "url": lsi_url,
        "name": "lsi",
        "display_name": "上一镜头首帧",
    })
    print(f"  [{ls_id}] lsi 参考图已加入 (url={lsi_url[:50]})")

prompt = convert_prompt_brackets(prompt_with_indices)
```

Drop the now-redundant `subject_ids = extract_subject_ids(...)` and `map_subject_ids_to_images(...)` calls in the real-run branch (the old log line `f"  [{ls_id}] {len(reference_images)}/{len(subject_ids)} 参考图映射"` becomes `f"  [{ls_id}] {len(reference_images)} 参考图映射"`).

- [ ] **Step 4: Sanity-test by hand**

Pick a real workspace (e.g. `workspace/c4-1/`) with approved storyboard. Run:

```bash
cd .claude/skills/video-gen/scripts
PROJECT_DIR=$(pwd)/../../../../workspace/c4-1 \
  python batch_generate.py --episode 1 --dry-run 2>&1 | head -40
```

Confirm:
- log line shows non-zero `参考图映射` count
- if you `print(prompt)` once, `[图1]` / `[图2]` markers are present (not raw `@act_001`)

- [ ] **Step 5: Commit**

```
feat(video-gen): resolve @token references through subject_resolver

Plan-Id: video-gen-subject-reference-2026-04-27-v2
```

---

### Task 3: Document `referenceImages` in aos-cli model contract

**Files:**
- Modify: `.claude/skills/_shared/AOS_CLI_MODEL.md`

- [ ] **Step 1: Extend the Video submit example at line 117-132**

Replace the existing block with:

```jsonc
{
  "apiVersion": "aos-cli.model/v1",
  "task": "video.ep001.scn001.clip001",
  "capability": "video.generate",
  "output": {"kind": "task"},
  "input": {
    "prompt": "[图1] 走入 [图2]，[图1] 抬眼。",
    "duration": 5,
    "ratio": "16:9",
    "quality": "standard",
    "referenceImages": [
      { "url": "https://...portrait.png", "role": "reference_image", "name": "act_001" },
      { "url": "https://...location.png", "role": "reference_image", "name": "loc_002" }
    ],
    "referenceVideos": [
      { "url": "https://...lsi.mp4", "role": "first_frame", "name": "lsi" }
    ]
  }
}
```

Add a short paragraph after the example:

> `[图N]` markers in `prompt` are 1-based indexes into `input.referenceImages[]`. The boundary forwards these references into Ark's `content[]` array; Ark binds them by index. `referenceVideos[]` accepts a `first_frame` role used by the continuity hand-off between consecutive clips.

- [ ] **Step 2: Commit**

```
docs(aos-cli-model): document referenceImages/referenceVideos in video.generate

Plan-Id: video-gen-subject-reference-2026-04-27-v2
```

---

### Task 4: Cross-link from `video-gen/SKILL.md`

**Files:**
- Modify: `.claude/skills/video-gen/SKILL.md`

- [ ] **Step 1: Add a short consumption-contract section**

Find the existing input-format section. Add a paragraph (or sub-section) describing:

> **Subject reference resolution.** Storyboard prompts use `@act_xxx` / `@loc_xxx` / `@prop_xxx` tokens. Before submission, `subject_resolver.resolve_subject_tokens()` rewrites them to `[图N]` markers and assembles the matching `referenceImages[]` entry list from `output/actors/actors.json`, `output/locations/locations.json`, `output/props/props.json`. Tokens with no resolvable image stay as raw text — the model receives them unchanged but no reference image is attached. See `_shared/AOS_CLI_MODEL.md` for the wire shape.

- [ ] **Step 2: Commit**

```
docs(video-gen): document @token → [图N] consumption contract

Plan-Id: video-gen-subject-reference-2026-04-27-v2
```

---

## Risks and Rollback

- **Risk: Storyboards still containing legacy `【xxx】` form.** Handled by keeping `convert_prompt_brackets` in the chain; resolver runs first and handles `@`-tokens, then `convert_prompt_brackets` cleans up `【】`. Order matters — resolver must run **before** `convert_prompt_brackets`.
- **Risk: `[图N]` index drift on multi-character scenes.** Resolver dedupes by token (`act_001` referenced twice → one entry in `referenceImages` → both occurrences rewrite to `[图1]`). Confirmed by `test_dedupes_repeated_tokens_preserving_first_occurrence`.
- **Risk: Missing assets.** When a token has no `image_url`, the resolver leaves the raw `@act_xxx` in the prompt and skips its slot. This is intentionally lossy-soft — Ark gets a prompt with an unresolved token (≤ today's behavior, since today the prompt also passes `@act_001` through unchanged).
- **Risk: Real-person photo restrictions in Ark.** Out of scope for this plan. If Ark rejects, the failure surfaces through the existing aos-cli error envelope (`PROVIDER_REJECTED`), unchanged.
- **Rollback path:** Revert Task 4 → 3 → 2 → 1 in reverse order. Task 1 is purely additive (new module + new test file) and safe to leave merged even after a feature-flag-style rollback. Single revert of Task 2's commit restores the previous broken-but-shipping behavior immediately.

---

## Verification Checklist

- [ ] `cd .claude/skills/video-gen/scripts && python -m pytest test_subject_resolver.py` → all green
- [ ] `cd .claude/skills/video-gen/scripts && python -m pytest .` → no regression in existing suites (`test_provider_switch.py`, `test_duration_manifest.py`, `test_fake_e2e_generation.py`, `test_video_generation_scheduling.py`)
- [ ] Manual dry-run on `workspace/c4-1/` produces `[图N]` in compiled prompt and non-empty `referenceImages` in submit JSON
- [ ] `_shared/AOS_CLI_MODEL.md` documents both new fields
- [ ] `video-gen/SKILL.md` cross-links the resolver
