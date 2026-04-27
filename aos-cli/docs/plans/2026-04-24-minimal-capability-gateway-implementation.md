# Minimal Capability Gateway Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the `aos-cli` minimal capability gateway so AgentOS harnesses can call model providers through stable request/response files without provider leakage.

**Architecture:** Keep `aos-cli` as a model capability boundary, not a workflow runtime. Implement features in dependency order: protocol hardening, batch orchestration, artifact descriptors, provider adapters, then AgentOS-TS migration examples. Business semantics remain in `task`, `trace`, and schemas; gateway execution branches only on `capability`, `output.kind`, and explicit policies.

**Tech Stack:** Python 3.11+, `uv`, `argparse`, `urllib.request`, `jsonschema`, `pytest`, `ruff`. No Rust, server mode, worker mode, database, or plugin system in this milestone.

---

## Execution Policy

Do not use subagents by default for this plan. The early tasks share the same protocol files and command surface, so parallel edits would create write conflicts and conceptual drift. Re-evaluate parallelism only when a task has a disjoint write set and no dependency on unfinished protocol decisions.

Safe serial order:

1. Protocol and validation hardening.
2. Batch manifest and bounded local concurrency.
3. Artifact descriptor primitives.
4. `image.generate`.
5. `video.generate` submit/poll.
6. `vision.analyze`, `audio.transcribe`, and `embed`.
7. AgentOS-TS migration examples.

Explicitly do not implement:

- `aos-cli storyboard`, `aos-cli asset`, or other business commands.
- Server mode, worker mode, persistent queue, plugin loading.
- AgentOS-TS pipeline-state ownership.
- Claude Agent SDK session replacement.

Commit protocol:

- Every task commit must follow the repository Lore commit protocol.
- Before running each `git commit -F /tmp/aos-cli-lore-commit.txt`, overwrite that file with a task-specific Lore message containing at least: intent line, rationale body, `Constraint:`, `Confidence:`, `Scope-risk:`, `Tested:`, and `Not-tested:`.
- Do not use short `git commit -m` messages for implementation commits.

Current known workspace state before execution:

- `uv.lock` may contain unrelated registry URL changes. Do not stage it unless a task intentionally changes dependencies.
- `validate` already exists and should be treated as the baseline for later validation behavior.

---

## Task 1: Centralize Capability Metadata

**Files:**
- Create: `src/aos_cli/model/registry.py`
- Modify: `src/aos_cli/model/protocol.py`
- Modify: `src/aos_cli/model/capabilities.py`
- Test: `tests/test_capabilities.py`
- Test: `tests/test_model_protocol.py`

**Goal:** Remove duplicated capability knowledge from protocol and capabilities payloads.

**Step 1: Write failing tests**

Add to `tests/test_capabilities.py`:

```python
from aos_cli.model.capabilities import capabilities_payload


def test_capabilities_and_protocol_share_generate_metadata():
    payload = capabilities_payload()
    generate = next(item for item in payload["capabilities"] if item["name"] == "generate")

    assert generate["outputKinds"] == ["text", "json"]
    assert generate["providers"] == ["gemini"]
```

Add to `tests/test_model_protocol.py`:

```python
def test_parse_request_accepts_all_registered_generate_output_kinds():
    for output_kind in ("text", "json"):
        request = {
            "apiVersion": "aos-cli.model/v1",
            "task": "x",
            "capability": "generate",
            "output": {"kind": output_kind},
            "input": {},
        }
        assert parse_request(request)["output"]["kind"] == output_kind
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_capabilities.py tests/test_model_protocol.py -q
```

Expected: fail until registry is introduced and imports are updated.

**Step 3: Implement registry**

Create `src/aos_cli/model/registry.py`:

```python
# input: static model capability definitions
# output: capability metadata used by validation and discovery
# pos: single source of truth for supported model capabilities

from dataclasses import dataclass


@dataclass(frozen=True)
class Capability:
    name: str
    output_kinds: tuple[str, ...]
    providers: tuple[str, ...]
    models: tuple[str, ...] = ()


CAPABILITIES: dict[str, Capability] = {
    "generate": Capability(
        name="generate",
        output_kinds=("text", "json"),
        providers=("gemini",),
    )
}


def get_capability(name: str) -> Capability | None:
    return CAPABILITIES.get(name)
```

