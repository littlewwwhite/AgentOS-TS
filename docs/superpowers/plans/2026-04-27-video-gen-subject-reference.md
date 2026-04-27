# Video-Gen Subject Reference Activation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `video-gen` recognize the `@act_xxx` / `@loc_xxx` / `@prop_xxx` tokens that the v1.4.0 `storyboard` skill emits, rewrite them to `[图N]` markers in the prompt sent to Ark, and inject the matching reference-image URLs into `referenceImages[]` so Ark binds each image to its index in the prompt.

**Architecture:** Add a pure `subject_resolver` module to `video-gen/scripts/` that owns token regex, image lookup against the existing flat `assets_mapping`, and `[图N]` prompt rewriting. Wire it into `batch_generate.py`'s clip preprocessing so `ClipIntent.prompt_text` and `ClipIntent.reference_images` carry the rewritten prompt and ordered image dicts before reaching `request_compiler`. `request_compiler.compile_request` already forwards `intent.reference_images` and merges the lsi continuity frame — no change needed there. `video_api.py` and `config.json` are also unchanged (gnhf #40 already finished those layers).

**Tech Stack:** Python 3.11+, `unittest` (matching the existing `test_*.py` style under `video-gen/scripts/`), no new runtime deps. Storyboard producer side already shipped (commit `caa9607`, skill v1.4.0).

---

## Audit Findings (Verified Post-Merge, df74cb2)

- **Producer (shipped):** `.claude/skills/storyboard/SKILL.md` v1.4.0 + `prompts/storyboard_system.txt` enforce `@act_xxx`/`@loc_xxx`/`@prop_xxx`; static appearance forbidden.
- **Consumer gap (regex):** `.claude/skills/video-gen/scripts/batch_generate.py:172` → `_SUBJECT_ID_PATTERN = re.compile(r'\{((?:act|loc)_\d+)\}')`. Confirmed empirically: `findall` against `"@act_001 与 {act_002} 在 @loc_003"` returns only `['act_002']`.
- **Consumer gap (no `[图N]` rewrite):** No code in `video-gen/scripts/` mentions `@act_`, `@loc_`, `@prop_`, or `[图`. Even if reference URLs were attached, Ark gets the prompt with raw `@act_001` strings, which Ark treats as plain text — the corresponding image is sent but never bound.
- **Consumer gap (no `prop` namespace):** Neither the regex nor `load_assets_subject_mapping` has any `prop_xxx` awareness.
- **Boundary status:** `aos-cli/src/aos_cli/model/providers/ark_video.py:30-55` builds Ark `content[]` from `options.referenceImages`. `video_api.submit_video_generation` writes `input.referenceImages = [...]`. Wire shape supports it; no protocol extension needed.
- **Docs gap:** `.claude/skills/_shared/AOS_CLI_MODEL.md` Video submit example only shows `{prompt, duration, ratio, quality}`.

## What gnhf P4 Already Did (Do Not Redo)

- `submit_video()` no longer takes `subjects=`, no longer raises `RuntimeError`
- `request_compiler.compile_request` always builds image refs + lsi continuity frame
- `config.json` no longer has `subject_reference` flag
- `get_subject_reference_for_model` / `build_subject_prompt_params` deleted

---

## File Map

- **Create:** `.claude/skills/video-gen/scripts/subject_resolver.py`
  Pure module, two public functions: `extract_subject_tokens(prompt) -> list[str]` and `resolve_subject_tokens(prompt, assets_mapping) -> tuple[str, list[dict]]`. Token regex matches `@act_001`, `{act_001}`, `@loc_002`, `{loc_002}`, `@prop_003`, `{prop_003}`. Reuses the existing flat `assets_mapping` shape from `load_assets_subject_mapping` so we inherit actor image priority (`three_view_url` > `main_url`) without duplication.
- **Create:** `.claude/skills/video-gen/scripts/test_subject_resolver.py`
  `unittest`-style test module that mirrors `test_provider_switch.py` style. Covers extraction (both forms, dedup, prop namespace), resolution (rewritten prompt + ordered refs, missing token soft-fail, mixed forms).
