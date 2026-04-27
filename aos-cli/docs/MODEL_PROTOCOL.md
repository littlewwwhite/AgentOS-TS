# aos-cli Model Protocol

`aos-cli model` is the stable machine interface for atomic model calls. It is not a pipeline runtime, daemon service, workspace manager, storyboard/video workflow engine, provider raw API, or AgentOS business CLI.

Status note: this document defines the stable boundary contract for commands that are implemented in the current milestone. Runtime availability still depends on capability support, environment configuration, and provider connectivity. Use `aos-cli model capabilities --json` plus `aos-cli model preflight --json` as the runtime source of truth.

## Boundary

AgentOS owns:

- Business semantics.
- `pipeline-state.json`.
- Workspace layout.
- Artifact lifecycle.
- Human approval gates.
- Prompt construction.
- Business retry meaning.

`aos-cli model` owns:

- Request envelope validation.
- Capability registry lookup.
- Provider routing.
- Provider configuration resolution.
- Normalized response envelopes.
- Normalized error envelopes.
- Usage, latency, trace, and label metadata.

Provider adapters own:

- Provider request shapes.
- Authentication headers.
- Provider response parsing.
- Artifact download mechanics.

## Commands

Preserved boundary command surface for the `model` namespace:

```bash
aos-cli model run --input examples/text.request.json --output /tmp/aos-cli-response.json
aos-cli model batch --manifest examples/batch.manifest.json --report /tmp/aos-cli-batch-report.json
aos-cli model submit --input examples/video.submit.request.json --output /tmp/aos-cli-video-task.json
aos-cli model poll --input /tmp/aos-cli-video-task.json --output /tmp/aos-cli-video-result.json
aos-cli model validate --input examples/text.request.json
aos-cli model preflight --json
aos-cli model capabilities --json
```

These commands are implemented in the current milestone. Capability-specific success still depends on request validity, configured credentials, and provider availability.

Pass `-` to `--input`/`--output` (and `--manifest`/`--report` for batch) to read from stdin or write to stdout.

## Validation vs Preflight

`model validate` checks one request envelope. It parses JSON, validates required fields, validates `apiVersion`, validates `capability`, and validates `output.kind`. It must not load provider clients, make network calls, generate content, submit tasks, poll tasks, or download artifacts.

`model preflight --json` checks the local runtime environment and configured providers. It may inspect environment variables, provider configuration, dependency availability, and safe connectivity checks. It must not generate content. Each check includes `probeMode`: `provider` for a real safe provider probe, `env` for an environment-only check, and `fake` for deterministic fake mode.

## Process IO Contract

- When writing to `--output <file>`, machine response data goes to that file.
- When writing to `--output -`, stdout contains only JSON.
- `model validate`, `model preflight --json`, and `model capabilities --json` write only JSON to stdout.
- Human-readable diagnostics go to stderr.
- Callers must use response JSON fields for business decisions, not stderr text.
- Exit codes indicate process-level command status; detailed model failure semantics live in the JSON envelope.

## Intentionally Deferred

The following are intentionally out of scope until a concrete requirement appears:

- `aos-cli model serve` or any daemon mode.
- Raw provider API commands.
- AgentOS pipeline, workspace, storyboard, video, or editing commands.
- CLI plugin systems.
- Sidecar credential daemons.
- General-purpose AI CLI framework behavior.

Daemon mode can be reconsidered only if multiple repositories must share the gateway, centralized credential isolation is mandatory, queueing/rate limiting/auditing becomes mandatory, or subprocess startup cost is proven significant.