Modify `protocol.py` to call `get_capability()` instead of local `SUPPORTED_CAPABILITIES` and `SUPPORTED_OUTPUT_KINDS`.

Modify `capabilities.py` to build payload from `CAPABILITIES`, while preserving the current default model behavior for `generate`.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_capabilities.py tests/test_model_protocol.py -q
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/registry.py src/aos_cli/model/protocol.py src/aos_cli/model/capabilities.py tests/test_capabilities.py tests/test_model_protocol.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 2: Preserve Trace and Labels in Envelopes

**Files:**
- Modify: `src/aos_cli/model/protocol.py`
- Modify: `src/aos_cli/cli.py`
- Modify: `src/aos_cli/model/service.py`
- Test: `tests/test_model_protocol.py`
- Test: `tests/test_model_validate_cli.py`
- Test: `tests/test_model_service.py`

**Goal:** Allow business metadata to pass through for observability without driving execution.

**Step 1: Write failing tests**

Add service test:

```python
def test_service_passes_trace_and_labels_through():
    service = ModelService(provider_factory=lambda request: FakeProvider("plain text"))
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "storyboard.scene",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
            "trace": {"episode": 1, "scene": 3},
            "labels": {"stage": "STORYBOARD"},
        }
    )

    assert response["trace"] == {"episode": 1, "scene": 3}
    assert response["labels"] == {"stage": "STORYBOARD"}
```

Add validate test:

```python
def test_model_validate_passes_trace_through(tmp_path, capsys):
    request_path = tmp_path / "request.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "test.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
                "trace": {"episode": 1},
            }
        ),
        encoding="utf-8",
    )

    assert main(["model", "validate", "--input", str(request_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["trace"] == {"episode": 1}
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_model_validate_cli.py tests/test_model_service.py -q
```

Expected: fail because trace and labels are not currently included.

**Step 3: Implement pass-through helpers**

Modify `protocol.py`:

```python
def envelope_metadata(request: dict) -> dict:
    metadata = {}
    if isinstance(request.get("trace"), dict):
        metadata["trace"] = request["trace"]
    if isinstance(request.get("labels"), dict):
        metadata["labels"] = request["labels"]
    return metadata
```

Add `trace` and `labels` optional parameters to `success_response()` and `failure_response()`. Only include them when provided.

Update `ModelService.run()` and `validate_request_payload()` to pass metadata through. Do not branch on trace or labels.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_model_protocol.py tests/test_model_validate_cli.py tests/test_model_service.py -q
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/protocol.py src/aos_cli/cli.py src/aos_cli/model/service.py tests/test_model_protocol.py tests/test_model_validate_cli.py tests/test_model_service.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 3: Add Batch Manifest Validation

**Files:**
- Create: `src/aos_cli/model/batch.py`
- Modify: `src/aos_cli/cli.py`
- Test: `tests/test_batch.py`

**Goal:** Validate batch manifests before running many requests.

**Step 1: Write failing tests**

Create `tests/test_batch.py`:

```python
import json

from aos_cli.cli import main
from aos_cli.model.batch import parse_batch_manifest


def test_parse_batch_manifest_accepts_valid_manifest(tmp_path):
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "response.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "x",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {},
            }
        ),
        encoding="utf-8",
    )

    manifest = {
        "apiVersion": "aos-cli.model.batch/v1",
        "concurrency": 2,
        "jobs": [{"id": "job-1", "request": str(request_path), "output": str(output_path)}],
    }

    parsed = parse_batch_manifest(manifest)
    assert parsed["concurrency"] == 2
    assert parsed["jobs"][0]["id"] == "job-1"


def test_model_batch_validate_reports_invalid_manifest(tmp_path, capsys):
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps({"apiVersion": "bad", "jobs": []}), encoding="utf-8")

    code = main(["model", "batch", "--manifest", str(manifest_path), "--report", str(tmp_path / "report.json")])

    assert code == 2
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_batch.py -q
```

Expected: import or CLI command failure.

**Step 3: Implement manifest parser**

Create `batch.py` with:

```python
# input: batch manifest payloads
# output: validated batch manifests and batch reports
# pos: bounded local batch orchestration for model requests

from aos_cli.model.errors import ModelServiceError

BATCH_API_VERSION = "aos-cli.model.batch/v1"


def parse_batch_manifest(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError("INVALID_REQUEST", "Batch manifest must be an object")
    if payload.get("apiVersion") != BATCH_API_VERSION:
        raise ModelServiceError("INVALID_REQUEST", "Unsupported batch apiVersion")
    jobs = payload.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        raise ModelServiceError("INVALID_REQUEST", "jobs must be a non-empty list")
    concurrency = int(payload.get("concurrency", 1))
    if concurrency < 1:
        raise ModelServiceError("INVALID_REQUEST", "concurrency must be >= 1")
    for job in jobs:
        if not isinstance(job, dict):
            raise ModelServiceError("INVALID_REQUEST", "each job must be an object")
        for field in ("id", "request", "output"):
            if not job.get(field):
                raise ModelServiceError("INVALID_REQUEST", f"job.{field} is required")
    return {"apiVersion": BATCH_API_VERSION, "concurrency": concurrency, "jobs": jobs}
```

Wire `aos-cli model batch --manifest --report` in `cli.py`. At this task, it may validate only and return a structured error for invalid manifests. Do not run jobs yet.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_batch.py -q
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/batch.py src/aos_cli/cli.py tests/test_batch.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 4: Execute Batch Jobs Locally

**Files:**
- Modify: `src/aos_cli/model/batch.py`
- Modify: `src/aos_cli/cli.py`
- Test: `tests/test_batch.py`
- Create: `examples/batch.manifest.json`

**Goal:** Run many atomic request files with bounded concurrency and a stable report.

**Step 1: Write failing tests**

Add:

```python
def test_batch_executes_jobs_and_writes_report(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "response.json"
    report_path = tmp_path / "report.json"
    manifest_path = tmp_path / "manifest.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "batch.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model.batch/v1",
                "concurrency": 1,
                "jobs": [{"id": "job-1", "request": str(request_path), "output": str(output_path)}],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "batch", "--manifest", str(manifest_path), "--report", str(report_path)])

    assert code == 0
    assert json.loads(output_path.read_text(encoding="utf-8"))["ok"] is True
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["ok"] is True
    assert report["total"] == 1
    assert report["succeeded"] == 1
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_batch.py::test_batch_executes_jobs_and_writes_report -q
```

Expected: fail because jobs are not executed.

**Step 3: Implement batch execution**

Implement `run_batch(manifest: dict, service_factory) -> dict` in `batch.py`.

Rules:

- Use `ThreadPoolExecutor(max_workers=concurrency)`.
- Read each job request.
- Call `service_factory().run(request)`.
- Write each response to job output.
- Continue after failed jobs.
- Return report with `ok`, `total`, `succeeded`, `failed`, `retryableFailed`, and `jobs`.
- CLI exit code is `0` only when report `ok` is true.

**Step 4: Create example manifest**

Create `examples/batch.manifest.json` with two jobs pointing to `examples/text.request.json` and `examples/json.request.json`, outputting to `/tmp/aos-cli-batch-text.json` and `/tmp/aos-cli-batch-json.json`.

**Step 5: Run tests and smoke**

Run:

```bash
uv run pytest tests/test_batch.py -q
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model batch --manifest examples/batch.manifest.json --report /tmp/aos-cli-batch-report.json
```

Expected: tests pass and report has `ok=true`.

**Step 6: Commit**

```bash
git add src/aos_cli/model/batch.py src/aos_cli/cli.py tests/test_batch.py examples/batch.manifest.json
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 5: Add Artifact Descriptor Primitives

**Files:**
- Create: `src/aos_cli/model/artifacts.py`
- Test: `tests/test_artifacts.py`
- Modify: `docs/MODEL_PROTOCOL.md`

**Goal:** Define artifact descriptors before adding image or video providers.

**Step 1: Write failing tests**

Create `tests/test_artifacts.py`:

```python
from pathlib import Path

from aos_cli.model.artifacts import build_artifact_descriptor


def test_build_artifact_descriptor_hashes_local_file(tmp_path):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"png")

    descriptor = build_artifact_descriptor(
        path=image_path,
        kind="image",
        mime_type="image/png",
        role="character.front",
        remote_url="https://example.com/image.png",
    )

    assert descriptor["kind"] == "image"
    assert descriptor["uri"].startswith("file://")
    assert descriptor["remoteUrl"] == "https://example.com/image.png"
    assert descriptor["sha256"]
    assert descriptor["bytes"] == 3
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_artifacts.py -q
```

Expected: fail because module does not exist.

**Step 3: Implement artifact descriptor**

Create `artifacts.py`:

```python
# input: local artifact paths and provider metadata
# output: stable artifact descriptors
# pos: artifact reporting boundary for model capability outputs