- **Modify:** `.claude/skills/video-gen/scripts/batch_generate.py`
  - Replace `_SUBJECT_ID_PATTERN` at line 172 to also match `@`-form and `prop_*`.
  - Add `from subject_resolver import resolve_subject_tokens` near line 53 (existing imports block).
  - Extend `load_assets_subject_mapping` (line 297) with a third loader for `props/props.json` mirroring the locations branch.
  - Replace the dry-run preprocessing block at lines 658-670: call `resolve_subject_tokens` once, use its outputs.
  - Replace the real-run preprocessing block at lines 678-694: call `resolve_subject_tokens` once, drop the duplicate `extract_subject_ids` + `map_subject_ids_to_images` two-step.
- **Modify:** `.claude/skills/_shared/AOS_CLI_MODEL.md`
  Extend the Video submit example (lines 117-132) with `referenceImages[]` / `referenceVideos[]` and a one-paragraph note on `[图N]` indexing.
- **Modify:** `.claude/skills/video-gen/SKILL.md`
  Add a one-paragraph "Subject reference resolution" section pointing at `subject_resolver.py` and cross-linking `_shared/AOS_CLI_MODEL.md`.

---

### Task 1: Create the resolver module with failing tests

**Files:**
- Create: `.claude/skills/video-gen/scripts/subject_resolver.py`
- Create: `.claude/skills/video-gen/scripts/test_subject_resolver.py`

- [ ] **Step 1: Write the failing test file**

Create `.claude/skills/video-gen/scripts/test_subject_resolver.py` with this exact content:

```python
#!/usr/bin/env python3
# input: subject_resolver module under video-gen/scripts
# output: unittest assertions for token extraction + prompt rewriting + image resolution
# pos: regression coverage for storyboard @-token → Ark referenceImages[] bridge
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))


class ExtractSubjectTokensTest(unittest.TestCase):
    def test_extracts_at_form_act_loc_prop_in_order(self):
        from subject_resolver import extract_subject_tokens

        prompt = "@act_001 走入 @loc_002，望向 @prop_003"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "loc_002", "prop_003"])

    def test_extracts_legacy_brace_form(self):
        from subject_resolver import extract_subject_tokens

        prompt = "{act_001} 走入 {loc_002}"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "loc_002"])

    def test_dedupes_repeated_tokens_preserving_first_occurrence(self):
        from subject_resolver import extract_subject_tokens

        prompt = "@act_001 转向 @act_002，@act_001 抬手"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "act_002"])

    def test_mixed_at_and_brace_forms(self):
        from subject_resolver import extract_subject_tokens

        prompt = "{act_001} 与 @act_002 在 @loc_003"
        self.assertEqual(extract_subject_tokens(prompt), ["act_001", "act_002", "loc_003"])


class ResolveSubjectTokensTest(unittest.TestCase):
    def _mapping(self):
        return {
            "act_001": {
                "subject_id": "s1",
                "name": "白行风",
                "type": "actor",
                "image_url": "https://x/a1.png",
            },
            "act_002": {
                "subject_id": "s2",
                "name": "苏父",
                "type": "actor",
                "image_url": "https://x/a2.png",
            },
            "loc_003": {
                "subject_id": "sL",
                "name": "诛仙台",
                "type": "location",
                "image_url": "https://x/L.png",
            },
            "prop_004": {
                "subject_id": "sP",
                "name": "银锭",
                "type": "prop",
                "image_url": "https://x/P.png",
            },
        }

    def test_rewrites_prompt_to_image_indexes_and_orders_refs(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 走入 @loc_003"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 走入 [图2]")
        self.assertEqual([r["url"] for r in refs], ["https://x/a1.png", "https://x/L.png"])
        self.assertEqual(refs[0]["name"], "act_001")
        self.assertEqual(refs[1]["display_name"], "诛仙台")

    def test_dedupes_so_one_token_one_image_one_index(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 转向 @act_002，@act_001 抬手"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 转向 [图2]，[图1] 抬手")
        self.assertEqual(len(refs), 2)

    def test_missing_token_keeps_raw_text_and_skips_url(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 与 @act_999 对话"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 与 @act_999 对话")
        self.assertEqual([r["url"] for r in refs], ["https://x/a1.png"])

    def test_token_with_no_image_url_is_skipped(self):
        from subject_resolver import resolve_subject_tokens

        mapping = {
            "act_001": {
                "subject_id": "s1",
                "name": "X",
                "type": "actor",
                "image_url": "",
            }
        }
        prompt = "@act_001 出场"
        rewritten, refs = resolve_subject_tokens(prompt, mapping)
        self.assertEqual(rewritten, "@act_001 出场")
        self.assertEqual(refs, [])

    def test_mixed_form_resolution(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "{act_001} 与 @act_002 在 @loc_003"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 与 [图2] 在 [图3]")
        self.assertEqual(len(refs), 3)

    def test_prop_token_resolves(self):
        from subject_resolver import resolve_subject_tokens

        prompt = "@act_001 拿起 @prop_004"
        rewritten, refs = resolve_subject_tokens(prompt, self._mapping())
        self.assertEqual(rewritten, "[图1] 拿起 [图2]")
        self.assertEqual(refs[1]["url"], "https://x/P.png")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Verify the test fails**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest test_subject_resolver -v 2>&1 | tail -10
```

