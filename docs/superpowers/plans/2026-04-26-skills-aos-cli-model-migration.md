# Skills aos-cli Model Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Route AgentOS skill model calls through the stable `aos-cli model` boundary where the current protocol is sufficient, while explicitly deferring provider-specific multimodal paths that need protocol expansion.

**Architecture:** Keep AgentOS skills responsible for business semantics, prompt construction, workspace state, artifact lifecycle, and approval gates. Skill scripts call `.claude/skills/_shared/aos_cli_model.py`, which launches `aos-cli model` as a subprocess and returns `subprocess.CompletedProcess`; scripts then read normalized JSON envelopes from response files and map them back into existing skill contracts. Migrate in dependency order: storyboard text/JSON first, asset text/JSON second, asset image third, video submit/poll fourth, then document deferred multimodal and ASR paths.

**Tech Stack:** Python 3.11+, `uv`, `unittest`/`pytest`, JSON file contracts, `.claude/skills/_shared/aos_cli_model.py`, `aos-cli model run`, `aos-cli model submit`, `aos-cli model poll`, `aos-cli model validate`.

---

## Audit Findings Integrated

- Text/JSON migration targets:
  - `.claude/skills/storyboard/scripts/storyboard_batch.py`: replace `GeminiStoryboardClient.generate()`, `ChatFireStoryboardClient.generate()`, and `load_storyboard_client()` provider selection with a single `StoryboardModelClient` using `generate` + `output.kind=json`.
  - `.claude/skills/asset-gen/scripts/common_gemini_client.py`: replace `create_client()`, `generate_content_with_retry()`, and `rewrite_prompt()` direct Gemini usage with `aos-cli model run` while preserving compatibility for existing callers.
  - `.claude/skills/asset-gen/scripts/generate_prompts_from_script.py`: keep business mapping; its Gemini use is indirect through `common_gemini_client.py`.
  - `.claude/skills/asset-gen/scripts/style_generate.py`: migrate direct style JSON generation to the shared text/JSON client.
- Multimodal text-review targets are deferred:
  - `.claude/skills/asset-gen/scripts/review_scene.py`
  - `.claude/skills/asset-gen/scripts/review_char.py`
  - `.claude/skills/asset-gen/scripts/review_props.py`
  - These use image+text review semantics; current shared usage guide does not define an explicit `generate` image-input contract for them.
- Image migration targets:
  - `.claude/skills/asset-gen/scripts/common_image_api.py`: replace direct OpenAI-compatible `/v1/images/generations` with `image.generate` + `output.kind=artifact`.
  - Preserve the public async-ish contract consumed by `generate_characters.py`, `generate_scenes.py`, and `generate_props.py`: `submit_image_task()`, `check_task_once()` / `poll_image_task()`, and `download_image()`.
- Video migration targets:
  - `.claude/skills/video-gen/scripts/video_api.py`: replace `submit_ark_video_task()` and `poll_ark_video_task()` raw Ark HTTP paths with `aos_cli_model_submit()` and `aos_cli_model_poll()`.
  - Preserve `submit_video()` and `poll_multiple_tasks()` runtime-facing behavior for `.claude/skills/video-gen/scripts/batch_generate_runtime.py`, including `task_id`, `provider`, `model_code`, `video_url`, `video_path`, and `last_frame_url` when present.
- Post-production migration is deferred:
  - `.claude/skills/video-editing/scripts/phase1_analyze.py`
  - `.claude/skills/video-editing/scripts/phase2_assemble.py`
  - `.claude/skills/music-matcher/scripts/analyze_video.py`
  - `.claude/skills/music-matcher/scripts/batch_analyze.py`
  - `.claude/skills/subtitle-maker/scripts/phase2_transcribe.py`
  - These depend on Gemini Files API upload/processing lifecycle, large media transport, and provider-specific settings not yet represented in the `aos-cli model` protocol.

## File Structure

- Create `.claude/skills/_shared/test_no_new_direct_provider_calls.py`
  - Guard migrated scripts against reintroducing direct provider SDK/API imports and raw provider endpoints.
- Modify `.claude/skills/storyboard/scripts/storyboard_batch.py`
  - Replace direct Gemini/ChatFire text generation with `aos-cli model run` for `generate` + `output.kind=json`.
  - Preserve storyboard batching, prompt construction, parsing into storyboard files, and failure messages.
- Modify `.claude/skills/storyboard/scripts/test_storyboard_batch.py`
  - Assert storyboard generation writes a valid `aos-cli` request envelope and reads the normalized response envelope.
- Modify `.claude/skills/storyboard/SKILL.md`
  - Replace provider-specific setup text with `aos-cli model preflight` guidance.
- Modify `.claude/skills/asset-gen/scripts/common_gemini_client.py`
  - Convert text/JSON generation wrapper to `aos-cli model run` while keeping existing public helper names usable by callers.
- Modify `.claude/skills/asset-gen/scripts/generate_prompts_from_script.py`
  - Keep prompt business mapping but call the migrated text client where signatures require it.
- Modify `.claude/skills/asset-gen/scripts/style_generate.py`
  - Replace direct `create_client()` + `generate_content()` style generation with the migrated JSON client.
- Modify `.claude/skills/asset-gen/scripts/common_image_api.py`
  - Replace OpenAI-compatible image calls with `aos-cli model run` for `image.generate` + `output.kind=artifact`.
  - Map normalized artifacts back into existing `submit_image_task()` / `check_task_once()` / `poll_image_task()` output fields.
- Modify `.claude/skills/asset-gen/scripts/generate_characters.py`, `.claude/skills/asset-gen/scripts/generate_scenes.py`, `.claude/skills/asset-gen/scripts/generate_props.py`
  - Keep asset naming and metadata lifecycle while consuming normalized artifact descriptors through the existing image API contract.
- Modify `.claude/skills/asset-gen/SKILL.md` and `.claude/skills/asset-gen/references/troubleshooting.md`
  - Replace direct ChatFire/OpenAI/Gemini instructions with `aos-cli model` instructions and mark old provider names as legacy.
- Modify or create `.claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py`
  - Cover text request envelope construction, style JSON generation, and image artifact response handling without provider SDK imports.