from pathlib import Path
import hashlib


def build_artifact_descriptor(
    *,
    path: Path,
    kind: str,
    mime_type: str,
    role: str | None = None,
    remote_url: str | None = None,
) -> dict:
    data = path.read_bytes()
    descriptor = {
        "kind": kind,
        "uri": path.resolve().as_uri(),
        "mimeType": mime_type,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
    }
    if role:
        descriptor["role"] = role
    if remote_url:
        descriptor["remoteUrl"] = remote_url
    return descriptor
```

**Step 4: Update docs**

Update `docs/MODEL_PROTOCOL.md` artifact section to use `uri`, `remoteUrl`, `mimeType`, `sha256`, `bytes`, and `role`.

**Step 5: Run tests**

Run:

```bash
uv run pytest tests/test_artifacts.py -q
```

Expected: pass.

**Step 6: Commit**

```bash
git add src/aos_cli/model/artifacts.py tests/test_artifacts.py docs/MODEL_PROTOCOL.md
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 6: Add OpenAI-Compatible Image Provider Skeleton

**Files:**
- Create: `src/aos_cli/model/providers/openai_image.py`
- Modify: `src/aos_cli/model/registry.py`
- Modify: `src/aos_cli/model/protocol.py`
- Modify: `src/aos_cli/model/capabilities.py`
- Test: `tests/test_openai_image_provider.py`
- Test: `tests/test_capabilities.py`
- Test: `tests/test_model_protocol.py`

**Goal:** Add `image.generate` contract and provider adapter without yet migrating AgentOS-TS.

**Step 1: Write failing provider tests**

Create `tests/test_openai_image_provider.py`:

```python
from aos_cli.model.providers.openai_image import OpenAIImageProvider, extract_image_urls


def test_extract_image_urls_reads_openai_compatible_response():
    payload = {"data": [{"url": "https://example.com/a.png"}]}
    assert extract_image_urls(payload) == ["https://example.com/a.png"]


class FakeTransport:
    def __init__(self):
        self.last_url = None
        self.last_body = None

    def post_json(self, url, body, headers, timeout):
        self.last_url = url
        self.last_body = body
        return {"data": [{"url": "https://example.com/a.png"}]}


def test_openai_image_provider_posts_generation_request():
    transport = FakeTransport()
    provider = OpenAIImageProvider(
        api_key="key",
        base_url="https://api.example.com",
        model="gpt-image-2",
        transport=transport,
    )

    result = provider.generate_image(prompt="draw", options={"size": "1024x1024"})

    assert transport.last_url == "https://api.example.com/v1/images/generations"
    assert transport.last_body["model"] == "gpt-image-2"
    assert result.urls == ["https://example.com/a.png"]
```

**Step 2: Write failing protocol tests**

Add:

```python
def test_parse_request_accepts_registered_image_generate():
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": "asset.character.front",
        "capability": "image.generate",
        "output": {"kind": "artifact"},
        "input": {"prompt": "draw"},
    }

    assert parse_request(request)["capability"] == "image.generate"
```

**Step 3: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_openai_image_provider.py tests/test_model_protocol.py tests/test_capabilities.py -q
```

Expected: fail until provider and registry are updated.

**Step 4: Implement provider skeleton**

Implement `openai_image.py` with `ProviderImageResult`, `extract_image_urls()`, `OpenAIImageProvider.generate_image()`, and HTTP error mapping consistent with Gemini provider error codes.

Update registry:

```python
"image.generate": Capability(
    name="image.generate",
    output_kinds=("artifact",),
    providers=("openai_compatible",),
    models=("gpt-image-2",),
)
```

Update protocol to validate output kind from registered capability metadata.

**Step 5: Run tests**

Run:

```bash
uv run pytest tests/test_openai_image_provider.py tests/test_model_protocol.py tests/test_capabilities.py -q
```

Expected: pass.

**Step 6: Commit**

```bash
git add src/aos_cli/model/providers/openai_image.py src/aos_cli/model/registry.py src/aos_cli/model/protocol.py src/aos_cli/model/capabilities.py tests/test_openai_image_provider.py tests/test_model_protocol.py tests/test_capabilities.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 7: Implement `image.generate` Service Path