Expected: every test fails with `ModuleNotFoundError: No module named 'subject_resolver'`.

- [ ] **Step 3: Create the resolver module**

Create `.claude/skills/video-gen/scripts/subject_resolver.py` with this exact content:

```python
#!/usr/bin/env python3
# input: storyboard prompt with @/{}-form act/loc/prop tokens + flat assets_mapping
# output: prompt rewritten with [图N] markers + ordered list of reference image dicts
# pos: video-gen consumer-side bridge from storyboard tokens to Ark referenceImages[]
"""Subject reference resolver for video-gen.

Storyboard skill v1.4.0 emits prompts that reference characters/locations/props
via `@act_001` / `@loc_002` / `@prop_003` tokens (legacy `{act_001}` form is
also accepted for back-compat). Ark's multi-image binding requires `[图N]`
markers in the prompt that index 1-based into `content[]` reference images.
This module rewrites the tokens and assembles the ordered reference list.
"""

import re
from typing import Dict, List, Tuple

# Match @act_001 OR {act_001} OR @prop_002 OR {loc_003}; act/loc/prop only.
# Trailing `}` is optional so the same regex captures both forms.
_TOKEN_RE = re.compile(r"[@{]((?:act|loc|prop)_\d+)\}?")


def extract_subject_tokens(prompt: str) -> List[str]:
    """Return de-duplicated subject ids in first-occurrence order.

    Args:
        prompt: Storyboard prompt text.

    Returns:
        List of token ids like ["act_001", "loc_002", "prop_003"].
    """
    seen: List[str] = []
    seen_set = set()
    for token in _TOKEN_RE.findall(prompt):
        if token not in seen_set:
            seen.append(token)
            seen_set.add(token)
    return seen


def resolve_subject_tokens(
    prompt: str,
    assets_mapping: Dict[str, Dict],
) -> Tuple[str, List[Dict]]:
    """Rewrite tokens to [图N] and return the matching ordered reference dicts.

    Args:
        prompt: Storyboard prompt text containing @act_xxx / {act_xxx} tokens.
        assets_mapping: Flat dict from load_assets_subject_mapping(), keyed by
            id (act_001, loc_002, prop_003) with entries
            {"subject_id": str, "name": str, "type": str, "image_url": str}.

    Returns:
        Tuple of (rewritten_prompt, ordered_reference_image_dicts).
        - Tokens whose entry is missing or has no image_url are left as-is in
          the prompt and skipped in refs.
        - [图N] is 1-based and matches reference list order.
    """
    tokens = extract_subject_tokens(prompt)
    refs: List[Dict] = []
    token_to_index: Dict[str, int] = {}

    for token in tokens:
        entry = assets_mapping.get(token)
        if not entry:
            continue
        url = entry.get("image_url") or ""
        if not url:
            continue
        refs.append({
            "url": url,
            "name": token,
            "display_name": entry.get("name", token),
            "subject_id": entry.get("subject_id", ""),
        })
        token_to_index[token] = len(refs)

    def _replace(match: "re.Match[str]") -> str:
        token = match.group(1)
        idx = token_to_index.get(token)
        if idx is None:
            return match.group(0)
        return f"[图{idx}]"

    rewritten = _TOKEN_RE.sub(_replace, prompt)
    return rewritten, refs
```

- [ ] **Step 4: Verify all tests pass**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest test_subject_resolver -v 2>&1 | tail -15
```

Expected: `Ran 11 tests in ...s` and `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/video-gen/scripts/subject_resolver.py .claude/skills/video-gen/scripts/test_subject_resolver.py
git commit -m "$(cat <<'EOF'
feat(video-gen): add subject_resolver for @-token → [图N] rewrite

