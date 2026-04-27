# aos-cli

`aos-cli model` is the stable model capability boundary CLI for AgentOS. It validates model request envelopes, routes supported capabilities to provider adapters, and writes normalized JSON responses.

It is not a pipeline runtime, daemon service, workspace manager, storyboard/video workflow engine, provider raw API, or AgentOS business CLI.

## Process Model

`aos-cli` is intentionally **run on demand**.

Do not keep a background daemon alive for the current milestone. Provider work
dominates latency, while a daemon would add lifecycle, port, lock, restart, and
state-recovery complexity before there is a real need for shared in-memory
state.

## Commands

```bash
aos-cli model ...
```

Stable boundary command surface. The following commands are implemented in the
current milestone and form the preserved `model` namespace contract. Runtime
availability still depends on capability support, environment configuration, and
provider connectivity; use `aos-cli model capabilities --json` plus `aos-cli model preflight --json`
for the live view.

```bash
aos-cli model run --input request.json --output response.json
aos-cli model submit --input video.request.json --output task.json
aos-cli model poll --input task.json --output result.json
aos-cli model batch --manifest manifest.json --report report.json
aos-cli model validate --input request.json
aos-cli model preflight --json
aos-cli model capabilities --json
```

Pass `-` to `--input`/`--output` (and `--manifest`/`--report` for batch) to read
from stdin or write to stdout.

## Install

From `aos-cli/`:

```bash
uv sync
uv run aos-cli model capabilities --json
```

From the AgentOS-TS repository root, business code and skills can call the CLI
without installing a global executable:

```bash
uv run --project aos-cli aos-cli model capabilities --json
```

Use `aos-cli` as the only public executable name. When a global executable is
not installed, use `uv run --project aos-cli aos-cli ...` from the repository
root.

## Configuration

The CLI loads a single `.env` file. If `--env-file PATH` is passed, that file
is loaded. Otherwise, `./.env` (cwd) is loaded if present. No ancestor walk.
Existing shell environment variables always win over `.env` file values.

Expected project-level variables:

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

## Business Integration

A skill or harness should write a request JSON, run the command, and read the
response JSON.

```bash
uv run --project aos-cli aos-cli model run --input /tmp/request.json --output /tmp/response.json
```

For shell-based skills, use the example wrapper:

```bash
bash aos-cli/examples/call_from_skill.sh \
  aos-cli/examples/aos_cli_storyboard_request.json \
  /tmp/aos-cli-storyboard-response.json
```

For Python-based skills, call the CLI as a subprocess and treat exit code `2` as
a structured model failure whose details are in the output JSON.

## Model Calls

Current milestone examples:

```bash
uv run aos-cli model preflight --json
uv run aos-cli model capabilities --json
uv run aos-cli model validate --input examples/text.request.json
uv run aos-cli model run --input examples/text.request.json --output /tmp/aos-cli-response.json
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model batch --manifest examples/batch.manifest.json --report /tmp/aos-cli-batch-report.json
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model submit --input examples/video.submit.request.json --output /tmp/aos-cli-video-task.json
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model poll --input /tmp/aos-cli-video-task.json --output /tmp/aos-cli-video-result.json
```

`preflight` is an environment/connectivity preflight, not a proof that every downstream generation path will succeed. Each reported capability check now declares whether it was verified by a real provider-safe probe, an environment-only check, or fake mode.

## Async Video

Async video stays inside the same boundary contract. When available in a later milestone, video generation uses `submit` and `poll`, not synchronous `run`:

```bash
uv run aos-cli model submit --input examples/video.submit.request.json --output /tmp/aos-cli-video-task.json
uv run aos-cli model poll --input /tmp/aos-cli-video-task.json --output /tmp/aos-cli-video-result.json
```

Protocol details live in [docs/MODEL_PROTOCOL.md](docs/MODEL_PROTOCOL.md).