- Modify `.claude/skills/video-gen/scripts/video_api.py`
  - Replace direct Ark submit/poll HTTP calls with `aos-cli model submit` and `aos-cli model poll`.
- Modify `.claude/skills/video-gen/scripts/test_provider_switch.py`
  - Replace provider-switch assertions with boundary-call and compatibility mapping assertions.
- Modify `.claude/skills/video-gen/SKILL.md` and `.claude/skills/video-gen/references/AI_CONFIG_AND_DELIVERY.md`
  - Replace Ark/ChatFire direct-provider instructions with `aos-cli model preflight` and manual test script references.
- Modify `.claude/skills/video-editing/SKILL.md`, `.claude/skills/music-matcher/SKILL.md`, `.claude/skills/subtitle-maker/SKILL.md`
  - Mark direct Gemini multimodal/ASR calls as intentionally deferred migration targets until `aos-cli` protocol expansion covers their input/output shape.
- Modify `.claude/skills/_shared/AOS_CLI_MODEL.md`
  - Add explicit guidance not to force multimodal/video/audio workflows through generic `generate` until protocol coverage exists.

## Parallelization Decision

Implementation should stay serial because tasks share the same boundary adapter, response envelope assumptions, provider-call guardrail, and compatibility mappings. Parallel code changes would create a high chance of inconsistent request shapes, duplicated helper logic, or partial guardrail enforcement.

Safe parallel work:

- Read-only audits may run in parallel by domain: text/JSON, image/video generation, and post-production analysis.
- Documentation-only review may run in parallel after code tasks finish.

Unsafe parallel work:

- Do not migrate `storyboard` and `asset-gen` text clients in parallel; both establish request/response envelope conventions for later tasks.
- Do not migrate `asset-gen` image and `video-gen` submit/poll before text/JSON response handling and guardrail patterns are settled.
- Do not migrate post-production analysis until `aos-cli` protocol explicitly supports large media upload/process handles and the required ASR/multimodal schemas.

---

### Task 1: Add direct-provider guardrail scaffold

**Files:**
- Create: `.claude/skills/_shared/test_no_new_direct_provider_calls.py`

- [x] **Step 1: Write the initial guardrail test for storyboard only**

Create `.claude/skills/_shared/test_no_new_direct_provider_calls.py`:

```python
# input: migrated skill script source files
# output: guardrail tests preventing direct provider SDK/API reintroduction
# pos: migration safety net for the aos-cli model boundary

from __future__ import annotations

import ast
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]

MIGRATED_SCRIPT_PATHS = [
    ".claude/skills/storyboard/scripts/storyboard_batch.py",
]

FORBIDDEN_IMPORT_PREFIXES = (
    "google",
    "openai",
)

FORBIDDEN_TEXT_SNIPPETS = (
    "generate_content(",
    "/v1/images/generations",
    "ARK_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
)


def _matches_prefix(name: str, prefixes: tuple[str, ...]) -> bool:
    return any(name == prefix or name.startswith(f"{prefix}.") for prefix in prefixes)


class DirectProviderGuardrailTests(unittest.TestCase):
    def test_migrated_scripts_do_not_import_provider_sdks(self) -> None:
        violations: list[str] = []
        for relative_path in MIGRATED_SCRIPT_PATHS:
            path = REPO_ROOT / relative_path
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if _matches_prefix(alias.name, FORBIDDEN_IMPORT_PREFIXES):
                            violations.append(f"{relative_path}: import {alias.name}")
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    if _matches_prefix(module, FORBIDDEN_IMPORT_PREFIXES):
                        violations.append(f"{relative_path}: from {module} import ...")

        self.assertEqual(violations, [])

    def test_migrated_scripts_do_not_reference_raw_provider_contracts(self) -> None:
        violations: list[str] = []
        for relative_path in MIGRATED_SCRIPT_PATHS:
            source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
            for snippet in FORBIDDEN_TEXT_SNIPPETS:
                if snippet in source:
                    violations.append(f"{relative_path}: {snippet}")

        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 2: Run the guardrail test and verify it fails**

Run:

```bash
uv run python -m unittest discover -s .claude/skills/_shared -p 'test_no_new_direct_provider_calls.py' -v
```

Expected: FAIL because `storyboard_batch.py` still contains direct Gemini/ChatFire provider references.

- [x] **Step 3: Do not commit the failing guardrail yet**

Keep the file uncommitted until Task 2 removes storyboard violations and the test passes.

---

### Task 2: Migrate storyboard text/JSON generation

**Files:**
- Modify: `.claude/skills/storyboard/scripts/storyboard_batch.py`
- Modify: `.claude/skills/storyboard/scripts/test_storyboard_batch.py`
- Modify: `.claude/skills/storyboard/SKILL.md`
- Modify: `.claude/skills/_shared/test_no_new_direct_provider_calls.py`

- [x] **Step 1: Add aos-cli response fixture test for storyboard generation**

In `.claude/skills/storyboard/scripts/test_storyboard_batch.py`, add:

```python
def test_storyboard_generator_uses_aos_cli_json_boundary(tmp_path, monkeypatch):
    import json
    import storyboard_batch

    calls = []

    def fake_run(request_path, response_path, *, cwd=None):
        calls.append((request_path, response_path, cwd))
        request = json.loads(request_path.read_text(encoding="utf-8"))
        assert request["apiVersion"] == "aos-cli.model/v1"
        assert request["capability"] == "generate"
        assert request["output"]["kind"] == "json"
        assert request["task"] == "storyboard.batch"
        response_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "storyboard.batch",
                    "capability": "generate",
                    "output": {
                        "kind": "json",
                        "data": {
                            "scenes": [
                                {
                                    "id": "scn001",
                                    "shots": [
                                        {"id": "shot001", "prompt": "Moonlit courtyard wide shot"}
                                    ],
                                }
                            ]
                        },
                    },
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(storyboard_batch, "aos_cli_model_run", fake_run)

    client = storyboard_batch.StoryboardModelClient(project_dir=tmp_path)
    result = client.generate(
        system_prompt="Return JSON.",
        user_content="Scene text",
        model="test-model",
    )

    assert calls
    assert result["scenes"][0]["shots"][0]["prompt"] == "Moonlit courtyard wide shot"
