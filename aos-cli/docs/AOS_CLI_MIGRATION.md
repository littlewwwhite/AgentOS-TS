# AgentOS-TS Model Gateway Migration

`aos-cli` is the model capability boundary for AgentOS-TS skills and harnesses. AgentOS-TS should construct request JSON files, call `aos-cli model ...`, and consume response JSON files. It should not import Gemini, OpenAI-compatible, Ark, or provider-specific SDKs after migration.

## Boundary

AgentOS-TS owns:

- Stage state and `pipeline-state.json`.
- Prompt selection and business semantics.
- Artifact lifecycle, approval, retries, and human checkpoints.
- Mapping generated model outputs back into project files.

`aos-cli` owns:

- Request envelope validation.
- Provider routing by `capability`, `output.kind`, and explicit `modelPolicy`.
- Provider request/response normalization.
- Stable response envelopes and artifact descriptors.

## Recommended Call Pattern

Run one atomic request:

```bash
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model run \
  --input examples/asset-image.request.json \
  --output /tmp/aos-cli-asset-image-response.json
```

Run high-volume text or JSON jobs through batch:

```bash
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model batch \
  --manifest examples/storyboard.batch.manifest.json \
  --report /tmp/aos-cli-storyboard-batch-report.json
```

Submit and poll async video:

```bash
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model submit \
  --input examples/video.submit.request.json \
  --output /tmp/aos-cli-video-task.json

AOS_CLI_MODEL_FAKE=1 uv run aos-cli model poll \
  --input /tmp/aos-cli-video-task.json \
  --output /tmp/aos-cli-video-result.json
```

## Migration Rules

- Construct request JSON in the skill or harness layer.
- Use `aos-cli model batch` for high-volume storyboard and analysis jobs.
- Use `aos-cli model preflight` to check provider credentials and reachability before launching a batch.
- Consume only the response JSON envelope.
- Treat `trace` and `labels` as observability metadata, not execution controls.
- Keep stage-specific branching out of `aos-cli`.
- Do not import provider SDKs from AgentOS-TS skill scripts after migrating a capability.

## Environment

Provider identity is expressed by model-family environment variables and base URLs:

```bash
GEMINI_API_KEY=...
GEMINI_BASE_URL=https://api.chatfire.cn/gemini
GEMINI_TEXT_MODEL=gemini-3.1-flash-lite
GEMINI_EMBED_MODEL=gemini-embedding-001

OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.chatfire.cn
OPENAI_IMAGE_MODEL=gpt-image-2

ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_VIDEO_MODEL=ep-20260303234827-tfnzm
```

Proxy vendors belong in `*_BASE_URL`; API key names should remain model-family names.