## Request Envelope

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene.prompt",
  "capability": "generate",
  "output": {
    "kind": "text"
  },
  "input": {
    "system": "You write concise production prompts.",
    "content": {
      "scene": "moonlit courtyard"
    }
  },
  "modelPolicy": {
    "model": "gemini-3.1-flash-lite"
  },
  "options": {
    "temperature": 0.6,
    "maxOutputTokens": 800,
    "timeoutSeconds": 180
  }
}
```

Required fields:

- `apiVersion`: must be `aos-cli.model/v1`.
- `task`: caller-owned task label for traceability.
- `capability`: one registered model capability.
- `output.kind`: one output kind supported by the selected capability.
- `input`: model input payload. `system` is optional; `content` may be a string or JSON-compatible value.

Optional fields:

- `modelPolicy.model`: request-scoped model override.
- `options`: provider-agnostic generation options.
- `trace`: caller-owned observability metadata, passed through unchanged.
- `labels`: caller-owned labels, passed through unchanged.

## Capabilities

`aos-cli model capabilities --json` is the runtime source of truth for currently available capabilities, output kinds, and provider-backed routes. Any table in this document is illustrative contract guidance and may describe boundary targets that are not enabled in the current milestone.

Illustrative registered capability shape:

| Capability | Output kind | Command path | Provider family |
|---|---|---|---|
| `generate` | `text`, `json` | `run` | `gemini` |
| `image.generate` | `artifact` | `run` | `openai_compatible` |
| `vision.analyze` | `json` | `run` | `gemini` |
| `vision.review` | `json` | `run` | `gemini` |
| `audio.transcribe` | `json` | `run` | `gemini` |
| `embed` | `vector` | `run` | `gemini` |
| `video.generate` | `task`, `task_result` | `submit` / `poll` | `ark` |

`video.generate` is one registered capability with an async lifecycle: `submit` uses `task`, and `poll` uses `task_result`.

Callers must not infer availability from this table alone.

```bash
aos-cli model capabilities --json
```

Use the command output for machine decisions.

## Success Envelope

```json
{
  "ok": true,
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene.prompt",
  "capability": "generate",
  "output": {
    "kind": "text",
    "text": "..."
  },
  "provider": "gemini",
  "model": "gemini-3.1-flash-lite",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0
  },
  "latencyMs": 42,
  "warnings": []
}
```

For JSON output:

```json
{
  "kind": "json",
  "data": {
    "title": "ok"
  }
}
```

For vector output:

```json
{
  "kind": "vector",
  "values": [0.013, -0.044, 0.082],
  "dimension": 768
}
```

For artifact output:

```json
{
  "kind": "artifact",
  "artifacts": [
    {
      "kind": "image",
      "uri": "file:///tmp/aos-cli-image/image.png",
      "remoteUrl": "https://example.com/image.png",
      "mimeType": "image/png",
      "sha256": "hex-encoded-sha256",
      "bytes": 12345,
      "role": "character.front"
    }
  ]
}
```

Artifact descriptors use `uri` as the canonical local or remote reference. When a provider returns a remote URL and the caller requests local download, `remoteUrl` preserves the provider location while `uri`, `sha256`, and `bytes` describe the local file.

## Failure Envelope

```json
{
  "ok": false,
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene.prompt",
  "capability": "generate",
  "error": {
    "code": "AUTH_ERROR",
    "message": "GEMINI_API_KEY is not set",
    "retryable": false,
    "provider": "gemini",
    "statusCode": 401
  },
  "warnings": []
}
```

Canonical error codes:

- `INVALID_REQUEST`
- `UNSUPPORTED_CAPABILITY`
- `UNSUPPORTED_OUTPUT_KIND`
- `CONFIG_ERROR`
- `AUTH_ERROR`
- `RATE_LIMITED`
- `PROVIDER_TIMEOUT`
- `PROVIDER_REJECTED`
- `PROVIDER_UNAVAILABLE`
- `ARTIFACT_ERROR`
- `INTERNAL_ERROR`

Legacy public provider error labels may still be normalized at the boundary for compatibility, but new callers should treat only the canonical codes above as stable.

## Environment

The CLI loads a single `.env` file. If `--env-file PATH` is passed, that file
is loaded. Otherwise, `./.env` (cwd) is loaded if present. No ancestor walk.
Existing shell environment variables always win over `.env` file values.

```bash
GEMINI_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_TEXT_MODEL=gemini-3.1-flash-lite
GEMINI_EMBED_MODEL=gemini-embedding-001

OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.chatfire.cn
OPENAI_IMAGE_MODEL=gpt-image-2

ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=ep-20260303234827-tfnzm
```

For a Gemini-compatible proxy, keep the same env names and point `GEMINI_BASE_URL` at the proxy base URL. Do not add provider-branded API key names to the harness contract.

For deterministic local smoke tests:

```bash
AOS_CLI_MODEL_FAKE=1 aos-cli model run --input examples/text.request.json --output /tmp/aos-cli-response.json
```

## Batch

Batch manifests run many atomic request files with bounded local concurrency:

```json
{
  "apiVersion": "aos-cli.model.batch/v1",
  "concurrency": 2,
  "jobs": [
    {
      "id": "text-job",
      "request": "examples/text.request.json",
      "output": "/tmp/aos-cli-batch-text.json"
    }
  ]
}
```

The report contains `total`, `succeeded`, `failed`, `retryableFailed`, and per-job status entries.

Batch only runs synchronous `run` jobs. Video `submit`/`poll` are not supported in a batch manifest; orchestrate them from the skill.

## Async Video

Video generation uses explicit async lifecycle commands:

```bash
aos-cli model submit --input examples/video.submit.request.json --output /tmp/aos-cli-video-task.json
aos-cli model poll --input /tmp/aos-cli-video-task.json --output /tmp/aos-cli-video-result.json
```

`submit` returns `output.kind=task`; `poll` returns `output.kind=task_result`.