```

- [x] **Step 2: Run the new storyboard test and verify it fails**

Run:

```bash
uv run pytest .claude/skills/storyboard/scripts/test_storyboard_batch.py::test_storyboard_generator_uses_aos_cli_json_boundary -v
```

Expected: FAIL because `StoryboardModelClient` does not exist and direct provider clients are still used.

- [x] **Step 3: Implement minimal storyboard boundary client**

In `.claude/skills/storyboard/scripts/storyboard_batch.py`, replace `GeminiStoryboardClient`, `ChatFireStoryboardClient`, and `load_storyboard_client()` provider selection with this boundary client:

```python
from pathlib import Path
import json
import os
import sys
import tempfile

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


class StoryboardModelClient:
    def __init__(self, project_dir: Path) -> None:
        self.project_dir = Path(project_dir)

    def generate(self, system_prompt: str, user_content: str, model: str | None = None) -> dict:
        request = {
            "apiVersion": "aos-cli.model/v1",
            "task": "storyboard.batch",
            "capability": "generate",
            "output": {"kind": "json"},
            "input": {"system": system_prompt, "content": user_content},
            "options": {
                "temperature": float(os.environ.get("STORYBOARD_TEXT_TEMPERATURE", "0.6")),
                "maxOutputTokens": int(os.environ.get("STORYBOARD_TEXT_MAX_OUTPUT_TOKENS", "2000")),
            },
        }
        if model:
            request["modelPolicy"] = {"model": model}

        with tempfile.TemporaryDirectory(prefix="storyboard-aos-cli-") as tmp:
            request_path = Path(tmp) / "request.json"
            response_path = Path(tmp) / "response.json"
            request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
            completed = aos_cli_model_run(request_path, response_path, cwd=self.project_dir)
            if completed.returncode != 0:
                raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
            response = json.loads(response_path.read_text(encoding="utf-8"))

        if not response.get("ok"):
            error = response.get("error", {})
            raise RuntimeError(error.get("message") or "aos-cli model generation failed")
        output = response.get("output", {})
        if output.get("kind") != "json":
            raise RuntimeError("aos-cli returned non-json output for storyboard generation")
        return output.get("data", {})


def load_storyboard_client(project_dir: Path):
    return StoryboardModelClient(project_dir=project_dir)
```

Then update the existing call site that creates the client so it passes the current project directory into `load_storyboard_client(project_dir)`.

- [x] **Step 4: Preserve scene prompt normalization**

In `generate_scene_prompt()`, remove `parse_json_loose(text)` around provider text. The client now returns parsed JSON data:

```python
raw = client.generate(
    system_prompt=system_prompt,
    user_content=(
        f"导演笔记:\n{ep_notes}\n\n"
        f"场景 JSON:\n{json.dumps(scene, ensure_ascii=False)}\n\n"
        "请只输出 JSON 数组或对象，最终会被规范化为 "
        "[{\"source_refs\": [\"beat_id\"], \"prompt\": \"...\"}]。"
    ),
    model=model,
)
return normalize_scene_shots(raw, scene)
```

- [x] **Step 5: Update storyboard docs**

In `.claude/skills/storyboard/SKILL.md`, replace direct Gemini/ChatFire setup text with:

```markdown
Model calls go through `aos-cli model`. Before running storyboard generation, verify runtime readiness with:

```bash
uv run --project aos-cli aos-cli model preflight --json
```

Storyboard text/JSON generation uses `generate` with `output.kind=json` through `.claude/skills/_shared/aos_cli_model.py`.
```

- [x] **Step 6: Run storyboard tests and guardrail**

Run:

```bash
uv run pytest .claude/skills/storyboard/scripts/test_storyboard_batch.py -v
uv run python -m unittest discover -s .claude/skills/_shared -p 'test_no_new_direct_provider_calls.py' -v
```

Expected: PASS.

- [x] **Step 7: Commit storyboard migration and initial guardrail**

```bash
git add .claude/skills/storyboard/scripts/storyboard_batch.py .claude/skills/storyboard/scripts/test_storyboard_batch.py .claude/skills/storyboard/SKILL.md .claude/skills/_shared/test_no_new_direct_provider_calls.py
git commit -m "Route storyboard generation through aos-cli model"
```

---

### Task 3: Migrate asset-gen text/JSON generation

**Files:**
- Modify: `.claude/skills/asset-gen/scripts/common_gemini_client.py`
- Modify: `.claude/skills/asset-gen/scripts/generate_prompts_from_script.py`
- Modify: `.claude/skills/asset-gen/scripts/style_generate.py`
- Create or modify: `.claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py`
- Modify: `.claude/skills/_shared/test_no_new_direct_provider_calls.py`

- [x] **Step 1: Extend guardrail to asset text scripts**

In `.claude/skills/_shared/test_no_new_direct_provider_calls.py`, update `MIGRATED_SCRIPT_PATHS`:

```python
MIGRATED_SCRIPT_PATHS = [
    ".claude/skills/storyboard/scripts/storyboard_batch.py",
    ".claude/skills/asset-gen/scripts/common_gemini_client.py",
    ".claude/skills/asset-gen/scripts/generate_prompts_from_script.py",
    ".claude/skills/asset-gen/scripts/style_generate.py",
]
```

- [x] **Step 2: Add asset text boundary tests**

Create `.claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py`:

```python
# input: asset generation model client code
# output: tests for aos-cli text/json and image boundary calls
# pos: migration tests for asset-gen provider boundary

from __future__ import annotations

import json
from pathlib import Path

import common_gemini_client


def test_generate_content_with_retry_writes_generate_text_request(tmp_path, monkeypatch):
    calls = []

    def fake_run(request_path, response_path, *, cwd=None):
        calls.append((request_path, response_path, cwd))
        request = json.loads(Path(request_path).read_text(encoding="utf-8"))
        assert request["apiVersion"] == "aos-cli.model/v1"
        assert request["capability"] == "generate"
        assert request["output"]["kind"] == "text"
        response_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "asset-gen.text",
                    "capability": "generate",
                    "output": {"kind": "text", "text": "Moonlit costume concept"},
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(common_gemini_client, "aos_cli_model_run", fake_run)

    text = common_gemini_client.generate_content_with_retry(
        "Write a prompt.",
        label="asset prompt",
        project_dir=tmp_path,
    )

    assert calls
    assert text == "Moonlit costume concept"


