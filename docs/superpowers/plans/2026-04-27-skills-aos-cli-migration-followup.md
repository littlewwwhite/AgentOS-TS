# Skills aos-cli Migration Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the aos-cli model migration by formally annotating the multimodal paths that the current `aos-cli model` protocol cannot yet cover, removing dead provider-key references, splitting a misnamed test file, and hardening the guardrail to lock in those decisions.

**Architecture:** Most "audit gaps" surfaced after the first migration are not migration targets — they are multimodal video/image+text review paths that `_shared/AOS_CLI_MODEL.md:188` already calls out as deferred until protocol expansion. This plan therefore (a) annotates those files with a stable `Model boundary note` so future readers and grep audits can tell deferred paths from forgotten ones, (b) deletes truly dead provider env coupling (`script-writer` Step 0-A), (c) splits the asset-gen test file along the migrated/deferred boundary, and (d) extends the guardrail test to enforce the annotation contract going forward.

**Tech Stack:** Python 3.11+, `unittest`, `.claude/skills/_shared/aos_cli_model.py`, `aos-cli model run/submit/poll/validate`, AST-based source guardrail, JSON config files, Markdown skill docs.

---

## Audit Findings Reconciliation

The first migration audit listed these as gaps. Re-reading `.claude/skills/_shared/AOS_CLI_MODEL.md` line 188 against each file produces these classifications:

| File | Audit verdict | Reconciled verdict | Reason |
|---|---|---|---|
| `video-gen/scripts/analyzer.py` | "migrate" | **Deferred** (annotate) | Uploads video bytes via `client.files.upload()` and calls `generate_content` with multimodal video+text. `aos-cli model` v1 has no `generate` contract for video file inputs. |
| `video-gen/scripts/frame_extractor.py::describe_frame_with_gemini` | "migrate" | **Deferred** (annotate) | Image+text describe call; same deferred class as `asset-gen/review_*.py` already documented as deferred. |
| `video-gen/scripts/config_loader.py` | "migrate" | **Annotate as serving deferred paths** | Holds the `gemini` config dict consumed by `analyzer.py` / `frame_extractor.py` / `evaluator.py`. Doesn't import `google.genai` itself; only reason it survives is the deferred consumers. |
| `script-writer/SKILL.md` Step 0-A `GEMINI_API_KEY` env check | "migrate or defer" | **Delete** | `.claude/skills/script-writer/scripts/` only contains a symlink to `script-adapt/scripts/detect_source_structure.py`; no script-writer code path imports `google.genai` or calls Gemini. The env check is vestigial dead coupling. |
| `video-gen/assets/config.json` `gemini` block | "clean legacy keys" | **Annotate as deferred** | Same reasoning as `config_loader.py`; the keys feed deferred multimodal review. |
| `asset-gen/assets/common/gemini_backend.json` | "clean legacy keys" | **Annotate as deferred** | Consumed by `gemini_multimodal_legacy.py` for `review_scene/char/props.py` (already deferred). |
| `asset-gen/scripts/test_chatfire_gemini_client.py` | "remove or migrate" | **Split + rename** | The file already contains both valid aos-cli boundary tests (for `common_gemini_client`) and valid deferred-path tests (for `gemini_multimodal_legacy`). The fix is to split it along that boundary, not delete it. |

Truly forbidden direct provider calls (the ones the guardrail is meant to catch) remain absent from the migrated set. The guardrail will be extended — not relaxed — to assert deferred files carry their annotation.

## File Structure

- Modify `.claude/skills/video-gen/scripts/analyzer.py`
  - Add module-level `# Model boundary note: deferred — multimodal video+text review` block.
- Modify `.claude/skills/video-gen/scripts/frame_extractor.py`
  - Add the same boundary note next to `describe_frame_with_gemini`.
- Modify `.claude/skills/video-gen/scripts/config_loader.py`
  - Annotate the `gemini` config section as serving deferred multimodal paths.