**Files:**
- Modify: `src/aos_cli/model/config.py`
- Modify: `src/aos_cli/model/service.py`
- Modify: `src/aos_cli/model/artifacts.py`
- Modify: `src/aos_cli/model/providers/openai_image.py`
- Create: `examples/image.request.json`
- Test: `tests/test_model_service.py`
- Test: `tests/test_model_run_cli.py`

**Goal:** Let `aos-cli model run` execute `image.generate` and return artifact descriptors.

**Step 1: Write failing tests**

Add service test with a fake image provider factory. The fake provider should return one local test URL or use a fake downloader seam.

Required assertion:

```python
assert response["ok"] is True
assert response["output"]["kind"] == "artifact"
assert response["output"]["artifacts"][0]["kind"] == "image"
```

Add CLI test using `AOS_CLI_MODEL_FAKE=1` once fake provider supports `image.generate`.

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_model_service.py tests/test_model_run_cli.py -q
```

Expected: fail because `ModelService` only supports text provider path.

**Step 3: Implement minimal service dispatch**

Refactor `ModelService.run()`:

- If `capability == "generate"`, call current text path.
- If `capability == "image.generate"`, call image path.
- Do not introduce a plugin system.

Add `resolve_openai_image_config()` to `config.py`:

```python
OPENAI_API_KEY
OPENAI_BASE_URL default "https://api.chatfire.cn"
OPENAI_IMAGE_MODEL default "gpt-image-2"
```

Use `artifactPolicy.localDir` to decide download target. If `download=false`, return remote artifact descriptors without local `sha256` and `bytes` only if protocol explicitly allows it. Prefer `download=true` for AgentOS assets.

**Step 4: Create example**

Create `examples/image.request.json`:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "asset.character.front",
  "capability": "image.generate",
  "output": {"kind": "artifact"},
  "input": {"prompt": "stylized 3D historical fantasy character front view"},
  "artifactPolicy": {"download": true, "localDir": "/tmp/aos-cli-image"}
}
```

**Step 5: Run tests and fake smoke**

Run:

```bash
uv run pytest tests/test_model_service.py tests/test_model_run_cli.py tests/test_openai_image_provider.py -q
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model run --input examples/image.request.json --output /tmp/aos-cli-image-response.json
```

Expected: pass and response has `output.kind=artifact`.

**Step 6: Commit**

```bash
git add src/aos_cli/model/config.py src/aos_cli/model/service.py src/aos_cli/model/artifacts.py src/aos_cli/model/providers/openai_image.py examples/image.request.json tests/test_model_service.py tests/test_model_run_cli.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 8: Add Ark Video Submit and Poll Providers

**Files:**
- Create: `src/aos_cli/model/providers/ark_video.py`
- Modify: `src/aos_cli/model/registry.py`
- Modify: `src/aos_cli/model/protocol.py`
- Modify: `src/aos_cli/model/config.py`
- Test: `tests/test_ark_video_provider.py`
- Test: `tests/test_model_protocol.py`
- Test: `tests/test_capabilities.py`

**Goal:** Add async video provider primitives without changing AgentOS-TS video generation yet.

**Step 1: Write failing provider tests**

Create `tests/test_ark_video_provider.py`:

```python
from aos_cli.model.providers.ark_video import build_ark_video_task_body, extract_ark_task_id


def test_build_ark_video_task_body_uses_model_and_reference_images():
    body = build_ark_video_task_body(
        model="ep-20260303234827-tfnzm",
        prompt="move",
        reference_images=[{"url": "https://example.com/ref.png", "role": "reference_image"}],
        duration=6,
        ratio="9:16",
        quality="720p",
    )

    assert body["model"] == "ep-20260303234827-tfnzm"
    assert body["content"][0]["type"] == "text"
    assert any(item["type"] == "image_url" for item in body["content"])


def test_extract_ark_task_id_reads_task_response():
    assert extract_ark_task_id({"id": "task-1"}) == "task-1"
```

**Step 2: Add protocol tests**

Add acceptance for:

- `capability=video.generate`
- `output.kind=task`
- later poll response `output.kind=task_result` if using the same protocol parser.

**Step 3: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_ark_video_provider.py tests/test_model_protocol.py tests/test_capabilities.py -q
```