def test_generate_json_writes_generate_json_request(tmp_path, monkeypatch):
    def fake_run(request_path, response_path, *, cwd=None):
        request = json.loads(Path(request_path).read_text(encoding="utf-8"))
        assert request["output"]["kind"] == "json"
        response_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "asset-gen.style",
                    "capability": "generate",
                    "output": {"kind": "json", "data": {"style": "cinematic"}},
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(common_gemini_client, "aos_cli_model_run", fake_run)

    result = common_gemini_client.generate_json_with_retry(
        system="Return JSON.",
        content={"project": "demo"},
        task="asset-gen.style",
        project_dir=tmp_path,
    )

    assert result == {"style": "cinematic"}
```

- [x] **Step 3: Run asset text tests and verify they fail**

Run:

```bash
uv run pytest .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py::test_generate_content_with_retry_writes_generate_text_request .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py::test_generate_json_writes_generate_json_request -v
```

Expected: FAIL because `common_gemini_client.py` still uses direct Gemini code and does not expose `generate_json_with_retry()`.

- [x] **Step 4: Replace direct text provider wrapper with aos-cli boundary**

In `.claude/skills/asset-gen/scripts/common_gemini_client.py`, preserve existing helper names where callers use them and add JSON support:

```python
# input: asset-gen prompt/review requests
# output: normalized JSON/text generation through aos-cli model
# pos: text model boundary adapter for asset-gen scripts

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


def generate_content_with_retry(
    prompt: str,
    *,
    label: str = "Gemini generation",
    max_retries: int = 3,
    base_delay: float = 2.0,
    project_dir: str | Path | None = None,
    task: str = "asset-gen.text",
) -> str:
    response = _run_aos_cli_model(
        task=task,
        output_kind="text",
        system="You write concise production prompts.",
        content=prompt,
        project_dir=project_dir,
    )
    output = response.get("output", {})
    if output.get("kind") != "text":
        raise RuntimeError("aos-cli returned non-text output for asset-gen")
    return str(output.get("text", ""))


def rewrite_prompt(prompt: str, *, project_dir: str | Path | None = None) -> str:
    return generate_content_with_retry(
        prompt,
        label="prompt rewrite",
        project_dir=project_dir,
        task="asset-gen.prompt.rewrite",
    )


def generate_json_with_retry(
    *,
    system: str,
    content: Any,
    task: str,
    project_dir: str | Path | None = None,
) -> Any:
    response = _run_aos_cli_model(
        task=task,
        output_kind="json",
        system=system,
        content=content,
        project_dir=project_dir,
    )
    output = response.get("output", {})
    if output.get("kind") != "json":
        raise RuntimeError("aos-cli returned non-json output for asset-gen")
    return output.get("data")


def _run_aos_cli_model(
    *,
    task: str,
    output_kind: str,
    system: str,
    content: Any,
    project_dir: str | Path | None,
) -> dict[str, Any]:
    working_dir = Path(project_dir or os.getcwd()).resolve()
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "generate",
        "output": {"kind": output_kind},
        "input": {"system": system, "content": content},
        "options": {
            "temperature": float(os.environ.get("ASSET_TEXT_TEMPERATURE", "0.4")),
            "maxOutputTokens": int(os.environ.get("ASSET_TEXT_MAX_OUTPUT_TOKENS", "2000")),
        },
    }
    model = os.environ.get("ASSET_TEXT_MODEL")
    if model:
        request["modelPolicy"] = {"model": model}

    with tempfile.TemporaryDirectory(prefix="asset-gen-aos-cli-") as tmp:
        request_path = Path(tmp) / "request.json"
        response_path = Path(tmp) / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=working_dir)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        response = json.loads(response_path.read_text(encoding="utf-8"))

    if not response.get("ok"):
        error = response.get("error", {})
        raise RuntimeError(error.get("message") or "aos-cli model generation failed")
    return response
```

- [x] **Step 5: Update asset text callers only where signatures require it**

In `.claude/skills/asset-gen/scripts/generate_prompts_from_script.py`, preserve the existing business functions and replace any direct `json.loads(generate_content_with_retry(...))` pattern with:

```python
result = generate_json_with_retry(
    system=system_prompt,
    content=user_payload,
    task="asset-gen.prompts",
    project_dir=project_dir,
)
```

In `.claude/skills/asset-gen/scripts/style_generate.py`, replace direct `create_client()` / `client.models.generate_content(...)` with:

```python
style = generate_json_with_retry(
    system=system_prompt,
    content=user_payload,
    task="asset-gen.style",
    project_dir=project_dir,
)
```

Do not modify `review_scene.py`, `review_char.py`, or `review_props.py` in this task; those image+text review paths are deferred in Task 6.

- [x] **Step 6: Run asset text tests and guardrail**

Run:

```bash
uv run pytest .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py -v
uv run python -m unittest discover -s .claude/skills/_shared -p 'test_no_new_direct_provider_calls.py' -v
```

Expected: PASS for the text tests and guardrail paths listed so far.

- [x] **Step 7: Commit asset text migration**

```bash
git add .claude/skills/asset-gen/scripts/common_gemini_client.py .claude/skills/asset-gen/scripts/generate_prompts_from_script.py .claude/skills/asset-gen/scripts/style_generate.py .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py .claude/skills/_shared/test_no_new_direct_provider_calls.py
git commit -m "Route asset text generation through aos-cli model"
```

---

### Task 4: Migrate asset-gen image generation

**Files:**
- Modify: `.claude/skills/asset-gen/scripts/common_image_api.py`
- Modify: `.claude/skills/asset-gen/scripts/generate_characters.py`
- Modify: `.claude/skills/asset-gen/scripts/generate_scenes.py`
- Modify: `.claude/skills/asset-gen/scripts/generate_props.py`
- Modify: `.claude/skills/asset-gen/SKILL.md`
- Modify: `.claude/skills/asset-gen/references/troubleshooting.md`
- Modify: `.claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py`
- Modify: `.claude/skills/_shared/test_no_new_direct_provider_calls.py`

- [x] **Step 1: Extend guardrail to asset image API**

In `.claude/skills/_shared/test_no_new_direct_provider_calls.py`, update `MIGRATED_SCRIPT_PATHS`:

```python
MIGRATED_SCRIPT_PATHS = [
    ".claude/skills/storyboard/scripts/storyboard_batch.py",
    ".claude/skills/asset-gen/scripts/common_gemini_client.py",
    ".claude/skills/asset-gen/scripts/generate_prompts_from_script.py",
    ".claude/skills/asset-gen/scripts/style_generate.py",
    ".claude/skills/asset-gen/scripts/common_image_api.py",
]
```

- [x] **Step 2: Add image boundary compatibility test**

Append to `.claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py`:

```python
import common_image_api


