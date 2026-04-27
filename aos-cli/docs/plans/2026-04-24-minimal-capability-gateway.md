# Minimal Capability Gateway Design

Status: proposed  
Scope: `aos-cli` model capability boundary  
Decision priority: correctness, maintainability, simplicity, extensibility, performance

## Problem

AgentOS needs many model calls across script parsing, storyboard generation, visual assets, video generation, review, transcription, and matching. The root problem is not call volume alone. The deeper problem is that provider details leak into business scripts:

- Business scripts know provider-specific base URLs, auth variables, request payloads, and response shapes.
- Success criteria differ across scripts.
- Retry and quota behavior is inconsistent.
- Switching providers risks changing business logic.
- Agents cannot rely on one stable machine contract.

The gateway exists to stop this leakage.

## Goal

`aos-cli` should be the smallest stable boundary between AgentOS business harnesses and model providers.

It must:

- Accept provider-independent request JSON.
- Execute one atomic model capability or batch of atomic capabilities.
- Return stable response JSON.
- Normalize provider errors.
- Validate machine-consumed output.
- Keep business semantics available for traceability without depending on them.

It must not:

- Own AgentOS pipeline state.
- Read or write `pipeline-state.json`.
- Store prompt templates as business knowledge.
- Know episode, scene, storyboard, asset, or video workflow rules.
- Become a workflow engine.

## Core Principle

Business meaning may pass through the gateway, but engineering execution must not depend on business meaning.

Allowed:

```json
{
  "task": "storyboard.scene",
  "trace": {
    "project": "demo",
    "episode": 1,
    "scene": 3
  }
}
```

Forbidden:

```python
if request["task"] == "storyboard.scene":
    run_storyboard_logic()
```

The gateway can log `task` and `trace`. It cannot branch on them.

## Three Result Shapes

All model work fits one of three engineering result shapes.

| Shape | Meaning | Examples |
|---|---|---|
| `sync` | Immediate text or structured data result | text generation, JSON generation, short analysis |
| `artifact` | File or URL result | image, audio, downloaded video, transcript file |
| `async` | Long-running provider task | video generation, long image batches, long transcription |

This is more stable than modeling every business phase as a command.

## Capability Set

Keep capabilities small and modality-oriented.

| Capability | Result shape | First use |
|---|---|---|
| `generate` | `sync` | text and JSON generation |
| `vision.analyze` | `sync` | frame/image/video review |
| `audio.transcribe` | `sync` or `async` | subtitle transcription |
| `image.generate` | `artifact` | character, scene, prop images |
| `video.generate` | `async` then `artifact` | Ark Seedance2 generation |
| `embed` | `sync` | semantic matching |

Do not add business capabilities such as `storyboard.generate`, `asset.character.generate`, or `script.breakdown`. Those belong to the harness layer.

## Command Surface

The stable machine interface should remain generic.

```bash
aos-cli model run --input request.json --output response.json
aos-cli model submit --input request.json --output task.json
aos-cli model poll --input task.json --output result.json
aos-cli model batch --manifest manifest.json --report report.json
aos-cli model validate --input request.json
aos-cli model preflight --json
aos-cli model capabilities --json
```

Optional human-friendly aliases can exist later:

```bash
aos-cli text generate ...
aos-cli image generate ...
aos-cli video submit ...
```

Aliases must compile to the same request envelope. They must not contain a second execution path.

## Request Envelope