New pure module bridging storyboard v1.4.0 @act_xxx/@loc_xxx/@prop_xxx
tokens to Ark referenceImages[] + [图N] prompt indexing. Accepts both
@-form and legacy {}-form. Dedupes repeated tokens, soft-fails on
missing assets.
EOF
)"
```

---

### Task 2: Extend asset loader to include props.json

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py:297-364`
- Test: `.claude/skills/video-gen/scripts/test_subject_resolver.py` (add a loader smoke test)

- [ ] **Step 1: Write a failing loader test**

Append this class to `.claude/skills/video-gen/scripts/test_subject_resolver.py` (just before the `if __name__ == "__main__":` line):

```python
class LoadAssetsWithPropsTest(unittest.TestCase):
    def test_load_assets_subject_mapping_loads_props(self):
        import json
        import tempfile
        from batch_generate import load_assets_subject_mapping

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "actors").mkdir()
            (tmp_path / "locations").mkdir()
            (tmp_path / "props").mkdir()
            (tmp_path / "actors" / "actors.json").write_text(json.dumps({
                "act_001": {"name": "X", "default": {"subject_id": "s1", "three_view_url": "https://x/a.png"}}
            }), encoding="utf-8")
            (tmp_path / "locations" / "locations.json").write_text(json.dumps({}), encoding="utf-8")
            (tmp_path / "props" / "props.json").write_text(json.dumps({
                "prop_001": {"subject_id": "sp", "name": "银锭", "image_url": "https://x/p.png"}
            }), encoding="utf-8")

            mapping = load_assets_subject_mapping(str(tmp_path))

        self.assertIn("prop_001", mapping)
        self.assertEqual(mapping["prop_001"]["type"], "prop")
        self.assertEqual(mapping["prop_001"]["image_url"], "https://x/p.png")
        self.assertEqual(mapping["prop_001"]["name"], "银锭")
```

- [ ] **Step 2: Verify the new test fails**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest test_subject_resolver.LoadAssetsWithPropsTest -v 2>&1 | tail -10
```

Expected: `AssertionError: 'prop_001' not found in {...}` (loader does not load props yet).

- [ ] **Step 3: Add props loader to `load_assets_subject_mapping`**

In `.claude/skills/video-gen/scripts/batch_generate.py`, locate the block ending at line 364 (`return mapping`). Insert this block immediately before `return mapping`:

```python
    # Load props from props/props.json
    props_file = assets_path / "props" / "props.json"
    if props_file.exists():
        with open(props_file, 'r', encoding='utf-8') as f:
            props_data = json.load(f)
        prop_count = 0
        for prop_id, prop_data in props_data.items():
            subject_id = prop_data.get("subject_id", "")
            image_url = (
                prop_data.get("three_view_url")
                or prop_data.get("main_url")
                or prop_data.get("image_url", "")
            )
            name = prop_data.get("name", prop_id)
            if subject_id or image_url:
                mapping[prop_id] = {
                    "subject_id": subject_id,
                    "name": name,
                    "type": "prop",
                    "image_url": image_url,
                }
                prop_count += 1
            else:
                print(f"  [WARN] Prop '{prop_id}' ({name}) has no subject_id or image_url, skipping",
                      file=sys.stderr)
        print(f"[ASSETS] Loaded {prop_count} props from {props_file}")
    else:
        print(f"[INFO] props.json not found: {props_file} (props/* tokens will pass through unresolved)")
```

- [ ] **Step 4: Verify the test passes**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest test_subject_resolver.LoadAssetsWithPropsTest -v 2>&1 | tail -10
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/video-gen/scripts/batch_generate.py .claude/skills/video-gen/scripts/test_subject_resolver.py
git commit -m "$(cat <<'EOF'
feat(video-gen): load props.json into asset subject mapping

Extends load_assets_subject_mapping with a third loader mirroring the
locations branch. Without this, @prop_xxx tokens from storyboard v1.4.0
have no image_url to resolve to and pass through unresolved.
EOF
)"
```

---

### Task 3: Replace the brace-only regex with @-form-aware regex

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py:171-192`
- Test: `.claude/skills/video-gen/scripts/test_subject_resolver.py` (add a regression test)

- [ ] **Step 1: Write a failing regression test**

Append this class to `.claude/skills/video-gen/scripts/test_subject_resolver.py` (before the `if __name__ == "__main__":` line):

```python
class BatchGenerateRegexTest(unittest.TestCase):
    def test_batch_generate_extract_subject_ids_recognizes_at_form(self):
        from batch_generate import extract_subject_ids

        prompt = "@act_001 与 @act_002 在 @loc_003 对话，握住 @prop_004"
        self.assertEqual(
            extract_subject_ids(prompt),
            ["act_001", "act_002", "loc_003", "prop_004"],
        )

    def test_batch_generate_extract_subject_ids_keeps_brace_form(self):
        from batch_generate import extract_subject_ids

        prompt = "{act_001} 与 {loc_002}"
        self.assertEqual(extract_subject_ids(prompt), ["act_001", "loc_002"])