def test_image_api_preserves_submit_and_poll_contract(tmp_path, monkeypatch):
    def fake_run(request_path, response_path, *, cwd=None):
        request = json.loads(Path(request_path).read_text(encoding="utf-8"))
        assert request["apiVersion"] == "aos-cli.model/v1"
        assert request["capability"] == "image.generate"
        assert request["output"]["kind"] == "artifact"
        assert request["artifactPolicy"]["download"] is True
        response_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "asset-gen.image",
                    "capability": "image.generate",
                    "output": {
                        "kind": "artifact",
                        "artifacts": [
                            {
                                "kind": "image",
                                "uri": "file:///tmp/actor.png",
                                "remoteUrl": "https://example.test/actor.png",
                                "mimeType": "image/png",
                                "sha256": "abc",
                                "bytes": 3,
                                "role": "character.front",
                            }
                        ],
                    },
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(common_image_api, "aos_cli_model_run", fake_run)

    task_id = common_image_api.submit_image_task(
        model_code="ignored-by-boundary",
        prompt="Moonlit portrait",
        params={"local_dir": str(tmp_path), "role": "character.front"},
        project_dir=tmp_path,
    )
    result = common_image_api.check_task_once(task_id)

    assert result["status"] == "succeeded"
    assert result["result_urls"] == ["file:///tmp/actor.png"]
    assert result["display_urls"] == ["https://example.test/actor.png"]
    assert result["artifacts"][0]["sha256"] == "abc"
```

- [x] **Step 3: Run image boundary test and verify it fails**

Run:

```bash
uv run pytest .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py::test_image_api_preserves_submit_and_poll_contract -v
```

Expected: FAIL because `common_image_api.py` still uses the direct OpenAI-compatible API and does not accept `project_dir`.

- [x] **Step 4: Replace image API internals while preserving public functions**

In `.claude/skills/asset-gen/scripts/common_image_api.py`, keep existing public names and use in-memory task state only to preserve the skill's current async-ish contract:

```python
# input: image prompts and artifact policy
# output: existing asset-gen image task contract backed by aos-cli artifacts
# pos: image model boundary adapter for asset-gen scripts

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any
from urllib.parse import urlparse

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run

_TASKS: dict[str, dict[str, Any]] = {}


def submit_image_task(
    model_code: str,
    prompt: str,
    params: dict | None = None,
    max_retries: int = 3,
    *,
    project_dir: str | Path | None = None,
) -> str | None:
    params = params or {}
    working_dir = Path(project_dir or os.getcwd()).resolve()
    local_dir = Path(params.get("local_dir") or params.get("output_dir") or working_dir).resolve()
    role = str(params.get("role") or "asset.image")
    task = str(params.get("task") or "asset-gen.image")
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "image.generate",
        "output": {"kind": "artifact"},
        "input": {"prompt": prompt},
        "artifactPolicy": {"download": True, "localDir": str(local_dir), "role": role},
    }
    if model_code:
        request["modelPolicy"] = {"model": model_code}

    with tempfile.TemporaryDirectory(prefix="asset-image-aos-cli-") as tmp:
        request_path = Path(tmp) / "request.json"
        response_path = Path(tmp) / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=working_dir)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        response = json.loads(response_path.read_text(encoding="utf-8"))

    if not response.get("ok"):
        error = response.get("error", {})
        raise RuntimeError(error.get("message") or "aos-cli image generation failed")
    output = response.get("output", {})
    artifacts = output.get("artifacts") or []
    if output.get("kind") != "artifact" or not artifacts:
        raise RuntimeError("aos-cli returned no image artifact")

    task_id = f"aos-cli-image-{len(_TASKS) + 1}"
    _TASKS[task_id] = {"status": "succeeded", "artifacts": artifacts}
    return task_id


def check_task_once(task_id: str) -> dict[str, Any] | None:
    task = _TASKS.get(task_id)
    if not task:
        return None
    artifacts = task["artifacts"]
    result_urls = [artifact.get("uri") for artifact in artifacts if artifact.get("uri")]
    display_urls = [artifact.get("remoteUrl") or artifact.get("uri") for artifact in artifacts if artifact.get("remoteUrl") or artifact.get("uri")]
    return {
        "status": task["status"],
        "result_urls": result_urls,
        "display_urls": display_urls,
        "artifacts": artifacts,
    }


def poll_image_task(task_id: str, timeout: int = 600, label: str = "") -> dict[str, Any] | None:
    return check_task_once(task_id)