The stable request shape should be:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene",
  "capability": "generate",
  "input": {},
  "output": {
    "kind": "json",
    "schema": "storyboard.scene.v1"
  },
  "modelPolicy": {
    "provider": "auto",
    "tier": "fast",
    "model": null
  },
  "retryPolicy": {
    "maxAttempts": 2
  },
  "artifactPolicy": {
    "download": true,
    "localDir": "output/assets"
  },
  "idempotencyKey": "project:e01:s03:storyboard:v1",
  "trace": {
    "project": "demo",
    "stage": "STORYBOARD",
    "episode": 1,
    "scene": 3
  }
}
```

Fields the gateway may use for execution:

- `apiVersion`
- `capability`
- `input`
- `output`
- `modelPolicy`
- `retryPolicy`
- `artifactPolicy`
- `idempotencyKey`

Fields the gateway must only pass through or log:

- `task`
- `trace`
- `labels`

## Response Envelope

Every command should return one stable envelope.

```json
{
  "ok": true,
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene",
  "capability": "generate",
  "output": {
    "kind": "json",
    "data": {},
    "validated": true,
    "schema": "storyboard.scene.v1"
  },
  "provider": "gemini",
  "model": "gemini-3.1-flash-lite",
  "usage": {},
  "latencyMs": 1200,
  "artifacts": [],
  "trace": {},
  "warnings": []
}
```

Failure responses must be equally stable.

```json
{
  "ok": false,
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene",
  "capability": "generate",
  "error": {
    "code": "PROVIDER_QUOTA_EXHAUSTED",
    "message": "quota exhausted",
    "retryable": true,
    "provider": "gemini",
    "statusCode": 429
  },
  "trace": {},
  "warnings": []
}
```

## Artifact Descriptor

Artifact-producing capabilities should return descriptors, not raw provider URLs only.

```json
{
  "kind": "image",
  "uri": "file:///workspace/output/assets/actor-front.png",
  "remoteUrl": "https://provider.example/result.png",
  "mimeType": "image/png",
  "sha256": "abc123",
  "bytes": 123456,
  "role": "character.front"
}
```

Business layers decide where artifacts belong in the project. The gateway only downloads, checks, and reports them according to `artifactPolicy`.

## Batch Manifest

Batch execution solves call volume without requiring a server.

```json
{
  "apiVersion": "aos-cli.model.batch/v1",
  "concurrency": 4,
  "jobs": [
    {
      "id": "e01-s03-storyboard",
      "request": "requests/e01-s03-storyboard.json",
      "output": "responses/e01-s03-storyboard.json"
    }
  ]
}
```

Batch rules:

- Each job is still an atomic request.
- Concurrency is explicit.
- Responses are written per job.
- The report contains counts, failures, retryable failures, provider usage, and artifact paths.
- Batch must not hide failed jobs behind a zero exit code unless explicitly configured.

## Provider Boundary

Provider adapters translate the stable envelope into provider-specific calls.

Provider adapters may know:

- Auth env names.
- Base URLs.
- Provider payloads.
- Provider response shapes.
- Provider-specific retry signals.

Provider adapters may not know:

- AgentOS stage state.
- Script or storyboard workflow rules.
- Project directory conventions beyond explicit `artifactPolicy`.
- Business schemas beyond validation input.

## Minimal Internal Structure

```text
src/aos_cli/
  cli.py
  model/
    protocol.py
    service.py
    router.py
    capabilities.py
    config.py
    errors.py
    validators.py
    artifacts.py
    batch.py
    providers/
      gemini.py
      openai_image.py
      ark_video.py
```

Do not add plugin loading, database persistence, daemon mode, or a web server in this phase.

## Migration Order

Use migration order to reduce risk.

1. Harden `generate` for text and JSON.
2. Add `validate` so harnesses can fail before spending tokens.
3. Add `batch` so high-volume storyboard and asset prompt calls have one stable execution path.
4. Migrate storyboard text/JSON generation.
5. Migrate asset text/JSON generation.
6. Add `image.generate` and migrate `gpt-image-2`.
7. Add `vision.analyze` for frame/image/video review.
8. Add `audio.transcribe` for subtitle workflows.
9. Add `video.generate` with `submit` and `poll`.

Do not migrate Claude Agent SDK sessions. They are an interaction runtime, not an atomic model capability.

## Testing Strategy

Minimum tests before each migration:

- Request validation rejects malformed envelopes.
- Response envelope stays stable.
- Provider errors normalize to stable codes.
- JSON output validation fails closed.
- Artifact descriptors contain path, URL, hash, and MIME type when available.
- Batch reports partial failures clearly.
- Fake provider can run without credentials.

Recommended smoke commands:

```bash
uv run pytest -q
uv run ruff check .
uv run aos-cli model validate --input examples/text.request.json
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model run --input examples/text.request.json --output /tmp/aos-cli-response.json
```

## Non-Goals

Do not implement these until there is evidence they are needed:

- Rust rewrite.
- Server mode.
- Worker mode.
- Provider plugin system.
- Persistent queue.
- Business commands such as `aos-cli storyboard`.
- Pipeline state ownership.

## Acceptance Criteria

The design is successful if:

- AgentOS-TS can replace provider SDK calls with CLI request files.
- Provider changes do not modify business scripts.
- Business schemas evolve without provider adapter changes.
- High-volume calls can run through `batch` with bounded concurrency.
- Errors are actionable without reading provider raw responses.
- The core has no business-stage branches.