Expected: fail until provider and registry are updated.

**Step 4: Implement provider primitives**

Implement only pure provider adapter primitives:

- `build_ark_video_task_body()`
- `extract_ark_task_id()`
- `extract_ark_task_result()`
- `ArkVideoProvider.submit_video()`
- `ArkVideoProvider.poll_video()`

Use env names:

```text
ARK_API_KEY
ARK_BASE_URL default https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL default ep-20260303234827-tfnzm
```

**Step 5: Run tests**

Run:

```bash
uv run pytest tests/test_ark_video_provider.py tests/test_model_protocol.py tests/test_capabilities.py -q
```

Expected: pass.

**Step 6: Commit**

```bash
git add src/aos_cli/model/providers/ark_video.py src/aos_cli/model/registry.py src/aos_cli/model/protocol.py src/aos_cli/model/config.py tests/test_ark_video_provider.py tests/test_model_protocol.py tests/test_capabilities.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 9: Implement `submit` and `poll` Command Paths

**Files:**
- Modify: `src/aos_cli/cli.py`
- Modify: `src/aos_cli/model/service.py`
- Modify: `src/aos_cli/model/protocol.py`
- Create: `examples/video.submit.request.json`
- Test: `tests/test_model_submit_poll_cli.py`
- Test: `tests/test_model_service.py`

**Goal:** Support async task lifecycle without forcing video into synchronous `run`.

**Step 1: Write failing CLI tests**

Create `tests/test_model_submit_poll_cli.py`:

```python
import json

from aos_cli.cli import main


def test_model_submit_writes_task_file(tmp_path, monkeypatch):
    request_path = tmp_path / "submit.json"
    task_path = tmp_path / "task.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "video.clip",
                "capability": "video.generate",
                "output": {"kind": "task"},
                "input": {"prompt": "move"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "submit", "--input", str(request_path), "--output", str(task_path)])

    assert code == 0
    payload = json.loads(task_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task"
```

**Step 2: Run test to verify failure**

Run:

```bash
uv run pytest tests/test_model_submit_poll_cli.py -q
```

Expected: CLI command not recognized.

**Step 3: Implement service methods**

Add to `ModelService`:

- `submit(payload: dict) -> dict`
- `poll(payload: dict) -> dict`

Rules:

- `submit` only accepts `output.kind=task`.
- `poll` accepts task envelope produced by submit.
- Fake provider returns deterministic task ids.
- Response keeps stable envelope shape.

**Step 4: Wire CLI**

Add:

```bash
aos-cli model submit --input request.json --output task.json
aos-cli model poll --input task.json --output result.json
```

**Step 5: Create example**

Create `examples/video.submit.request.json` for Ark Seedance2 with `modelPolicy.model=ep-20260303234827-tfnzm`.

**Step 6: Run tests**

Run:

```bash
uv run pytest tests/test_model_submit_poll_cli.py tests/test_model_service.py tests/test_ark_video_provider.py -q
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model submit --input examples/video.submit.request.json --output /tmp/aos-cli-video-task.json
```

Expected: pass and task file contains `ok=true`.

**Step 7: Commit**

```bash
git add src/aos_cli/cli.py src/aos_cli/model/service.py src/aos_cli/model/protocol.py examples/video.submit.request.json tests/test_model_submit_poll_cli.py tests/test_model_service.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 10: Add Vision Analyze Capability

**Files:**
- Modify: `src/aos_cli/model/registry.py`
- Modify: `src/aos_cli/model/providers/gemini.py`
- Modify: `src/aos_cli/model/service.py`
- Create: `examples/vision.request.json`
- Test: `tests/test_gemini_provider.py`
- Test: `tests/test_model_service.py`

**Goal:** Support model-based image/frame review through Gemini-compatible provider without business review logic.

**Step 1: Write failing tests**

Add provider test that calls a new `generate_vision_json()` or generalized multimodal generation method with image parts. Keep fake transport and assert Gemini payload includes text and image content parts.

Add service test:

```python
def test_service_returns_vision_json_output():
    response = ModelService(provider_factory=lambda request: FakeProvider('{"approved":true}')).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "review.frame",
            "capability": "vision.analyze",
            "output": {"kind": "json", "schema": "generic.object.v1"},
            "input": {"content": {"prompt": "review", "images": ["file:///tmp/frame.png"]}},
        }
    )
    assert response["ok"] is True
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_gemini_provider.py tests/test_model_service.py -q
```

Expected: fail until provider and registry support vision.

**Step 3: Implement minimal vision support**

Keep the provider implementation small:

- Accept text prompt plus image URIs.
- Convert local file URIs to inline base64 only if required by Gemini-compatible API.
- Return JSON through the same output validation path.

Do not add review-specific scoring rules.

**Step 4: Create example**

Create `examples/vision.request.json`.

**Step 5: Commit**

```bash
git add src/aos_cli/model/registry.py src/aos_cli/model/providers/gemini.py src/aos_cli/model/service.py examples/vision.request.json tests/test_gemini_provider.py tests/test_model_service.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 11: Add Audio Transcribe Capability

**Files:**
- Modify: `src/aos_cli/model/registry.py`
- Modify: `src/aos_cli/model/providers/gemini.py`
- Modify: `src/aos_cli/model/service.py`
- Create: `examples/audio-transcribe.request.json`
- Test: `tests/test_gemini_provider.py`
- Test: `tests/test_model_service.py`

**Goal:** Support subtitle-maker style transcription as an atomic model capability.

**Step 1: Write failing tests**

Add service test:

```python
def test_service_returns_audio_transcript_json():
    response = ModelService(provider_factory=lambda request: FakeProvider('{"segments":[]}')).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "subtitle.transcribe",
            "capability": "audio.transcribe",
            "output": {"kind": "json", "schema": "generic.object.v1"},
            "input": {"audio": "file:///tmp/audio.mp3", "glossary": []},
        }
    )

    assert response["ok"] is True
    assert response["output"]["kind"] == "json"
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_gemini_provider.py tests/test_model_service.py -q
```

Expected: fail until capability and provider support audio input.

**Step 3: Implement minimal audio support**

Use Gemini-compatible input payload generation. Keep output as JSON; do not generate SRT in `aos-cli`. SRT creation remains a harness responsibility.

**Step 4: Create example**

Create `examples/audio-transcribe.request.json`.

**Step 5: Commit**

```bash
git add src/aos_cli/model/registry.py src/aos_cli/model/providers/gemini.py src/aos_cli/model/service.py examples/audio-transcribe.request.json tests/test_gemini_provider.py tests/test_model_service.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 12: Add Embedding Capability