def download_image(url: str, output_path: str | Path) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme == "file":
        source = Path(parsed.path)
        destination = Path(output_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        return str(destination)
    return url
```

- [x] **Step 5: Update image callers only where needed**

In `generate_characters.py`, `generate_scenes.py`, and `generate_props.py`, preserve the existing workflow and only pass `project_dir`, `local_dir`, `role`, and `task` through `params` where the current call site has that context:

```python
task_id = submit_image_task(
    model_code=model_code,
    prompt=prompt,
    params={
        **params,
        "local_dir": str(output_dir),
        "role": role,
        "task": task_name,
    },
    project_dir=project_dir,
)
```

When consuming `check_task_once()` / `poll_image_task()`, keep existing `result_urls` and `display_urls` behavior and additionally persist artifact metadata if the caller writes metadata JSON:

```python
artifacts = poll_result.get("artifacts", [])
if artifacts:
    metadata["artifacts"] = artifacts
```

- [x] **Step 6: Update asset-gen docs**

In `.claude/skills/asset-gen/SKILL.md`, replace provider setup with:

```markdown
Model calls go through `aos-cli model`.

- Text/JSON prompt generation uses `generate`.
- Image generation uses `image.generate` with `output.kind=artifact`.
- Runtime readiness is checked with `uv run --project aos-cli aos-cli model preflight --json`.
```

In `.claude/skills/asset-gen/references/troubleshooting.md`, mark direct ChatFire/OpenAI-compatible image API notes as legacy migration context, not the current integration path.

- [x] **Step 7: Run asset tests and guardrail**

Run:

```bash
uv run pytest .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py -v
uv run python -m unittest discover -s .claude/skills/_shared -p 'test_no_new_direct_provider_calls.py' -v
```

Expected: PASS for all migrated asset paths listed in the guardrail.

- [x] **Step 8: Commit asset image migration**

```bash
git add .claude/skills/asset-gen/scripts/common_image_api.py .claude/skills/asset-gen/scripts/generate_characters.py .claude/skills/asset-gen/scripts/generate_scenes.py .claude/skills/asset-gen/scripts/generate_props.py .claude/skills/asset-gen/SKILL.md .claude/skills/asset-gen/references/troubleshooting.md .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py .claude/skills/_shared/test_no_new_direct_provider_calls.py
git commit -m "Route asset image generation through aos-cli model"
```

---

### Task 5: Migrate video-gen submit and poll

**Files:**
- Modify: `.claude/skills/video-gen/scripts/video_api.py`
- Modify: `.claude/skills/video-gen/scripts/test_provider_switch.py`
- Modify: `.claude/skills/video-gen/SKILL.md`
- Modify: `.claude/skills/video-gen/references/AI_CONFIG_AND_DELIVERY.md`
- Modify: `.claude/skills/_shared/test_no_new_direct_provider_calls.py`

- [x] **Step 1: Extend guardrail to video API**

In `.claude/skills/_shared/test_no_new_direct_provider_calls.py`, update `MIGRATED_SCRIPT_PATHS`:

```python
MIGRATED_SCRIPT_PATHS = [
    ".claude/skills/storyboard/scripts/storyboard_batch.py",
    ".claude/skills/asset-gen/scripts/common_gemini_client.py",
    ".claude/skills/asset-gen/scripts/generate_prompts_from_script.py",
    ".claude/skills/asset-gen/scripts/style_generate.py",
    ".claude/skills/asset-gen/scripts/common_image_api.py",
    ".claude/skills/video-gen/scripts/video_api.py",
]
```

- [x] **Step 2: Add video boundary submit/poll tests**

In `.claude/skills/video-gen/scripts/test_provider_switch.py`, add boundary tests while preserving compatibility expectations for public wrappers:

```python
def test_video_submit_uses_aos_cli_task_boundary(tmp_path, monkeypatch):
    import json
    import video_api

    calls = []

    def fake_submit(request_path, task_path, *, cwd=None):
        calls.append((request_path, task_path, cwd))
        request = json.loads(request_path.read_text(encoding="utf-8"))
        assert request["apiVersion"] == "aos-cli.model/v1"
        assert request["capability"] == "video.generate"
        assert request["output"]["kind"] == "task"
        task_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "video.ep001.scn001.clip001",
                    "capability": "video.generate",
                    "output": {"kind": "task", "taskId": "task-1"},
                    "provider": "ark",
                    "model": "fake-video-model",
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(video_api, "aos_cli_model_submit", fake_submit)

    result = video_api.submit_video_generation(
        prompt="Slow camera push.",
        duration=5,
        ratio="16:9",
        quality="standard",
        project_dir=tmp_path,
        task="video.ep001.scn001.clip001",
    )

    assert calls
    assert result["output"]["taskId"] == "task-1"


def test_video_poll_uses_aos_cli_task_result_boundary(tmp_path, monkeypatch):
    import json
    import video_api

    def fake_poll(task_path, result_path, *, cwd=None):
        result_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "apiVersion": "aos-cli.model/v1",
                    "task": "video.ep001.scn001.clip001",
                    "capability": "video.generate",
                    "output": {
                        "kind": "task_result",
                        "status": "SUCCESS",
                        "artifacts": [
                            {
                                "kind": "video",
                                "uri": "https://example.test/video.mp4",
                                "lastFrameUrl": "https://example.test/last.png",
                            }
                        ],
                    },
                    "warnings": [],
                }
            ),
            encoding="utf-8",
        )
        return type("Completed", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr(video_api, "aos_cli_model_poll", fake_poll)

    result = video_api.poll_video_generation(
        task_envelope={
            "ok": True,
            "apiVersion": "aos-cli.model/v1",
            "task": "video.ep001.scn001.clip001",
            "capability": "video.generate",
            "output": {"kind": "task", "taskId": "task-1"},
            "warnings": [],
        },
        project_dir=tmp_path,
    )

    assert result["output"]["status"] == "SUCCESS"
    assert result["output"]["artifacts"][0]["lastFrameUrl"] == "https://example.test/last.png"
```

- [x] **Step 3: Run video boundary tests and verify they fail**

Run:

```bash
uv run pytest .claude/skills/video-gen/scripts/test_provider_switch.py::test_video_submit_uses_aos_cli_task_boundary .claude/skills/video-gen/scripts/test_provider_switch.py::test_video_poll_uses_aos_cli_task_result_boundary -v
```

Expected: FAIL because `video_api.py` still uses direct Ark API or lacks these boundary functions.

- [x] **Step 4: Replace raw Ark calls with boundary functions**

In `.claude/skills/video-gen/scripts/video_api.py`, add boundary primitives and make existing public wrappers call them:

```python
# input: video generation prompts and async task envelopes
# output: normalized aos-cli video task and task_result envelopes
# pos: video model boundary adapter for video-gen skill

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_poll, aos_cli_model_submit


def submit_video_generation(
    *,
    prompt: str,
    duration: int | str,
    ratio: str,
    quality: str,
    project_dir: str | Path,
    task: str,
    reference_images: list[Any] | None = None,
    first_frame_url: str | None = None,
) -> dict[str, Any]:
    input_payload: dict[str, Any] = {
        "prompt": prompt,
        "duration": int(duration),
        "ratio": ratio,
        "quality": quality,
    }
    if reference_images:
        input_payload["referenceImages"] = reference_images
    if first_frame_url:
        input_payload["firstFrameUrl"] = first_frame_url
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "video.generate",
        "output": {"kind": "task"},
        "input": input_payload,
    }
    model = os.environ.get("VIDEO_MODEL")
    if model:
        request["modelPolicy"] = {"model": model}

    with tempfile.TemporaryDirectory(prefix="video-submit-aos-cli-") as tmp:
        request_path = Path(tmp) / "request.json"
        task_path = Path(tmp) / "task.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
        completed = aos_cli_model_submit(request_path, task_path, cwd=project_dir)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        envelope = json.loads(task_path.read_text(encoding="utf-8"))

    if not envelope.get("ok"):
        error = envelope.get("error", {})
        raise RuntimeError(error.get("message") or "aos-cli video submit failed")
    return envelope