```

- [ ] **Step 2: Verify the test fails**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest test_subject_resolver.BatchGenerateRegexTest -v 2>&1 | tail -10
```

Expected: `test_batch_generate_extract_subject_ids_recognizes_at_form` fails with `AssertionError: Lists differ: [] != ['act_001', 'act_002', 'loc_003', 'prop_004']`.

- [ ] **Step 3: Replace the regex at line 172**

In `.claude/skills/video-gen/scripts/batch_generate.py`, find the block:

```python
# Pattern: matches {act_xxx} or {loc_xxx} subject ID placeholders
_SUBJECT_ID_PATTERN = re.compile(r'\{((?:act|loc)_\d+)\}')
```

Replace with:

```python
# Pattern: matches @act_xxx / {act_xxx} / @loc_xxx / {loc_xxx} / @prop_xxx / {prop_xxx}
# Storyboard skill v1.4.0 emits @-form; legacy storyboards still use {-form.
_SUBJECT_ID_PATTERN = re.compile(r'[@{]((?:act|loc|prop)_\d+)\}?')
```

In the same file, update the `extract_subject_ids` docstring at lines 180-191 to mention both forms. Find:

```python
def extract_subject_ids(full_prompt: str) -> List[str]:
    """Extract all unique subject IDs from {act_xxx} or {loc_xxx} in prompt.

    Examples:
    - "{act_001} 站在演武场中央" -> ["act_001"]
    - "{act_001} 和 {act_002} 在 {loc_003} 对话" -> ["act_001", "act_002", "loc_003"]

    Args:
        full_prompt: The full_prompts string from ep_shots.json

    Returns:
        De-duplicated list of subject IDs (preserving order)
    """
```

Replace with:

```python
def extract_subject_ids(full_prompt: str) -> List[str]:
    """Extract all unique subject IDs from @ or {} forms in prompt.

    Accepted forms (per storyboard skill v1.4.0): @act_xxx, @loc_xxx,
    @prop_xxx, plus legacy {act_xxx}/{loc_xxx}/{prop_xxx} for back-compat.

    Examples:
    - "@act_001 站在演武场中央" -> ["act_001"]
    - "@act_001 和 @act_002 在 @loc_003 对话" -> ["act_001", "act_002", "loc_003"]
    - "{act_001} 与 @prop_004" -> ["act_001", "prop_004"]

    Args:
        full_prompt: The full_prompts string from ep_storyboard.json

    Returns:
        De-duplicated list of subject IDs (preserving order)
    """
```

- [ ] **Step 4: Verify both regression tests pass**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest test_subject_resolver.BatchGenerateRegexTest -v 2>&1 | tail -10
```

Expected: `Ran 2 tests in ...s` and `OK`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/video-gen/scripts/batch_generate.py .claude/skills/video-gen/scripts/test_subject_resolver.py
git commit -m "$(cat <<'EOF'
feat(video-gen): match @-form and prop_* in subject ID regex

Updates _SUBJECT_ID_PATTERN to match @act_xxx / {act_xxx} /
@loc_xxx / {loc_xxx} / @prop_xxx / {prop_xxx}. Without this,
extract_subject_ids returned [] for every prompt the storyboard
skill produced after v1.4.0.
EOF
)"
```

---

### Task 4: Wire the resolver into the dry-run preprocessing block

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py:53` (import) and `:653-670` (dry-run loop)

- [ ] **Step 1: Add the resolver import**

In `.claude/skills/video-gen/scripts/batch_generate.py`, find line 53:

```python
from batch_generate_runtime import _process_scene_clips, process_scenes_parallel
```

Insert immediately after it:

```python
from subject_resolver import resolve_subject_tokens
```

- [ ] **Step 2: Replace the dry-run preprocessing block**

In the same file, find the dry-run block at lines 653-670:

```python
    if dry_run:
        for ls in clips:
            ls_id = ls['clip_id']
            scene_id = ls.get('scene_id', '?')
            pv = ls.get('prompt_version', 0)
            subject_ids = extract_subject_ids(ls['full_prompts'])
            mapped = map_subject_ids_to_images(subject_ids, assets_mapping)
            print(f"  [{ls_id}] pv={pv} [DRY-RUN] Skipping")
            results.append({
                "clip_id": ls_id,
                "scene_id": scene_id,
                "prompt_version": pv,
                "prompt": convert_prompt_brackets(ls['full_prompts']),
                "success": True,
                "dry_run": True,
                "subjects_found": len(subject_ids),
                "subjects_mapped": len(mapped or []),
            })