- Modify `.claude/skills/script-writer/SKILL.md`
  - Remove the `GEMINI_API_KEY` env check from Step 0-A and the trailing export tip.
- Modify `.claude/skills/asset-gen/scripts/test_chatfire_gemini_client.py`
  - Split into two files (`test_common_gemini_client.py` for migrated boundary; `test_gemini_multimodal_legacy.py` for deferred path) and remove the original.
- Modify `.claude/skills/video-gen/assets/config.json`
  - Add a `_boundary_note` field (and update human-readable note) marking the `gemini` section as deferred.
- Modify `.claude/skills/asset-gen/assets/common/gemini_backend.json`
  - Add a `_boundary_note` field marking the file as serving deferred image+text review.
- Modify `.claude/skills/_shared/test_no_new_direct_provider_calls.py`
  - Add a `DEFERRED_MULTIMODAL_PATHS` list and a new test asserting each entry contains the canonical boundary note marker.
- Modify `.claude/skills/_shared/AOS_CLI_MODEL.md`
  - Append an explicit deferred-paths registry under the existing migration rule section.

## Parallelization Decision

Run serial. All eight tasks share the canonical annotation marker string and the guardrail file; concurrent edits would risk drifting wording or partial guardrail enforcement.

---

## Canonical Marker

Every deferred file (Python or Markdown) must contain the exact ASCII marker string:

```
Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
```

For JSON config files (no comments allowed), use a `_boundary_note` field with that same string as its value. The guardrail test asserts the literal substring `Model boundary note: deferred multimodal` appears in each registered deferred file.

---

## Task 1: Add deferred annotation to `analyzer.py`

**Files:**
- Modify: `.claude/skills/video-gen/scripts/analyzer.py:1-12`

- [ ] **Step 1: Add the module-level boundary note**