**Files:**
- Modify: `src/aos_cli/model/registry.py`
- Modify: `src/aos_cli/model/providers/gemini.py`
- Modify: `src/aos_cli/model/service.py`
- Create: `examples/embed.request.json`
- Test: `tests/test_gemini_provider.py`
- Test: `tests/test_model_service.py`

**Goal:** Provide a provider-neutral embedding call for future semantic matching without coupling to music-matcher internals.

**Step 1: Write failing tests**

Add service test:

```python
def test_service_returns_embedding_vector():
    response = ModelService(provider_factory=lambda request: FakeEmbeddingProvider([0.1, 0.2])).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "music.match.embed",
            "capability": "embed",
            "output": {"kind": "json", "schema": "generic.object.v1"},
            "input": {"content": "quiet emotional scene"},
        }
    )

    assert response["ok"] is True
    assert response["output"]["data"]["embedding"] == [0.1, 0.2]
```

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_gemini_provider.py tests/test_model_service.py -q
```

Expected: fail until embedding capability exists.

**Step 3: Implement minimal embedding path**

Add provider method for embeddings only if the current Gemini-compatible endpoint supports it. If not, keep the capability disabled and document the provider limitation. Do not fake support in capabilities.

**Step 4: Commit**

If supported:

```bash
git add src/aos_cli/model/registry.py src/aos_cli/model/providers/gemini.py src/aos_cli/model/service.py examples/embed.request.json tests/test_gemini_provider.py tests/test_model_service.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

If not supported:

```bash
git add docs/MODEL_PROTOCOL.md
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 13: Update Preflight for Registered Capabilities

**Files:**
- Modify: `src/aos_cli/model/preflight.py`
- Modify: `src/aos_cli/model/capabilities.py`
- Test: `tests/test_preflight.py`

**Goal:** Preflight should reflect enabled capabilities and provider env requirements.

**Step 1: Write failing tests**

Add tests asserting:

- Fake mode reports all registered capabilities as ok.
- Missing `OPENAI_API_KEY` marks `image.generate` check failed but does not hide `generate`.
- Missing `ARK_API_KEY` marks `video.generate` check failed.

**Step 2: Run tests to verify failure**

Run:

```bash
uv run pytest tests/test_preflight.py -q
```

Expected: fail until preflight is capability-aware.

**Step 3: Implement capability-aware checks**

Keep checks shallow for non-text providers unless real provider smoke calls are safe:

- Gemini generate: minimal real request, as today.
- Image: env + optional dry transport seam. Avoid spending image quota during preflight.
- Video: env + endpoint/auth probe only if provider supports low-cost probe.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_preflight.py -q
```

Expected: pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/preflight.py src/aos_cli/model/capabilities.py tests/test_preflight.py
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 14: Add AgentOS-TS Migration Examples

**Files:**
- Create: `examples/storyboard.batch.manifest.json`
- Create: `examples/asset-image.request.json`
- Create: `docs/AOS_CLI_MIGRATION.md`

**Goal:** Show exactly how AgentOS-TS skills should call the gateway without importing provider code.

**Step 1: Create storyboard batch manifest**

Use only generic examples. Do not reference private project paths.

**Step 2: Create asset image request**

Use `image.generate` and `artifactPolicy`.

**Step 3: Write migration guide**

Document:

- Current skill scripts should construct request JSON.
- Skill scripts should call `aos-cli model validate` before `run` or `batch`.
- Skill scripts should call `aos-cli model batch` for high-volume generation.
- Skill scripts should consume response JSON only.
- Skill scripts must not import Gemini/OpenAI/Ark SDKs after migration.

**Step 4: Run fake smoke**

Run:

```bash
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model batch --manifest examples/storyboard.batch.manifest.json --report /tmp/aos-cli-storyboard-batch-report.json
```

Expected: report succeeds once batch exists.

**Step 5: Commit**

```bash
git add examples/storyboard.batch.manifest.json examples/asset-image.request.json docs/AOS_CLI_MIGRATION.md
git commit -F /tmp/aos-cli-lore-commit.txt
```

---

## Task 15: Final Verification

**Files:**
- Modify only if verification exposes defects.

**Step 1: Run full tests**

Run:

```bash
uv run pytest -q
```

Expected: all tests pass.

**Step 2: Run lint**

Run:

```bash
uv run ruff check .
```

Expected: no lint errors.

**Step 3: Run command smoke**

Run:

```bash
uv run aos-cli --help
uv run aos-cli model --help
uv run aos-cli model capabilities --json
uv run aos-cli model validate --input examples/text.request.json
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model run --input examples/text.request.json --output /tmp/aos-cli-text-response.json
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model batch --manifest examples/batch.manifest.json --report /tmp/aos-cli-batch-report.json
```

Expected: all commands return expected exit codes and machine-readable output.

**Step 4: Check forbidden coupling**

Run:

```bash
rg -n "AgentOS-TS|pipeline-state|storyboard\\.scene|asset\\.character|video\\.clip" src/aos_cli
```

Expected: no business-stage branching in source code. Names may appear only in examples and docs.

**Step 5: Check worktree**

Run:

```bash
git status --short
```

Expected: no unstaged feature files. If `uv.lock` only has unrelated registry URL changes, leave it uncommitted unless intentionally resolved.

**Step 6: Commit fixes if needed**

If verification requires fixes:

```bash
git add <changed-files>
git commit -F /tmp/aos-cli-lore-commit.txt
```

Skip if no files changed.

---

## Milestone Definition of Done

The minimal capability gateway is complete when:

- `validate` catches malformed requests before provider calls.
- `run` supports `generate`, `image.generate`, `vision.analyze`, `audio.transcribe`, and `embed` only when provider support is real.
- `submit` and `poll` support `video.generate` async lifecycle.
- `batch` runs bounded local jobs with per-job responses and a machine-readable report.
- Artifact-producing capabilities return stable descriptors.
- `capabilities` reflects only actually enabled capabilities.
- `preflight` reports capability-specific readiness.
- AgentOS-TS migration examples show file-based calls without provider SDK imports.
- Tests and lint pass.
- Source code has no AgentOS business-stage branches.