```

Replace with:

```python
    if dry_run:
        for ls in clips:
            ls_id = ls['clip_id']
            scene_id = ls.get('scene_id', '?')
            pv = ls.get('prompt_version', 0)
            prompt_with_indices, resolved_refs = resolve_subject_tokens(
                ls['full_prompts'], assets_mapping
            )
            print(f"  [{ls_id}] pv={pv} [DRY-RUN] Skipping")
            results.append({
                "clip_id": ls_id,
                "scene_id": scene_id,
                "prompt_version": pv,
                "prompt": convert_prompt_brackets(prompt_with_indices),
                "success": True,
                "dry_run": True,
                "subjects_found": len(extract_subject_ids(ls['full_prompts'])),
                "subjects_mapped": len(resolved_refs),
            })
```

- [ ] **Step 3: Run the dry-run path against an existing fixture**

Run the existing test suite to confirm nothing else breaks:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest discover -p "test_*.py" -v 2>&1 | tail -20
```

Expected: existing tests still pass; resolver tests still green.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/video-gen/scripts/batch_generate.py
git commit -m "$(cat <<'EOF'
feat(video-gen): apply subject_resolver in dry-run preprocessing

Dry-run path now rewrites @-tokens to [图N] markers before storing the
prompt in results, matching real-run behavior. Token extraction stays
for diagnostic counts.
EOF
)"
```

---

### Task 5: Wire the resolver into the real-run preprocessing block

**Files:**
- Modify: `.claude/skills/video-gen/scripts/batch_generate.py:672-694`

- [ ] **Step 1: Replace the real-run preprocessing block**

In `.claude/skills/video-gen/scripts/batch_generate.py`, find the block at lines 672-694:

```python
    else:
        # ── Pre-process all clips ──
        clip_states = []
        for ls in clips:
            ls_id = ls['clip_id']
            scene_id = ls.get('scene_id', '?')
            pv = ls.get('prompt_version', 0)
            subject_ids = extract_subject_ids(ls['full_prompts'])

            reference_images = map_subject_ids_to_images(subject_ids, assets_mapping)
            if reference_images:
                print(f"  [{ls_id}] {len(reference_images)}/{len(subject_ids)} 参考图映射 (图片参考)")
            # JSON 中已有 lsi.url（上一 clip 最后镜头首帧），同时作为参考图加入
            lsi_url = ls.get('lsi_url', '')
            if lsi_url:
                reference_images = list(reference_images or [])
                reference_images.append({
                    "url": lsi_url,
                    "name": "lsi",
                    "display_name": "上一镜头首帧",
                })
                print(f"  [{ls_id}] lsi 参考图已加入 (url={lsi_url[:50]})")

            prompt = convert_prompt_brackets(ls['full_prompts'])
            dur_api = parse_duration(ls.get('duration_seconds', '5'))
            location_num, clip_num = parse_clip_id(ls_id)
```

Replace with:

```python
    else:
        # ── Pre-process all clips ──
        clip_states = []
        for ls in clips:
            ls_id = ls['clip_id']
            scene_id = ls.get('scene_id', '?')
            pv = ls.get('prompt_version', 0)

            prompt_with_indices, reference_images = resolve_subject_tokens(
                ls['full_prompts'], assets_mapping
            )
            subject_ids = extract_subject_ids(ls['full_prompts'])
            if reference_images:
                print(f"  [{ls_id}] {len(reference_images)}/{len(subject_ids)} 参考图映射 (image-reference mode)")
            # JSON 中已有 lsi.url（上一 clip 最后镜头首帧），同时作为参考图加入
            lsi_url = ls.get('lsi_url', '')
            if lsi_url:
                reference_images = list(reference_images)
                reference_images.append({
                    "url": lsi_url,
                    "name": "lsi",
                    "display_name": "上一镜头首帧",
                })
                print(f"  [{ls_id}] lsi 参考图已加入 (url={lsi_url[:50]})")

            prompt = convert_prompt_brackets(prompt_with_indices)
            dur_api = parse_duration(ls.get('duration_seconds', '5'))
            location_num, clip_num = parse_clip_id(ls_id)