def poll_video_generation(*, task_envelope: dict[str, Any], project_dir: str | Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="video-poll-aos-cli-") as tmp:
        task_path = Path(tmp) / "task.json"
        result_path = Path(tmp) / "result.json"
        task_path.write_text(json.dumps(task_envelope, ensure_ascii=False), encoding="utf-8")
        completed = aos_cli_model_poll(task_path, result_path, cwd=project_dir)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        envelope = json.loads(result_path.read_text(encoding="utf-8"))

    if not envelope.get("ok"):
        error = envelope.get("error", {})
        raise RuntimeError(error.get("message") or "aos-cli video poll failed")
    return envelope
```

- [x] **Step 5: Preserve existing `submit_video()` compatibility**

Make `submit_video()` call `submit_video_generation()` and return the fields expected by `batch_generate_runtime.py`:

```python
envelope = submit_video_generation(
    prompt=prompt,
    duration=duration,
    ratio=ratio,
    quality=quality,
    project_dir=Path.cwd(),
    task="video.generate",
    reference_images=reference_images,
    first_frame_url=first_frame_url,
)
output = envelope.get("output", {})
return {
    "success": True,
    "task_id": output.get("taskId"),
    "provider": envelope.get("provider"),
    "model_code": envelope.get("model") or model_code,
    "task_envelope": envelope,
}
```

- [x] **Step 6: Preserve existing poll result compatibility**

Make `poll_multiple_tasks()` store and poll the `task_envelope` returned by `submit_video()`. When `poll_video_generation()` returns `output.kind=task_result`, map artifacts back into current delivery fields:

```python
artifacts = envelope.get("output", {}).get("artifacts", [])
video_artifact = next((artifact for artifact in artifacts if artifact.get("kind") == "video"), {})
video_url = video_artifact.get("uri") or video_artifact.get("remoteUrl")
last_frame_url = video_artifact.get("lastFrameUrl") or video_artifact.get("last_frame_url")
```

Preserve existing `video_url`, `video_path`, and `last_frame_url` keys in the result dictionaries.

- [x] **Step 7: Update video-gen docs**

In `.claude/skills/video-gen/SKILL.md`, replace raw Ark setup with:

```markdown
Video model calls go through `aos-cli model`.

- Submit uses `video.generate` with `output.kind=task` via `model submit`.
- Poll uses `video.generate` with `output.kind=task_result` via `model poll`.
- Runtime readiness is checked with `uv run --project aos-cli aos-cli model preflight --json`.
```

In `.claude/skills/video-gen/references/AI_CONFIG_AND_DELIVERY.md`, document that provider-specific Ark fields are owned by `aos-cli`, while `video-gen` owns storyboard-to-request mapping and delivery JSON.

- [x] **Step 8: Run video tests and global guardrail**

Run:

```bash
uv run pytest .claude/skills/video-gen/scripts/test_provider_switch.py -v
uv run python -m unittest discover -s .claude/skills/_shared -p 'test_no_new_direct_provider_calls.py' -v
```

Expected: PASS.

- [x] **Step 9: Commit video migration and final guardrail expansion**

```bash
git add .claude/skills/video-gen/scripts/video_api.py .claude/skills/video-gen/scripts/test_provider_switch.py .claude/skills/video-gen/SKILL.md .claude/skills/video-gen/references/AI_CONFIG_AND_DELIVERY.md .claude/skills/_shared/test_no_new_direct_provider_calls.py
git commit -m "Route video generation through aos-cli model"
```

---

### Task 6: Mark multimodal and ASR migrations as deferred

**Files:**
- Modify: `.claude/skills/asset-gen/scripts/review_scene.py`
- Modify: `.claude/skills/asset-gen/scripts/review_char.py`
- Modify: `.claude/skills/asset-gen/scripts/review_props.py`
- Modify: `.claude/skills/video-editing/SKILL.md`
- Modify: `.claude/skills/music-matcher/SKILL.md`
- Modify: `.claude/skills/subtitle-maker/SKILL.md`
- Modify: `.claude/skills/_shared/AOS_CLI_MODEL.md`

- [x] **Step 1: Add explicit deferred notes to asset review scripts**

At the top-level docstring or provider setup section of these scripts:

- `.claude/skills/asset-gen/scripts/review_scene.py`
- `.claude/skills/asset-gen/scripts/review_char.py`
- `.claude/skills/asset-gen/scripts/review_props.py`

Add one short note:

```python
# Model boundary note: this image+text review path remains deferred until aos-cli model defines an explicit multimodal review contract.
```

Do not change their provider behavior in this task.

- [x] **Step 2: Add explicit deferred notes to post-production skills**

In each of these files:

- `.claude/skills/video-editing/SKILL.md`
- `.claude/skills/music-matcher/SKILL.md`
- `.claude/skills/subtitle-maker/SKILL.md`

Add this provider-boundary note near the model/provider setup section:

```markdown
Model boundary note: this skill still uses direct Gemini multimodal/ASR calls because the current `aos-cli model` protocol does not yet fully cover this skill's required input/output shape. Do not add new provider surfaces here; migrate this skill only after the `aos-cli` protocol explicitly supports the needed multimodal or transcription contract.
```

- [x] **Step 3: Update shared migration guide**

In `.claude/skills/_shared/AOS_CLI_MODEL.md`, ensure the migration section contains:

```markdown
Asset image review, post-production video analysis, music matching, and subtitle transcription remain deferred until `aos-cli model` has explicit protocol coverage for their required multimodal or ASR contracts. Do not force these through `generate` if doing so would hide domain-specific input/output semantics.
```

- [x] **Step 4: Verify docs contain deferred notes**

Run:

```bash
python - <<'PY'
from pathlib import Path
paths = [
    Path('.claude/skills/asset-gen/scripts/review_scene.py'),
    Path('.claude/skills/asset-gen/scripts/review_char.py'),
    Path('.claude/skills/asset-gen/scripts/review_props.py'),
    Path('.claude/skills/video-editing/SKILL.md'),
    Path('.claude/skills/music-matcher/SKILL.md'),
    Path('.claude/skills/subtitle-maker/SKILL.md'),
    Path('.claude/skills/_shared/AOS_CLI_MODEL.md'),
]
for path in paths:
    text = path.read_text(encoding='utf-8')
    assert 'deferred' in text.lower() or 'defer' in text.lower(), path