Open `.claude/skills/video-gen/scripts/analyzer.py`. The current header is:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simplified Video Analyzer
简化视频分析器 - 只检查参考一致性和提示词符合度
"""
```

Replace that header with:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video file bytes + reviewer prompts (reference_consistency, prompt_compliance)
# output: per-clip review JSON consumed by gemini_adapter / evaluator
# pos: deferred multimodal video review path pending aos-cli model protocol expansion
"""
Simplified Video Analyzer
简化视频分析器 - 只检查参考一致性和提示词符合度

Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
This module uploads video bytes via the Gemini Files API and calls multimodal
generate_content. The current aos-cli model v1 protocol does not yet define a
video-file generate contract, so this path remains intentionally on the direct
SDK. Do NOT add new callers; new code must go through aos-cli model.
"""
```

- [ ] **Step 2: Verify the marker is present**

Run: `grep -c "Model boundary note: deferred multimodal" .claude/skills/video-gen/scripts/analyzer.py`
Expected: `1`

- [ ] **Step 3: Verify analyzer still parses**

Run: `python3 -c "import ast; ast.parse(open('.claude/skills/video-gen/scripts/analyzer.py').read())"`
Expected: exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/video-gen/scripts/analyzer.py
git commit -m "docs(video-gen): mark analyzer.py as deferred multimodal path"
```

---

## Task 2: Add deferred annotation to `frame_extractor.describe_frame_with_gemini`

**Files:**
- Modify: `.claude/skills/video-gen/scripts/frame_extractor.py:194-220`

- [ ] **Step 1: Add boundary note above the function**

Find the line `# Gemini 画面描述` (around line 192). Replace the section that currently reads:

```python
# ============================================================
# Gemini 画面描述
# ============================================================

def describe_frame_with_gemini(
```

with:

```python
# ============================================================
# Gemini 画面描述
# ============================================================
# Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
# This helper sends image+text to Gemini for a frame description used as the
# next clip's lsi.prompt. aos-cli model v1 does not yet define an image-input
# generate contract, so this path stays on the direct SDK. Do NOT add new
# callers; migrate when protocol coverage lands.

def describe_frame_with_gemini(
```

- [ ] **Step 2: Verify the marker is present**

Run: `grep -c "Model boundary note: deferred multimodal" .claude/skills/video-gen/scripts/frame_extractor.py`
Expected: `1`

- [ ] **Step 3: Verify the file still parses**

Run: `python3 -c "import ast; ast.parse(open('.claude/skills/video-gen/scripts/frame_extractor.py').read())"`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/video-gen/scripts/frame_extractor.py
git commit -m "docs(video-gen): mark describe_frame_with_gemini as deferred multimodal"
```

---

## Task 3: Annotate `config_loader.py` gemini section as serving deferred paths

**Files:**
- Modify: `.claude/skills/video-gen/scripts/config_loader.py:1-12,50-90`

- [ ] **Step 1: Add module-level boundary note**

The file currently begins with a shebang and module docstring. Insert (or extend) the docstring so it contains:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video-gen config.json + environment variables
# output: typed config dicts consumed by video_api / batch_generate / analyzer / frame_extractor
# pos: config surface; gemini section feeds deferred multimodal paths only
"""
Video-gen config loader.

Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
The `gemini` config section exposed by `get_gemini_config()` and
`get_gemini_review_config()` exists solely to support the deferred multimodal
review (`analyzer.py`) and frame description (`frame_extractor.py`) paths.
Migrated text/JSON/image/video paths route through aos-cli model and do not
read this section. Do not introduce new consumers of `get_gemini_config`.
"""
```

(Preserve any existing imports below the docstring.)

- [ ] **Step 2: Verify the marker is present and file parses**

Run: `grep -c "Model boundary note: deferred multimodal" .claude/skills/video-gen/scripts/config_loader.py && python3 -c "import ast; ast.parse(open('.claude/skills/video-gen/scripts/config_loader.py').read())"`
Expected: `1` printed, then exit 0.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/video-gen/scripts/config_loader.py
git commit -m "docs(video-gen): annotate config_loader gemini section as deferred-only"
```

---

## Task 4: Remove dead `GEMINI_API_KEY` check from `script-writer/SKILL.md`

**Files:**
- Modify: `.claude/skills/script-writer/SKILL.md:26-46`

Rationale: `.claude/skills/script-writer/scripts/` contains only a symlink to `script-adapt/scripts/detect_source_structure.py`; no Python in script-writer imports `google.genai` or calls Gemini. The env check is vestigial.

- [ ] **Step 1: Replace the env check with a dependency-only check**

Find the block beginning with `### 步骤 0-A: 环境检查` and ending after the `> 若 GEMINI_API_KEY 未设置...` line. Replace the entire block with:

````markdown
### 步骤 0-A: 环境检查

```bash
python3 -c "
import sys, importlib
missing = []
for mod, pkg in {'dotenv': 'python-dotenv'}.items():
    try: importlib.import_module(mod)
    except ImportError: missing.append(pkg)
if missing:
    print(f'缺少依赖: {\", \".join(missing)}')
    sys.exit(1)
else:
    print('所有依赖已就绪')
"
```

> script-writer 本身不直接调用任何模型 SDK；模型调用统一走 `aos-cli model`（见 `.claude/skills/_shared/AOS_CLI_MODEL.md`）。如需运行需要模型的下游 skill，先用 `aos-cli model preflight --json` 确认就绪。
````

- [ ] **Step 2: Verify GEMINI_API_KEY is gone from this file**

Run: `grep -c "GEMINI_API_KEY" .claude/skills/script-writer/SKILL.md`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/script-writer/SKILL.md
git commit -m "refactor(script-writer): drop vestigial GEMINI_API_KEY env check"
```

---

## Task 5: Split `test_chatfire_gemini_client.py` along the migrated/deferred boundary

**Files:**
- Create: `.claude/skills/asset-gen/scripts/test_common_gemini_client.py`
- Create: `.claude/skills/asset-gen/scripts/test_gemini_multimodal_legacy.py`
- Delete: `.claude/skills/asset-gen/scripts/test_chatfire_gemini_client.py`

The current file mixes two concerns: it tests the migrated aos-cli boundary (`common_gemini_client`) AND the surviving direct-SDK helper (`gemini_multimodal_legacy`). Splitting makes intent visible to grep and lets the guardrail evolve each side independently.

- [ ] **Step 1: Write `test_common_gemini_client.py` (migrated boundary tests)**

Create `.claude/skills/asset-gen/scripts/test_common_gemini_client.py` with:

```python
#!/usr/bin/env python3
# input: asset-gen common_gemini_client + fake aos-cli adapter
# output: unittest assertions that text/JSON paths build aos-cli envelopes correctly
# pos: regression coverage for asset-gen text/JSON model boundary

import importlib
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


class CommonGeminiClientBoundaryTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        self._old_module = sys.modules.get("common_gemini_client")
        os.environ["GEMINI_API_KEY"] = "test-key"

    def tearDown(self):
        if self._old_module is None:
            sys.modules.pop("common_gemini_client", None)
        else:
            sys.modules["common_gemini_client"] = self._old_module
        os.environ.clear()
        os.environ.update(self._old_env)

    def import_module(self):
        sys.modules.pop("common_gemini_client", None)
        return importlib.import_module("common_gemini_client")

    def test_generate_text_with_retry_uses_aos_cli_model_boundary(self):
        common_gemini_client = self.import_module()
        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            request = json.loads(Path(request_path).read_text(encoding="utf-8"))
            captured["request"] = request
            captured["cwd"] = Path(cwd)
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text", "text": " rewritten prompt "},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_text_with_retry(
                "rewrite this",
                label="rewrite_prompt",
                max_retries=1,
                model="asset-text-model",
            )

        self.assertEqual(result, "rewritten prompt")
        self.assertEqual(captured["cwd"], Path.cwd())
        self.assertEqual(captured["request"]["apiVersion"], "aos-cli.model/v1")
        self.assertEqual(captured["request"]["task"], "rewrite_prompt")
        self.assertEqual(captured["request"]["capability"], "generate")
        self.assertEqual(captured["request"]["output"], {"kind": "text"})
        self.assertEqual(captured["request"]["input"], {"content": "rewrite this"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "asset-text-model"})

    def test_generate_json_with_retry_uses_aos_cli_model_boundary(self):
        common_gemini_client = self.import_module()
        captured = {}

        def fake_run(request_path, response_path, cwd=None):
            captured["request"] = json.loads(Path(request_path).read_text(encoding="utf-8"))
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "json", "data": {"worldview_type": "科幻"}},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_json_with_retry(
                "analyze style",
                label="世界观分析",
                max_retries=1,
                model="asset-json-model",
            )

        self.assertEqual(result, {"worldview_type": "科幻"})
        self.assertEqual(captured["request"]["task"], "世界观分析")
        self.assertEqual(captured["request"]["output"], {"kind": "json"})
        self.assertEqual(captured["request"]["input"], {"content": "analyze style"})
        self.assertEqual(captured["request"]["modelPolicy"], {"model": "asset-json-model"})

    def test_generate_json_with_retry_parses_text_fallback(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {
                        "kind": "json",
                        "text": "```json\n{\"worldview_type\": \"奇幻\"}\n```",
                    },
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_json_with_retry("prompt", max_retries=1)

        self.assertEqual(result, {"worldview_type": "奇幻"})

    def test_aos_cli_wrong_output_kind_fails(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "json", "data": {"unexpected": True}},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "output.kind mismatch"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)

    def test_aos_cli_missing_text_field_fails(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing output.text"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)

    def test_generate_content_with_retry_returns_text(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": True,
                    "output": {"kind": "text", "text": "generated description"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            result = common_gemini_client.generate_content_with_retry("prompt", max_retries=1)

        self.assertEqual(result, "generated description")

    def test_aos_cli_failure_reports_error_message(self):
        common_gemini_client = self.import_module()

        def fake_run(request_path, response_path, cwd=None):
            Path(response_path).write_text(
                json.dumps({
                    "ok": False,
                    "error": {"code": "CONFIG_ERROR", "message": "missing key"},
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            return type("Completed", (), {"returncode": 0, "stderr": ""})()

        with patch.object(common_gemini_client, "aos_cli_model_run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "missing key"):
                common_gemini_client.generate_text_with_retry("prompt", max_retries=1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the new boundary tests**

Run: `cd .claude/skills/asset-gen/scripts && python3 -m unittest test_common_gemini_client -v`
Expected: 7 tests pass.

- [ ] **Step 3: Write `test_gemini_multimodal_legacy.py` (deferred path tests)**

Create `.claude/skills/asset-gen/scripts/test_gemini_multimodal_legacy.py` with:

```python
#!/usr/bin/env python3
# input: asset-gen gemini_multimodal_legacy + fake google.genai modules
# output: unittest assertions that deferred multimodal client builds expected SDK args
# pos: regression coverage for the deferred image+text review path
#
# Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
# These tests cover gemini_multimodal_legacy.py, which is intentionally excluded
# from the aos-cli migration guardrail because aos-cli model v1 does not yet
# define a multimodal review contract.

import importlib
import os
import sys
import types
import unittest
from unittest.mock import patch


class GeminiMultimodalLegacyTest(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)
        self._old_modules = {
            name: sys.modules.get(name)
            for name in (
                "google",
                "google.genai",
                "google.genai.types",
                "common_gemini_client",
                "gemini_multimodal_legacy",
            )
        }
        google_module = types.ModuleType("google")
        genai_module = types.ModuleType("google.genai")
        genai_types_module = types.ModuleType("google.genai.types")
        genai_module.Client = lambda **kwargs: object()
        genai_types_module.Part = type(
            "Part",
            (),
            {"from_bytes": staticmethod(lambda data, mime_type: (data, mime_type))},
        )
        google_module.genai = genai_module
        sys.modules["google"] = google_module
        sys.modules["google.genai"] = genai_module
        sys.modules["google.genai.types"] = genai_types_module
        os.environ["GEMINI_API_KEY"] = "chatfire-key"

    def tearDown(self):
        for name, module in self._old_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
        os.environ.clear()
        os.environ.update(self._old_env)

    def import_module(self):
        sys.modules.pop("common_gemini_client", None)
        sys.modules.pop("gemini_multimodal_legacy", None)
        return importlib.import_module("gemini_multimodal_legacy")

    def test_proxy_mode_uses_chatfire_key_and_base_url(self):
        legacy = self.import_module()
        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        backend_config = {
            "mode": "proxy",
            "model": "gemini-3.1-flash-lite-preview",
            "proxy": {
                "api_key": "",
                "api_key_env": "GEMINI_API_KEY",
                "base_url": "https://api.chatfire.cn/gemini",
            },
        }

        with patch.object(legacy.genai, "Client", fake_client):
            legacy.create_client(backend_config)

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertEqual(captured["http_options"]["base_url"], "https://api.chatfire.cn/gemini")

    def test_default_config_uses_official_gemini(self):
        legacy = self.import_module()
        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        with patch.object(legacy.genai, "Client", fake_client):
            legacy.create_client()

        self.assertEqual(captured["api_key"], "chatfire-key")
        self.assertNotIn("http_options", captured)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run the new deferred-path tests**

Run: `cd .claude/skills/asset-gen/scripts && python3 -m unittest test_gemini_multimodal_legacy -v`
Expected: 2 tests pass.

- [ ] **Step 5: Delete the original mixed-concern file**

Run: `git rm .claude/skills/asset-gen/scripts/test_chatfire_gemini_client.py`
Expected: file is staged for deletion.

- [ ] **Step 6: Verify nothing else references the old test name**

Run: `grep -rn "test_chatfire_gemini_client" .claude/ docs/ 2>/dev/null | grep -v "/__pycache__/" || echo "no references"`
Expected: `no references`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/asset-gen/scripts/test_common_gemini_client.py \
        .claude/skills/asset-gen/scripts/test_gemini_multimodal_legacy.py
git commit -m "test(asset-gen): split chatfire test into migrated + deferred suites"
```

---

## Task 6: Annotate `video-gen/assets/config.json` gemini block as deferred

**Files:**
- Modify: `.claude/skills/video-gen/assets/config.json`

- [ ] **Step 1: Add `_boundary_note` field to the gemini block**

Open `.claude/skills/video-gen/assets/config.json`. Locate the `"gemini": {` block. Replace it with:

```json
  "gemini": {
    "_boundary_note": "Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md. These keys are consumed only by analyzer.py and frame_extractor.describe_frame_with_gemini, which remain on the direct Gemini SDK pending aos-cli protocol expansion.",
    "base_url": "https://api.chatfire.cn/gemini",
    "api_key": "",
    "api_key_env": "GEMINI_API_KEY",
    "api_key_note": "Set GEMINI_API_KEY to the ChatFire key value (used by deferred multimodal review only)",
    "model": "gemini-3.1-pro-preview",
    "review_model": "gemini-3.1-pro-preview",
    "color_removal_model": "gemini-3.1-pro-preview",
    "max_workers": 2,
    "thresholds": {
      "reference_consistency_min": 6,
      "prompt_compliance_min": 6
    }
  },
```

- [ ] **Step 2: Verify JSON parses and marker present**

Run: `python3 -c "import json; d=json.load(open('.claude/skills/video-gen/assets/config.json')); assert 'Model boundary note: deferred multimodal' in d['gemini']['_boundary_note']; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Verify config_loader still loads it**

Run: `cd .claude/skills/video-gen/scripts && python3 -c "import config_loader; cfg = config_loader.get_gemini_config(); assert cfg.get('model'); print('ok')"`
Expected: `ok`. (If the loader rejects unknown keys it must be fixed to ignore `_boundary_note`; current loader merges keys passthrough so this should just work.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/video-gen/assets/config.json
git commit -m "docs(video-gen): annotate config.json gemini block as deferred-only"
```

---

## Task 7: Annotate `asset-gen/assets/common/gemini_backend.json` as deferred

**Files:**
- Modify: `.claude/skills/asset-gen/assets/common/gemini_backend.json`

- [ ] **Step 1: Add `_boundary_note` field**

Replace the file contents with:

```json
{
  "_boundary_note": "Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md. Consumed by gemini_multimodal_legacy.py for review_scene/char/props.py image+text review, which stays on the direct Gemini SDK pending aos-cli protocol expansion.",
  "mode": "official",
  "model": "gemini-3.1-flash-lite-preview",
  "proxy": {
    "api_key": "",
    "api_key_env": "GEMINI_API_KEY",
    "base_url": "https://api.chatfire.cn/gemini"
  },
  "review": {
    "models": [
      "gemini-3.1-flash-lite-preview"
    ],
    "retry_attempts": 2,
    "retry_sleep_seconds": 3
  },
  "official": {
    "api_key": "",
    "api_key_env": "GEMINI_API_KEY"
  }
}
```

- [ ] **Step 2: Verify JSON parses and marker present**

Run: `python3 -c "import json; d=json.load(open('.claude/skills/asset-gen/assets/common/gemini_backend.json')); assert 'Model boundary note: deferred multimodal' in d['_boundary_note']; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Verify legacy loader still reads it**

Run: `cd .claude/skills/asset-gen/scripts && python3 -c "import sys, types; g=types.ModuleType('google'); gn=types.ModuleType('google.genai'); g.genai=gn; sys.modules['google']=g; sys.modules['google.genai']=gn; sys.modules['google.genai.types']=types.ModuleType('google.genai.types'); from common_gemini_client import _load_backend_config; cfg=_load_backend_config(); assert cfg.get('mode'); print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/asset-gen/assets/common/gemini_backend.json
git commit -m "docs(asset-gen): annotate gemini_backend.json as deferred multimodal"
```

---

## Task 8: Harden the guardrail to enforce deferred annotations + update protocol doc

**Files:**
- Modify: `.claude/skills/_shared/test_no_new_direct_provider_calls.py`
- Modify: `.claude/skills/_shared/AOS_CLI_MODEL.md`

- [ ] **Step 1: Write the new failing guardrail test**

Open `.claude/skills/_shared/test_no_new_direct_provider_calls.py`. After the existing `FORBIDDEN_TEXT_SNIPPETS` constant, add:

```python
DEFERRED_MULTIMODAL_PATHS = [
    ".claude/skills/video-gen/scripts/analyzer.py",
    ".claude/skills/video-gen/scripts/frame_extractor.py",
    ".claude/skills/video-gen/scripts/config_loader.py",
    ".claude/skills/video-gen/assets/config.json",
    ".claude/skills/asset-gen/assets/common/gemini_backend.json",
    ".claude/skills/asset-gen/scripts/gemini_multimodal_legacy.py",
    ".claude/skills/asset-gen/scripts/review_scene.py",
    ".claude/skills/asset-gen/scripts/review_char.py",
    ".claude/skills/asset-gen/scripts/review_props.py",
    ".claude/skills/video-editing/scripts/phase1_analyze.py",
    ".claude/skills/video-editing/scripts/phase2_assemble.py",
    ".claude/skills/music-matcher/scripts/analyze_video.py",
    ".claude/skills/music-matcher/scripts/batch_analyze.py",
    ".claude/skills/subtitle-maker/scripts/phase2_transcribe.py",
]

DEFERRED_MARKER = "Model boundary note: deferred multimodal"
```

Then add this method inside `class DirectProviderGuardrailTests`:

```python
    def test_deferred_paths_carry_boundary_note(self) -> None:
        violations: list[str] = []
        for relative_path in DEFERRED_MULTIMODAL_PATHS:
            path = REPO_ROOT / relative_path
            if not path.exists():
                violations.append(f"{relative_path}: missing")
                continue
            text = path.read_text(encoding="utf-8")
            if DEFERRED_MARKER not in text:
                violations.append(f"{relative_path}: missing '{DEFERRED_MARKER}'")
        self.assertEqual(violations, [])
```

- [ ] **Step 2: Run the guardrail test**

Run: `cd .claude/skills/_shared && python3 -m unittest test_no_new_direct_provider_calls -v`
Expected: all three tests pass (existing two + new `test_deferred_paths_carry_boundary_note`).

If the new test fails, the failure message lists which file is missing the marker — fix that file (Tasks 1–7 should already cover all listed paths; the legacy/review/post-production files were annotated by the prior plan or are documented as deferred in `AOS_CLI_MODEL.md`. Verify each survives a `grep -l "Model boundary note: deferred multimodal"` check; if any preexisting deferred file lacks the marker, add the same module-level note used in Task 1).

- [ ] **Step 3: Append a deferred-paths registry to `AOS_CLI_MODEL.md`**

Open `.claude/skills/_shared/AOS_CLI_MODEL.md`. Append at the end of the file:

```markdown

## Deferred Paths Registry

The following files remain on direct provider SDKs because the current `aos-cli model` v1 protocol does not yet cover their multimodal/Files-API/ASR input contracts. Each one carries the marker `Model boundary note: deferred multimodal` (or a `_boundary_note` field for JSON configs) and is enforced by `_shared/test_no_new_direct_provider_calls.py::test_deferred_paths_carry_boundary_note`.

- `.claude/skills/video-gen/scripts/analyzer.py` — multimodal video review
- `.claude/skills/video-gen/scripts/frame_extractor.py` — image+text frame description
- `.claude/skills/video-gen/scripts/config_loader.py` — config surface for the two above
- `.claude/skills/video-gen/assets/config.json` — `gemini` block consumed by the two above
- `.claude/skills/asset-gen/assets/common/gemini_backend.json` — deferred review backend config
- `.claude/skills/asset-gen/scripts/gemini_multimodal_legacy.py` — deferred image+text helper
- `.claude/skills/asset-gen/scripts/review_scene.py` / `review_char.py` / `review_props.py` — image+text review
- `.claude/skills/video-editing/scripts/phase1_analyze.py` / `phase2_assemble.py` — Gemini Files API video analysis
- `.claude/skills/music-matcher/scripts/analyze_video.py` / `batch_analyze.py` — multimodal music matching
- `.claude/skills/subtitle-maker/scripts/phase2_transcribe.py` — ASR

Migrate an entry off this list only after `aos-cli model` exposes a stable contract for its required input/output shape, and update both this registry and the guardrail test in the same change.
```

- [ ] **Step 4: Re-run the guardrail to confirm green**

Run: `cd .claude/skills/_shared && python3 -m unittest test_no_new_direct_provider_calls -v`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full follow-up test surface**

Run:
```bash
cd .claude/skills/_shared && python3 -m unittest test_no_new_direct_provider_calls -v && \
cd ../asset-gen/scripts && python3 -m unittest test_common_gemini_client test_gemini_multimodal_legacy -v
```
Expected: all suites green.

- [ ] **Step 6: Final audit grep — only deferred paths should show direct SDK use**

Run:
```bash
grep -rln "from google import genai\|from google.genai" .claude/skills/ \
  | grep -v "/__pycache__/" \
  | sort
```
Expected output: only files in `DEFERRED_MULTIMODAL_PATHS` (plus `test_gemini_multimodal_legacy.py` which fakes the modules — that file should NOT appear because it patches `sys.modules` rather than importing). Exact expected list:

```
.claude/skills/asset-gen/scripts/gemini_multimodal_legacy.py
.claude/skills/asset-gen/scripts/review_char.py
.claude/skills/asset-gen/scripts/review_props.py
.claude/skills/asset-gen/scripts/review_scene.py
.claude/skills/music-matcher/scripts/analyze_video.py
.claude/skills/music-matcher/scripts/batch_analyze.py
.claude/skills/subtitle-maker/scripts/phase2_transcribe.py
.claude/skills/video-editing/scripts/phase1_analyze.py
.claude/skills/video-editing/scripts/phase2_assemble.py
.claude/skills/video-gen/scripts/analyzer.py
.claude/skills/video-gen/scripts/frame_extractor.py
```

If any non-deferred file appears, that file must either be migrated or added to the registry — do not silence the guardrail.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/_shared/test_no_new_direct_provider_calls.py \
        .claude/skills/_shared/AOS_CLI_MODEL.md
git commit -m "test(_shared): enforce deferred multimodal annotation + register paths"
```

---

## Self-Review

- **Spec coverage:** (1) video-gen scripts — Tasks 1, 2, 3 (annotate, not migrate, per AOS_CLI_MODEL.md:188); (2) script-writer — Task 4 (delete the dead env check, since no SDK call exists in script-writer); (3) legacy provider keys — Tasks 6, 7 (annotate; the keys remain because deferred consumers still need them); (4) `test_chatfire_gemini_client.py` — Task 5 (split, not delete; both halves are valid). Guardrail enforcement and protocol registry — Task 8.
- **Placeholder scan:** every step has exact paths, exact commands, complete code. No "TBD"/"similar to" / "implement later" markers.
- **Type consistency:** the marker string `Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md` is identical across Tasks 1–8, and the substring asserted by the guardrail (`Model boundary note: deferred multimodal`) is a strict prefix of that string. The test list in Task 8 enumerates the same paths annotated in Tasks 1–7 plus the previously-deferred files documented in the original migration plan.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-skills-aos-cli-migration-followup.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