```

The order matters: `resolve_subject_tokens` runs **before** `convert_prompt_brackets`, so `@`-tokens become `[图N]` first, then `convert_prompt_brackets` cleans up legacy `【xxx】` form (orthogonal — they cannot collide).

- [ ] **Step 2: Run the full video-gen test suite**

Run:
```bash
cd .claude/skills/video-gen/scripts && python3 -m unittest discover -p "test_*.py" -v 2>&1 | tail -25
```

Expected: all existing tests still pass, `Ran NN tests in ...s`, `OK`.

- [ ] **Step 3: Smoke-test against a real workspace if present**

Check whether `workspace/c4-1/output/storyboard/approved/` exists:
```bash
ls workspace/c4-1/output/storyboard/approved/ 2>&1 | head -5
```

If at least one `ep*_storyboard.json` exists, run a dry-run and grep for `[图`:
```bash
PROJECT_DIR=$(pwd)/workspace/c4-1 \
  python3 .claude/skills/video-gen/scripts/batch_generate.py \
  workspace/c4-1/output/storyboard/approved/ep001_storyboard.json \
  --output workspace/c4-1/output/ep001 \
  --episode 1 --dry-run 2>&1 | grep -E '\[图|参考图映射' | head -10
```

Expected: at least one line containing `[图` or `参考图映射` with a non-zero count. If no real workspace exists, skip this step — the test suite already locks behavior.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/video-gen/scripts/batch_generate.py
git commit -m "$(cat <<'EOF'
feat(video-gen): apply subject_resolver in real-run preprocessing

Real-run path now resolves @-tokens to [图N] markers + ordered
referenceImages[] before building ClipIntent. Resolver runs before
convert_prompt_brackets so @-tokens and legacy 【xxx】 form remain
orthogonal. lsi continuity frame is appended after resolution.
EOF
)"
```

---

### Task 6: Document referenceImages/referenceVideos in the model contract

**Files:**
- Modify: `.claude/skills/_shared/AOS_CLI_MODEL.md:117-132`

- [ ] **Step 1: Replace the Video submit example**

In `.claude/skills/_shared/AOS_CLI_MODEL.md`, find lines 117-132:

```markdown
Video submit:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "video.ep001.scn001.clip001",
  "capability": "video.generate",
  "output": {"kind": "task"},
  "input": {
    "prompt": "Slow camera push through a moonlit courtyard.",
    "duration": 5,
    "ratio": "16:9",
    "quality": "standard"
  }
}
```
```

Replace with:

````markdown
Video submit:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "video.ep001.scn001.clip001",
  "capability": "video.generate",
  "output": {"kind": "task"},
  "input": {
    "prompt": "[图1] 走入 [图2]，[图1] 抬眼望向远处。",
    "duration": 5,
    "ratio": "16:9",
    "quality": "standard",
    "referenceImages": [
      { "url": "https://.../act_001.png", "role": "reference_image", "name": "act_001" },
      { "url": "https://.../loc_002.png", "role": "reference_image", "name": "loc_002" }
    ],
    "referenceVideos": [
      { "url": "https://.../prev_clip_first_frame.mp4", "role": "first_frame", "name": "lsi" }
    ]
  }
}
```

`[图N]` markers in `prompt` are 1-based indexes into `input.referenceImages[]`.
The boundary forwards these references into Ark's `content[]` array; Ark binds
them by index. `referenceVideos[]` accepts a `first_frame` role used by the
continuity hand-off between consecutive clips. Both arrays are optional —
omit them for plain text-to-video generation.
````

- [ ] **Step 2: Verify the change**

Run:
```bash
grep -n "referenceImages\|referenceVideos" .claude/skills/_shared/AOS_CLI_MODEL.md
```

Expected: at least 2 lines mentioning each field.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/_shared/AOS_CLI_MODEL.md
git commit -m "$(cat <<'EOF'
docs(aos-cli-model): document referenceImages/referenceVideos in video.generate

Documents the `input.referenceImages[]` and `input.referenceVideos[]`
fields that the boundary already supports
(aos-cli/src/aos_cli/model/providers/ark_video.py:30-55) but whose wire
shape was undocumented. Includes [图N] indexing convention.
EOF
)"
```

---

### Task 7: Cross-link from video-gen SKILL.md

**Files:**
- Modify: `.claude/skills/video-gen/SKILL.md`

- [ ] **Step 1: Locate the input-format section**

Run:
```bash
grep -n "^## \|^### " .claude/skills/video-gen/SKILL.md | head -20
```

Identify the section that documents how prompts flow through video-gen (look for headings like `## Input` / `## Pipeline` / `## Reference`). If no such section exists, the addendum goes directly under the front-matter.

- [ ] **Step 2: Add the resolution-contract paragraph**

Open `.claude/skills/video-gen/SKILL.md`. Find the most appropriate section header from Step 1 (or the first `---` divider after front-matter if none exists). Insert the following paragraph immediately after that header:

```markdown
### Subject reference resolution

Storyboard prompts use `@act_xxx` / `@loc_xxx` / `@prop_xxx` tokens (legacy
`{act_xxx}` form is also accepted). Before submission,
`scripts/subject_resolver.resolve_subject_tokens()` rewrites them to `[图N]`
markers and assembles the matching `referenceImages[]` entry list from
`output/actors/actors.json`, `output/locations/locations.json`,
`output/props/props.json`. Tokens with no resolvable image stay as raw text —
the model receives them unchanged and no reference image is attached for that
slot. See `_shared/AOS_CLI_MODEL.md` for the wire shape.
```

- [ ] **Step 3: Verify the paragraph landed**

Run:
```bash
grep -n "subject_resolver\|@act_xxx" .claude/skills/video-gen/SKILL.md
```

Expected: at least one line per pattern.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/video-gen/SKILL.md
git commit -m "$(cat <<'EOF'
docs(video-gen): document @-token consumption contract

Documents how subject_resolver bridges storyboard @act_xxx / @loc_xxx /
@prop_xxx tokens to the [图N] marker + referenceImages[] convention
that the aos-cli video.generate capability consumes.
EOF
)"
```

---

## Risks and Rollback

- **Risk: Storyboards still containing legacy `【xxx】` form.** Handled by keeping `convert_prompt_brackets` in the chain; resolver runs first and handles `@`-tokens, then `convert_prompt_brackets` cleans up `【】`. Order matters — resolver must run **before** `convert_prompt_brackets`. Locked by Task 5 Step 1 ordering.
- **Risk: `[图N]` index drift on multi-character scenes.** Resolver dedupes by token (`act_001` referenced twice → one entry in `referenceImages` → both occurrences rewrite to `[图1]`). Locked by `test_dedupes_so_one_token_one_image_one_index`.
- **Risk: Missing assets.** When a token has no `image_url`, the resolver leaves the raw `@act_xxx` in the prompt and skips its slot. This is intentionally lossy-soft and matches today's behavior (the prompt already passes `@act_001` through unchanged). Locked by `test_missing_token_keeps_raw_text_and_skips_url`.
- **Risk: Real-person photo restrictions in Ark.** Out of scope. If Ark rejects a reference image, the failure surfaces through the existing aos-cli error envelope (`PROVIDER_REJECTED`), unchanged by this plan.
- **Rollback path:** Revert Task 7 → 6 → 5 → 4 → 3 → 2 → 1 in reverse commit order. Tasks 1, 2, and 6 are purely additive and safe to leave merged even after a behavior-level rollback. Single revert of Task 5's commit alone restores the previous broken-but-shipping behavior immediately.

---

## Self-Review Checklist (executed)

- **Spec coverage:** Each gap listed in Audit Findings → covered by a task. Regex gap → Task 3. `[图N]` rewriter gap → Task 1 + Task 4 + Task 5. `prop_xxx` gap → Task 2 + Task 3. Docs gap → Task 6 + Task 7.
- **Placeholder scan:** No "TODO", no "appropriate handling", no "similar to Task N". All commit messages are full multi-line strings via heredoc. All commands have expected output.
- **Type/name consistency:** `extract_subject_tokens` (resolver) vs `extract_subject_ids` (existing batch_generate function) — kept distinct on purpose; the former is the new public resolver function, the latter is the existing batch_generate helper that we update in-place to share the same regex (`_SUBJECT_ID_PATTERN`). Both use `[@{]((?:act|loc|prop)_\d+)\}?` after Task 3.