print('deferred notes present')
PY
```

Expected: prints `deferred notes present`.

- [x] **Step 5: Commit deferred migration notes**

```bash
git add .claude/skills/asset-gen/scripts/review_scene.py .claude/skills/asset-gen/scripts/review_char.py .claude/skills/asset-gen/scripts/review_props.py .claude/skills/video-editing/SKILL.md .claude/skills/music-matcher/SKILL.md .claude/skills/subtitle-maker/SKILL.md .claude/skills/_shared/AOS_CLI_MODEL.md
git commit -m "Document deferred multimodal skill migration"
```

---

### Task 7: Full verification and migration audit

**Files:**
- Read: `.claude/skills/_shared/AOS_CLI_MODEL.md`
- Read: `.claude/skills/storyboard/SKILL.md`
- Read: `.claude/skills/asset-gen/SKILL.md`
- Read: `.claude/skills/video-gen/SKILL.md`
- Read: `.claude/skills/video-editing/SKILL.md`
- Read: `.claude/skills/music-matcher/SKILL.md`
- Read: `.claude/skills/subtitle-maker/SKILL.md`

- [x] **Step 1: Run migrated skill tests**

Run:

```bash
uv run python -m unittest discover -s .claude/skills/_shared -p 'test_*.py' -v
uv run pytest .claude/skills/storyboard/scripts/test_storyboard_batch.py -v
uv run pytest .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py -v
uv run pytest .claude/skills/video-gen/scripts/test_provider_switch.py -v
```

Expected: PASS.

- [x] **Step 2: Run aos-cli core tests**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests -v
```

Expected: PASS.

- [x] **Step 3: Run deterministic fake model smoke tests**

Run:

```bash
AOS_CLI_MODEL_FAKE=1 aos-cli/scripts/manual-model-tests.sh 3
AOS_CLI_MODEL_FAKE=1 aos-cli/scripts/manual-model-tests.sh 6
AOS_CLI_MODEL_FAKE=1 aos-cli/scripts/manual-model-tests.sh 9
```

Expected: fake text, fake image, and fake video submit/poll all return `ok: true` JSON envelopes.

- [x] **Step 4: Audit remaining direct provider references**

Run:

```bash
python - <<'PY'
from pathlib import Path
terms = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ARK_API_KEY', 'google.genai', '/v1/images/generations']
for path in Path('.claude/skills').rglob('*'):
    if path.name == 'AOS_CLI_MODEL.md':
        continue
    if not path.is_file() or path.suffix not in {'.py', '.md', '.json'}:
        continue
    text = path.read_text(encoding='utf-8', errors='ignore')
    hits = [term for term in terms if term in text]
    if hits:
        print(f'{path}: {hits}')
PY
```

Expected: remaining hits are either deferred multimodal/ASR paths, legacy troubleshooting notes explicitly marked as legacy, or future protocol-expansion work. No script from `MIGRATED_SCRIPT_PATHS` should appear.

- [x] **Step 5: Check delivery-facing compatibility**

Run focused smoke tests or fixtures for the public contracts that migrated callers depend on:

```bash
uv run pytest .claude/skills/asset-gen/scripts/test_aos_cli_asset_model.py::test_image_api_preserves_submit_and_poll_contract -v
uv run pytest .claude/skills/video-gen/scripts/test_provider_switch.py::test_video_submit_uses_aos_cli_task_boundary .claude/skills/video-gen/scripts/test_provider_switch.py::test_video_poll_uses_aos_cli_task_result_boundary -v
```

Expected: PASS, proving the migration did not force callers to understand provider-specific envelopes.

- [x] **Step 6: Update plan checkboxes if executing manually**

If this plan is executed manually, check off each completed step in `docs/superpowers/plans/2026-04-26-skills-aos-cli-model-migration.md`.

- [x] **Step 7: Commit verification doc updates only if plan checkboxes changed**

```bash
git add docs/superpowers/plans/2026-04-26-skills-aos-cli-model-migration.md
git commit -m "Track skills aos-cli migration execution"
```

## Self-Review

- Spec coverage: The plan covers shared guardrails, storyboard text/JSON, asset-gen text/JSON, asset-gen image, video-gen submit/poll, deferred asset review/post-production multimodal/ASR, and full verification.
- Audit integration: The three read-only audits are incorporated. `style_generate.py`, `review_char.py`, `review_props.py`, `generate_scenes.py`, `generate_props.py`, `test_chatfire_image_api.py` implications, video `last_frame_url`, and Gemini Files API blockers are reflected in the plan.
- Placeholder scan: No `TBD`, `TODO`, or open-ended implementation placeholders remain. Deferred work is explicitly scoped and justified by protocol coverage.
- Type consistency: All migrated scripts call `_shared/aos_cli_model.py` wrappers and consume normalized JSON envelopes with `ok`, `output.kind`, and capability-specific output fields. Existing public skill contracts are preserved for asset image and video runtime callers.
- Test command consistency: Guardrail tests use `unittest discover -s .claude/skills/_shared` instead of an import path through the hidden `.claude` directory.
- Parallelization: Implementation is intentionally serial after read-only audit because migration tasks share envelope semantics and guardrail state. This avoids duplicate helper logic and conflicting provider-boundary decisions.
