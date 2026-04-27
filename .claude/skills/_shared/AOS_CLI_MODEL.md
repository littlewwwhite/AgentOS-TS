# aos-cli Model Usage for Skills

`aos-cli model` is the stable model capability boundary for AgentOS skills. Skills own business semantics; `aos-cli` owns model request validation, provider routing, normalized output envelopes, normalized error envelopes, and runtime preflight.

## Use `aos-cli model` for model calls

New or migrated skill scripts should call `aos-cli model` through `_shared/aos_cli_model.py` instead of importing provider SDKs directly.

Use these commands by capability:

| Skill need | Capability | Command |
|---|---|---|
| Text generation | `generate` with `output.kind=text` | `model run` |
| Structured JSON generation | `generate` with `output.kind=json` | `model run` |
| Image generation | `image.generate` with `output.kind=artifact` | `model run` |
| Video generation submit | `video.generate` with `output.kind=task` | `model submit` |
| Video generation poll | `video.generate` with `output.kind=task_result` | `model poll` |
| Image+text review | `vision.review` with `output.kind=json` | `model run` |
| Image+text analysis | `vision.analyze` with `output.kind=json` | `model run` |
| Video analysis | `video.analyze` with `output.kind=json` | `model run` |
| Audio transcription | `audio.transcribe` with `output.kind=json` | `model run` |
| Request-only validation | Any registered capability | `model validate` |
| Runtime readiness | Registered capabilities | `model preflight --json` |
| Capability discovery | Registered capabilities | `model capabilities --json` |

## Keep business logic in the skill

Skills remain responsible for:

- Prompt construction.
- Workspace layout.
- `pipeline-state.json` updates.
- Artifact naming and lifecycle.
- Human approval gates.
- Business retry meaning.
- Mapping model outputs back into AgentOS domain files.

`aos-cli` must not become a pipeline runtime, workspace manager, approval engine, storyboard/video workflow engine, raw provider API, or AgentOS business CLI.

## Adapter contract

Use the thin subprocess adapter:

```python
from pathlib import Path

from aos_cli_model import aos_cli_model_run, aos_cli_model_submit, aos_cli_model_poll, aos_cli_model_validate

request_path = Path("request.json")
response_path = Path("response.json")
completed = aos_cli_model_run(request_path, response_path, cwd=project_dir)
if completed.returncode != 0:
    raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
```

The adapter must stay thin:

- It may find and execute `aos-cli`.
- It may pass file paths and return `subprocess.CompletedProcess`.
- It must not parse response JSON.
- It must not import `aos_cli.model` internals.
- It must not encode provider-specific behavior.

The calling skill script should read the JSON response file and use the normalized envelope fields for decisions.

## Request templates

Text generation:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene.prompt",
  "capability": "generate",
  "output": {"kind": "text"},
  "input": {
    "system": "You write concise production prompts.",
    "content": "Write one shot prompt."
  },
  "options": {"temperature": 0.6, "maxOutputTokens": 800}
}
```

JSON generation:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene.json",
  "capability": "generate",
  "output": {"kind": "json"},
  "input": {
    "system": "Return only JSON.",
    "content": {"scene": "moonlit courtyard"}
  },
  "options": {"temperature": 0, "maxOutputTokens": 1200}
}
```

Image generation:

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "asset.character.front",
  "capability": "image.generate",
  "output": {"kind": "artifact"},
  "input": {"prompt": "A cinematic character concept portrait under moonlight."},
  "artifactPolicy": {
    "download": true,
    "localDir": "workspace/project/output/actors",
    "role": "character.front"
  }
}
```

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
      { "url": "https://.../loc_002.png", "role": "reference_image", "name": "loc_002" },
      { "url": "data:image/jpeg;base64,...", "role": "first_frame", "name": "lsi" }
    ]
  }
}
```

`[图N]` markers in `prompt` are 1-based indexes into `input.referenceImages[]`
entries with `role: "reference_image"`; Ark binds them by index. The boundary
forwards each entry into Ark's `content[]` array, preserving its `role`.

Continuity between consecutive clips is expressed as an extra
`referenceImages[]` entry with `role: "first_frame"` carrying the previous
clip's last-shot first frame. The `url` may be either a public http(s) URL or
a `data:image/jpeg;base64,...` URI for inline injection — base64 lets the
caller skip an external bucket. The first-frame entry is **not** indexed by
`[图N]`, so it never collides with subject-binding refs.

`referenceImages[]` is optional — omit it for plain text-to-video generation.

Video poll can use the task envelope returned by submit as input to `model poll`.

## Response handling

Use response JSON fields for business decisions:

- `ok`
- `output.kind`
- `output.text`
- `output.data`
- `output.artifacts`
- `output.taskId`
- `output.status`
- `error.code`
- `error.retryable`
- `provider`
- `model`
- `usage`
- `latencyMs`
- `warnings`

Do not use stderr text for business decisions. Stderr is diagnostic only.

## Error policy

Skills should treat these canonical error codes as stable:

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

Only these codes are retryable by infrastructure default:

- `RATE_LIMITED`
- `PROVIDER_TIMEOUT`
- `PROVIDER_UNAVAILABLE`

Business-level retry policy still belongs to the calling skill.

## Migration rule

Do not add new direct provider SDK calls in skill scripts. Existing direct Gemini, OpenAI-compatible, ChatFire, and Ark calls are legacy migration targets.

Recommended migration order:

1. Text and JSON generation in `storyboard` and `asset-gen` review/prompt scripts.
2. Image generation in `asset-gen`.
3. Video submit/poll in `video-gen`.
4. Remaining multimodal video review paths only after confirming the current `aos-cli` protocol covers the required input/output shape.

Asset image review and `video-gen/scripts/frame_extractor.py` frame description are migrated through `vision.review`. `video-editing/scripts/phase1_analyze.py`, `video-editing/scripts/phase2_assemble.py`, `music-matcher/scripts/analyze_video.py`, and `video-gen/scripts/analyzer.py` are migrated through `video.analyze`. `music-matcher/scripts/batch_analyze.py` reuses the same boundary. `subtitle-maker/scripts/phase2_transcribe.py` is migrated through `audio.transcribe`. Do not force future multimodal work through generic `generate` if doing so would hide domain-specific input/output semantics.

## Deferred Paths Registry

There are no remaining deferred multimodal skill paths. The former video-gen config deferral was retired after generated-video review and frame description both moved behind `aos-cli model` capabilities and the skill stopped projecting provider secrets into its own config.

Adding a new direct provider SDK call inside a skill is not sanctioned. Add or extend an explicit `aos-cli model` capability instead.
