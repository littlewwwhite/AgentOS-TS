# aos-cli Model Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `aos-cli model` into a minimal model capability boundary CLI without turning it into a daemon, workflow engine, provider raw API, or AgentOS business runtime.

**Architecture:** AgentOS skills keep business semantics, workspace state, artifact lifecycle, prompt construction, and approval gates. `aos-cli model` owns request envelope validation, capability discovery, provider routing, normalized responses, normalized errors, and runtime preflight. The shared skill adapter remains a thin subprocess boundary.

**Tech Stack:** Python 3.11+, `uv`, `argparse`, `pytest`, JSON file/stdin/stdout contracts, existing `aos_cli.model` modules.

---

## Scope

Implement only boundary-hardening changes:

- Clarify docs so `aos-cli model` is described as a model boundary CLI, not a service/runtime.
- Add a narrow `aos-cli model validate --input ...` command that validates request envelopes without provider calls.
- Lock request/response/stdio contracts with tests.
- Make capability metadata consistency explicit.
- Normalize the smallest error taxonomy needed by callers.
- Keep `.claude/skills/_shared/aos_cli_model.py` thin.
- Explicitly defer daemon service, provider raw API, AgentOS business commands, CLI plugin systems, and sidecar credential daemons.

Do not implement:

- `aos-cli model serve`.
- Any HTTP/gRPC daemon.
- Provider raw API commands.
- Pipeline/workspace/storyboard/video business commands.
- A CLI plugin system.
- Broad skill migration.

---

## Current File Map

### Existing files to modify

- `aos-cli/README.md`  
  Public CLI overview and command list. Update boundary language and include `model validate`.

- `aos-cli/docs/MODEL_PROTOCOL.md`  
  Machine contract documentation. Add owner boundary, validate/preflight distinction, stdout/stderr discipline, and deferred items.

- `docs/specs/2026-04-24-aos-cli-model-service.md`  
  Existing higher-level spec. Reword ambiguous “service” language so it means model boundary/gateway CLI, not daemon service.

- `docs/plans/2026-04-24-aos-cli-model-service.md`  
  Existing implementation plan. Add a note that current work supersedes daemon-oriented interpretation and defers `serve`.

- `aos-cli/src/aos_cli/cli.py`  
  CLI parser and command dispatcher. Add `model validate`, stdin JSON reading if missing for the new command, and deterministic JSON output.

- `aos-cli/src/aos_cli/model/protocol.py`  
  Request parsing and response envelope helpers. Add validation payload helpers and fix unsupported output kind error classification if needed.

- `aos-cli/src/aos_cli/model/errors.py`  
  Model service error type. Add canonical error-code constants and retryability defaults if they do not already exist.

- `aos-cli/src/aos_cli/model/registry.py`  
  Single source of truth for capabilities. Keep capabilities and output kinds here.

- `aos-cli/src/aos_cli/model/capabilities.py`  
  Capability discovery payload. Ensure it derives from `registry.py` only.

- `aos-cli/src/aos_cli/model/service.py`  
  Dispatch map and provider error normalization. Ensure dispatch capabilities are covered by registry and standard errors.

- `.claude/skills/_shared/aos_cli_model.py`  
  Thin skill-side adapter. Add only a validate wrapper if needed; do not add business logic.

### Existing tests to modify or extend

- `aos-cli/tests/test_model_protocol.py`  
  Unit tests for request validation and response shape.

- `aos-cli/tests/test_model_run_cli.py`  
  Existing CLI command tests. Use as style reference for file/stdout behavior.

- `aos-cli/tests/test_cli_stdio.py`  
  Existing stdin/stdout tests. Add validate stdio coverage here if it matches current style.

- `aos-cli/tests/test_capabilities.py`  
  Capability payload tests. Add registry consistency checks.

- `aos-cli/tests/test_model_service.py`  
  Service error normalization tests.

- `.claude/skills/_shared/test_aos_cli_model.py`  
  Adapter smoke tests. Add validate wrapper coverage only if the adapter exposes it.

### New files to create

- None required.

Prefer modifying existing focused test files over creating new test files unless the current files are too crowded.

---

## Task 1: Clarify Boundary Documentation

**Files:**
- Modify: `aos-cli/README.md`
- Modify: `aos-cli/docs/MODEL_PROTOCOL.md`
- Modify: `docs/specs/2026-04-24-aos-cli-model-service.md`
- Modify: `docs/plans/2026-04-24-aos-cli-model-service.md`

- [ ] **Step 1: Update the command list in `aos-cli/README.md`**

Add `model validate` to the command list and make the boundary statement explicit. The top section should communicate this meaning in English:

```markdown
# aos-cli

`aos-cli model` is the stable model capability boundary CLI for AgentOS. It validates model request envelopes, routes supported capabilities to provider adapters, and writes normalized JSON responses.

It is not a pipeline runtime, daemon service, workspace manager, storyboard/video workflow engine, provider raw API, or AgentOS business CLI.
```

The command list should include exactly this model namespace shape:

```markdown
```bash
aos-cli model run --input request.json --output response.json
aos-cli model submit --input video.request.json --output task.json
aos-cli model poll --input task.json --output result.json
aos-cli model batch --manifest manifest.json --report report.json
aos-cli model validate --input request.json
aos-cli model preflight --json
aos-cli model capabilities --json
```
```

- [ ] **Step 2: Define ownership boundaries in `aos-cli/docs/MODEL_PROTOCOL.md`**

Add a section near the top:

```markdown
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
```

- [ ] **Step 3: Define `validate` vs `preflight` in `MODEL_PROTOCOL.md`**

Add this section after the command list:

```markdown
## Validation vs Preflight

`model validate` checks one request envelope. It parses JSON, validates required fields, validates `apiVersion`, validates `capability`, and validates `output.kind`. It must not load provider clients, make network calls, generate content, submit tasks, poll tasks, or download artifacts.

`model preflight --json` checks the local runtime environment and configured providers. It may inspect environment variables, provider configuration, dependency availability, and safe connectivity checks. It must not generate content.
```

- [ ] **Step 4: Add stdout/stderr discipline to `MODEL_PROTOCOL.md`**

Add:

```markdown
## Process IO Contract

- When writing to `--output <file>`, machine response data goes to that file.
- When writing to `--output -`, stdout contains only JSON.
- `model validate`, `model preflight --json`, and `model capabilities --json` write only JSON to stdout.
- Human-readable diagnostics go to stderr.
- Callers must use response JSON fields for business decisions, not stderr text.
- Exit codes indicate process-level command status; detailed model failure semantics live in the JSON envelope.
```

- [ ] **Step 5: Add explicit deferred items to `MODEL_PROTOCOL.md`**

Add:

```markdown
## Intentionally Deferred

The following are intentionally out of scope until a concrete requirement appears:

- `aos-cli model serve` or any daemon mode.
- Raw provider API commands.
- AgentOS pipeline, workspace, storyboard, video, or editing commands.
- CLI plugin systems.
- Sidecar credential daemons.
- General-purpose AI CLI framework behavior.

Daemon mode can be reconsidered only if multiple repositories must share the gateway, centralized credential isolation is mandatory, queueing/rate limiting/auditing becomes mandatory, or subprocess startup cost is proven significant.
```

- [ ] **Step 6: Reword ambiguous service language in existing spec and plan**

In `docs/specs/2026-04-24-aos-cli-model-service.md` and `docs/plans/2026-04-24-aos-cli-model-service.md`, replace language that implies a daemon service with language that means model boundary CLI. Keep historical file names unchanged.

Use wording like:

```markdown
In this document, “model service” means the local `aos-cli model` boundary and its internal service object. It does not mean a daemon, web server, remote service, workflow engine, or deployment unit.
```

If the documents mention `serve --port`, add a note next to it:

```markdown
`serve` is intentionally deferred. The current boundary is the CLI process contract.
```

- [ ] **Step 7: Review docs for forbidden implications**

Search manually in the touched docs for these strings and make sure they are either absent or explicitly deferred:

```text
serve --port
raw provider
pipeline runtime
workspace manager
workflow engine
AgentOS CLI
```

- [ ] **Step 8: Commit documentation boundary changes**

Run:

```bash
git diff -- aos-cli/README.md aos-cli/docs/MODEL_PROTOCOL.md docs/specs/2026-04-24-aos-cli-model-service.md docs/plans/2026-04-24-aos-cli-model-service.md
```

Expected: docs only, no source implementation.

Commit:

```bash
git add aos-cli/README.md aos-cli/docs/MODEL_PROTOCOL.md docs/specs/2026-04-24-aos-cli-model-service.md docs/plans/2026-04-24-aos-cli-model-service.md
git commit -m "Clarify aos-cli model boundary"
```

---

## Task 2: Add Protocol-Level Validation Helpers

**Files:**
- Modify: `aos-cli/src/aos_cli/model/protocol.py`
- Modify: `aos-cli/tests/test_model_protocol.py`

- [ ] **Step 1: Write failing tests for validation success and failure payloads**

Append tests to `aos-cli/tests/test_model_protocol.py`:

```python
def test_validate_request_payload_accepts_valid_request():
    from aos_cli.model.protocol import validate_request_payload

    response = validate_request_payload(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "validate-text",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hello"},
            "trace": {"requestId": "r1"},
            "labels": {"stage": "test"},
        }
    )

    assert response == {
        "ok": True,
        "apiVersion": "aos-cli.model/v1",
        "task": "validate-text",
        "capability": "generate",
        "warnings": [],
        "trace": {"requestId": "r1"},
        "labels": {"stage": "test"},
    }


def test_validate_request_payload_rejects_missing_input():
    from aos_cli.model.protocol import validate_request_payload

    response = validate_request_payload(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "bad-request",
            "capability": "generate",
            "output": {"kind": "text"},
        }
    )

    assert response["ok"] is False
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["task"] == "bad-request"
    assert response["capability"] == "generate"
    assert response["error"]["code"] == "INVALID_REQUEST"
    assert response["error"]["retryable"] is False
    assert response["warnings"] == []


def test_parse_request_uses_unsupported_output_kind_code():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "bad-output-kind",
                "capability": "generate",
                "output": {"kind": "artifact"},
                "input": {"content": "hello"},
            }
        )

    assert exc.value.code == "UNSUPPORTED_OUTPUT_KIND"
```

- [ ] **Step 2: Run protocol tests to verify failure**

Run from repo root:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_model_protocol.py -q
```

Expected: FAIL because `validate_request_payload` does not exist and/or unsupported output kind still uses the old code.

- [ ] **Step 3: Implement validation helpers in `protocol.py`**

Modify `aos-cli/src/aos_cli/model/protocol.py`.

First, change unsupported output kind classification in `parse_request`:

```python
    if payload["output"]["kind"] not in capability.output_kinds:
        raise ModelServiceError(
            "UNSUPPORTED_OUTPUT_KIND",
            f"Unsupported output kind: {payload['output']['kind']}",
        )
```

Then add this helper after `failure_response`:

```python
def validate_request_payload(payload: dict) -> dict:
    try:
        request = parse_request(payload)
    except ModelServiceError as exc:
        metadata = envelope_metadata(payload) if isinstance(payload, dict) else {}
        return failure_response(
            task=payload.get("task", "unknown") if isinstance(payload, dict) else "unknown",
            capability=payload.get("capability", "unknown") if isinstance(payload, dict) else "unknown",
            code=exc.code,
            message=exc.message,
            retryable=exc.retryable,
            provider=exc.provider,
            status_code=exc.status_code,
            **metadata,
        )

    metadata = envelope_metadata(request)
    response = {
        "ok": True,
        "apiVersion": API_VERSION,
        "task": request["task"],
        "capability": request["capability"],
        "warnings": [],
    }
    response.update(metadata)
    return response
```

- [ ] **Step 4: Run protocol tests to verify pass**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_model_protocol.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit protocol validation helper**

Run:

```bash
git diff -- aos-cli/src/aos_cli/model/protocol.py aos-cli/tests/test_model_protocol.py
git add aos-cli/src/aos_cli/model/protocol.py aos-cli/tests/test_model_protocol.py
git commit -m "Add model request validation payload"
```

---

## Task 3: Add `aos-cli model validate`

**Files:**
- Modify: `aos-cli/src/aos_cli/cli.py`
- Modify: `aos-cli/tests/test_cli_stdio.py`
- Modify: `aos-cli/tests/test_model_run_cli.py` only if current CLI command tests are consolidated there

- [ ] **Step 1: Write failing CLI test for file input**

Add this test to the existing CLI test file that already calls `aos_cli.cli.main`. Prefer `aos-cli/tests/test_cli_stdio.py` if it owns stdin/stdout behavior; otherwise use `aos-cli/tests/test_model_run_cli.py`.

```python
import json

from aos_cli.cli import main


def test_model_validate_reads_request_file_and_prints_json(tmp_path, capsys):
    request_path = tmp_path / "request.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "validate-file",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hello"},
            }
        ),
        encoding="utf-8",
    )

    exit_code = main(["model", "validate", "--input", str(request_path)])

    captured = capsys.readouterr()
    response = json.loads(captured.out)
    assert exit_code == 0
    assert response["ok"] is True
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["task"] == "validate-file"
    assert response["capability"] == "generate"
    assert response["warnings"] == []
    assert captured.err == ""
```

- [ ] **Step 2: Write failing CLI test for invalid JSON**

Add next to the previous test:

```python
def test_model_validate_invalid_json_returns_json_failure(tmp_path, capsys):
    request_path = tmp_path / "request.json"
    request_path.write_text("{bad json", encoding="utf-8")

    exit_code = main(["model", "validate", "--input", str(request_path)])

    captured = capsys.readouterr()
    response = json.loads(captured.out)
    assert exit_code == 1
    assert response["ok"] is False
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["task"] == "unknown"
    assert response["capability"] == "unknown"
    assert response["error"]["code"] == "INVALID_REQUEST"
    assert response["error"]["retryable"] is False
    assert captured.err == ""
```

- [ ] **Step 3: Write failing CLI test for stdin input**

Add next to the previous tests:

```python
def test_model_validate_reads_stdin_and_prints_json(monkeypatch, capsys):
    monkeypatch.setattr(
        "sys.stdin",
        type(
            "FakeStdin",
            (),
            {
                "read": lambda self: json.dumps(
                    {
                        "apiVersion": "aos-cli.model/v1",
                        "task": "validate-stdin",
                        "capability": "generate",
                        "output": {"kind": "text"},
                        "input": {"content": "hello"},
                    }
                )
            },
        )(),
    )

    exit_code = main(["model", "validate", "--input", "-"])

    captured = capsys.readouterr()
    response = json.loads(captured.out)
    assert exit_code == 0
    assert response["ok"] is True
    assert response["task"] == "validate-stdin"
    assert captured.err == ""
```

- [ ] **Step 4: Run CLI tests to verify failure**

Run the specific file where tests were added:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_cli_stdio.py -q
```

If tests were added to `test_model_run_cli.py`, run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_model_run_cli.py -q
```

Expected: FAIL because `validate` subcommand is not registered.

- [ ] **Step 5: Add parser support in `cli.py`**

In `build_parser()` after the `batch` parser and before `preflight`, add:

```python
    validate = model_commands.add_parser("validate")
    validate.add_argument("--input", required=True)
```

- [ ] **Step 6: Import validation helper in `cli.py`**

Change the protocol import in `aos-cli/src/aos_cli/cli.py` from:

```python
from aos_cli.model.protocol import failure_response
```

to:

```python
from aos_cli.model.protocol import failure_response, validate_request_payload
```

- [ ] **Step 7: Add small JSON input helper in `cli.py`**

Add near existing private helpers:

```python
def _read_json_argument(path: str) -> dict:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    return json.loads(raw)
```

- [ ] **Step 8: Add validation failure helper in `cli.py`**

Add near `_single_request_failure`:

```python
def _validation_json_failure(message: str) -> dict:
    return failure_response(
        task="unknown",
        capability="unknown",
        code="INVALID_REQUEST",
        message=message,
        retryable=False,
    )
```

- [ ] **Step 9: Add validate command branch in `run_model_command()`**

Add before `preflight`:

```python
    if args.model_command == "validate":
        try:
            payload = _read_json_argument(args.input)
        except json.JSONDecodeError as exc:
            response = _validation_json_failure(f"Request file is not valid JSON: {exc.msg}")
        except OSError as exc:
            response = _validation_json_failure(str(exc))
        else:
            response = validate_request_payload(payload)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0 if response.get("ok") else 1
```

- [ ] **Step 10: Run CLI validate tests**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_cli_stdio.py -q
```

Or the file where the tests were added.

Expected: PASS.

- [ ] **Step 11: Run existing CLI smoke tests**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_cli_smoke.py aos-cli/tests/test_model_run_cli.py aos-cli/tests/test_cli_stdio.py -q
```

Expected: PASS.

- [ ] **Step 12: Commit CLI validate command**

Run:

```bash
git diff -- aos-cli/src/aos_cli/cli.py aos-cli/tests/test_cli_stdio.py aos-cli/tests/test_model_run_cli.py
git add aos-cli/src/aos_cli/cli.py aos-cli/tests/test_cli_stdio.py aos-cli/tests/test_model_run_cli.py
git commit -m "Add model validate command"
```

Only add the test file that was actually modified.

---

## Task 4: Lock Capability Registry Consistency

**Files:**
- Modify: `aos-cli/tests/test_capabilities.py`
- Modify: `aos-cli/src/aos_cli/model/service.py` only if tests reveal inconsistency
- Modify: `aos-cli/src/aos_cli/model/capabilities.py` only if tests reveal inconsistency
- Modify: `aos-cli/src/aos_cli/model/registry.py` only if tests reveal inconsistency

- [ ] **Step 1: Write failing or confirming registry consistency tests**

Append to `aos-cli/tests/test_capabilities.py`:

```python
from aos_cli.model.capabilities import capabilities_payload
from aos_cli.model.registry import CAPABILITIES
from aos_cli.model.service import _RUN_DISPATCH


def test_every_run_dispatch_capability_exists_in_registry():
    assert set(_RUN_DISPATCH).issubset(set(CAPABILITIES))


def test_every_registry_capability_appears_in_capabilities_payload():
    payload = capabilities_payload()
    names = {capability["name"] for capability in payload["capabilities"]}
    assert names == set(CAPABILITIES)


def test_capabilities_payload_uses_registry_output_kinds():
    payload = capabilities_payload()
    by_name = {capability["name"]: capability for capability in payload["capabilities"]}

    for name, capability in CAPABILITIES.items():
        assert tuple(by_name[name]["outputKinds"]) == capability.output_kinds
```

- [ ] **Step 2: Run capability tests**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_capabilities.py -q
```

Expected: PASS if registry is already consistent, otherwise FAIL showing the exact inconsistency.

- [ ] **Step 3: If dispatch contains a capability missing from registry, add it to `registry.py`**

For each missing dispatch key, add a `Capability` entry matching the service behavior. Example shape:

```python
    "vision.analyze": Capability(
        name="vision.analyze",
        output_kinds=("json", "text"),
        providers=("gemini",),
    ),
```

Use the actual output kinds accepted by current handlers and tests. Do not invent provider support beyond existing dispatch.

- [ ] **Step 4: If registry contains capabilities that dispatch cannot run, choose one correction**

If a registry capability is documented as runnable but `_RUN_DISPATCH` cannot run it, either:

1. remove it from registry if it is not implemented, or
2. add dispatch only if a provider handler already exists.

Do not implement a new provider adapter in this task.

- [ ] **Step 5: Run request protocol and capability tests**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_model_protocol.py aos-cli/tests/test_capabilities.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit registry consistency tests and fixes**

Run:

```bash
git diff -- aos-cli/tests/test_capabilities.py aos-cli/src/aos_cli/model/registry.py aos-cli/src/aos_cli/model/capabilities.py aos-cli/src/aos_cli/model/service.py
git add aos-cli/tests/test_capabilities.py aos-cli/src/aos_cli/model/registry.py aos-cli/src/aos_cli/model/capabilities.py aos-cli/src/aos_cli/model/service.py
git commit -m "Lock model capability registry consistency"
```

Only add source files that actually changed.

---

## Task 5: Standardize Minimal Error Taxonomy

**Files:**
- Modify: `aos-cli/src/aos_cli/model/errors.py`
- Modify: `aos-cli/src/aos_cli/model/protocol.py`
- Modify: `aos-cli/src/aos_cli/model/service.py`
- Modify: provider files only if they currently emit non-standard codes:
  - `aos-cli/src/aos_cli/model/providers/gemini.py`
  - `aos-cli/src/aos_cli/model/providers/openai_image.py`
  - `aos-cli/src/aos_cli/model/providers/ark_video.py`
- Modify: `aos-cli/tests/test_model_service.py`
- Modify: `aos-cli/tests/test_model_protocol.py`

- [ ] **Step 1: Write tests for canonical error codes**

Add to `aos-cli/tests/test_model_protocol.py`:

```python
def test_failure_response_contains_retryable_error_contract():
    response = failure_response(
        task="t1",
        capability="generate",
        code="RATE_LIMITED",
        message="Too many requests",
        retryable=True,
        provider="gemini",
        status_code=429,
    )

    assert response == {
        "ok": False,
        "apiVersion": "aos-cli.model/v1",
        "task": "t1",
        "capability": "generate",
        "error": {
            "code": "RATE_LIMITED",
            "message": "Too many requests",
            "retryable": True,
            "provider": "gemini",
            "statusCode": 429,
        },
        "warnings": [],
    }
```

- [ ] **Step 2: Add canonical constants to `errors.py`**

In `aos-cli/src/aos_cli/model/errors.py`, define:

```python
INVALID_REQUEST = "INVALID_REQUEST"
UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY"
UNSUPPORTED_OUTPUT_KIND = "UNSUPPORTED_OUTPUT_KIND"
CONFIG_ERROR = "CONFIG_ERROR"
AUTH_ERROR = "AUTH_ERROR"
RATE_LIMITED = "RATE_LIMITED"
PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
PROVIDER_REJECTED = "PROVIDER_REJECTED"
PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
ARTIFACT_ERROR = "ARTIFACT_ERROR"
INTERNAL_ERROR = "INTERNAL_ERROR"

RETRYABLE_ERROR_CODES = {
    RATE_LIMITED,
    PROVIDER_TIMEOUT,
    PROVIDER_UNAVAILABLE,
}
```

If `ModelServiceError` already exists, preserve its public constructor. Do not force every call site to change in this task unless tests require it.

- [ ] **Step 3: Use constants in protocol validation paths**

In `protocol.py`, import the constants and replace literal strings in `parse_request` and validation helpers for:

```python
INVALID_REQUEST
UNSUPPORTED_CAPABILITY
UNSUPPORTED_OUTPUT_KIND
```

Example:

```python
from aos_cli.model.errors import INVALID_REQUEST, UNSUPPORTED_CAPABILITY, UNSUPPORTED_OUTPUT_KIND, ModelServiceError
```

- [ ] **Step 4: Audit provider and service error codes**

Search within `aos-cli/src/aos_cli/model` for `ModelServiceError(` and list any codes outside the canonical set. For each non-standard code, map it to one canonical code:

```text
HTTP 401/403 or missing credential -> AUTH_ERROR
HTTP 429 -> RATE_LIMITED
Timeout -> PROVIDER_TIMEOUT
HTTP 5xx or connection failure -> PROVIDER_UNAVAILABLE
Provider safety/content rejection -> PROVIDER_REJECTED
Artifact download/write failure -> ARTIFACT_ERROR
Unexpected local bug -> INTERNAL_ERROR
Bad caller input -> INVALID_REQUEST
Missing provider config -> CONFIG_ERROR
```

- [ ] **Step 5: Add service test for provider error normalization if missing**

In `aos-cli/tests/test_model_service.py`, add or adjust a fake-provider test so a provider error reaches the response envelope as canonical JSON:

```python
def test_model_service_returns_canonical_provider_error():
    from aos_cli.model.errors import ModelServiceError
    from aos_cli.model.service import ModelService

    class FailingProvider:
        def generate_text(self, request):
            raise ModelServiceError(
                "RATE_LIMITED",
                "Provider quota exceeded",
                retryable=True,
                provider="gemini",
                status_code=429,
            )

    def provider_factory(request, dispatch):
        return FailingProvider()

    service = ModelService(provider_factory=provider_factory)
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "rate-limit-test",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hello"},
        }
    )

    assert response["ok"] is False
    assert response["error"]["code"] == "RATE_LIMITED"
    assert response["error"]["retryable"] is True
    assert response["error"]["provider"] == "gemini"
    assert response["error"]["statusCode"] == 429
```

If current provider interface uses a different method name, adapt only the fake provider method needed by the existing `_handle_generate` path.

- [ ] **Step 6: Run error tests**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests/test_model_protocol.py aos-cli/tests/test_model_service.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit error taxonomy**

Run:

```bash
git diff -- aos-cli/src/aos_cli/model/errors.py aos-cli/src/aos_cli/model/protocol.py aos-cli/src/aos_cli/model/service.py aos-cli/src/aos_cli/model/providers aos-cli/tests/test_model_protocol.py aos-cli/tests/test_model_service.py
git add aos-cli/src/aos_cli/model/errors.py aos-cli/src/aos_cli/model/protocol.py aos-cli/src/aos_cli/model/service.py aos-cli/src/aos_cli/model/providers aos-cli/tests/test_model_protocol.py aos-cli/tests/test_model_service.py
git commit -m "Normalize model boundary error codes"
```

Only add provider files that actually changed.

---

## Task 6: Keep Shared Adapter Thin

**Files:**
- Modify: `.claude/skills/_shared/aos_cli_model.py` only if adding a validate wrapper is useful
- Modify: `.claude/skills/_shared/test_aos_cli_model.py` only if the adapter changes

- [ ] **Step 1: Inspect current adapter responsibilities**

Open `.claude/skills/_shared/aos_cli_model.py` and confirm it only does these things:

```text
- resolves aos-cli executable command
- builds model subcommand argv
- calls subprocess.run
- returns subprocess.CompletedProcess
```

If it contains business semantics such as storyboard, episode, asset, provider fallback, prompt construction, or retry policy, move that logic out of the adapter in a separate task before continuing.

- [ ] **Step 2: Add validate wrapper only if skills need it**

If a wrapper is useful, add:

```python
def aos_cli_model_validate(
    request_path: PathLike,
    *,
    cwd: Optional[PathLike] = None,
) -> subprocess.CompletedProcess:
    return run_aos_cli(
        ["model", "validate", "--input", str(request_path)],
        cwd=cwd,
    )
```

Do not parse business fields here.

- [ ] **Step 3: Add adapter test only if wrapper was added**

In `.claude/skills/_shared/test_aos_cli_model.py`, add:

```python
    def test_validate_command_uses_repo_local_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            request_path = Path(tmp) / "request.json"
            request_path.write_text(
                json.dumps(
                    {
                        "apiVersion": "aos-cli.model/v1",
                        "task": "adapter-validate",
                        "capability": "generate",
                        "output": {"kind": "text"},
                        "input": {"content": "hello"},
                    }
                ),
                encoding="utf-8",
            )
            result = aos_cli_model.aos_cli_model_validate(request_path, cwd=REPO_ROOT)

        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads(result.stdout)
        self.assertTrue(response["ok"])
        self.assertEqual(response["task"], "adapter-validate")
```

If the existing adapter tests use different class/function names, place this method in the existing test class and follow its style.

- [ ] **Step 4: Run adapter tests**

Run:

```bash
python3 .claude/skills/_shared/test_aos_cli_model.py
```

Expected: PASS.

- [ ] **Step 5: Commit adapter change or explicit no-op**

If files changed, commit:

```bash
git diff -- .claude/skills/_shared/aos_cli_model.py .claude/skills/_shared/test_aos_cli_model.py
git add .claude/skills/_shared/aos_cli_model.py .claude/skills/_shared/test_aos_cli_model.py
git commit -m "Keep model CLI adapter thin"
```

If no code changed, do not create an empty commit. Record the no-op in the final implementation summary instead.

---

## Task 7: Full Regression and Boundary Audit

**Files:**
- No planned source changes unless regressions are found.

- [ ] **Step 1: Run focused aos-cli test suite**

Run:

```bash
uv run --project aos-cli pytest aos-cli/tests -q
```

Expected: PASS.

- [ ] **Step 2: Run shared adapter smoke test**

Run:

```bash
python3 .claude/skills/_shared/test_aos_cli_model.py
```

Expected: PASS.

- [ ] **Step 3: Run manual validate smoke command**

Run:

```bash
uv run --project aos-cli aos-cli model validate --input aos-cli/examples/text.request.json
```

Expected: stdout is valid JSON with:

```json
{
  "ok": true,
  "apiVersion": "aos-cli.model/v1"
}
```

The response may contain additional fields such as `task`, `capability`, and `warnings`.

- [ ] **Step 4: Run manual invalid validate smoke command**

Run:

```bash
printf '{bad json' | uv run --project aos-cli aos-cli model validate --input -
```

Expected:

- exit code is `2`;
- stdout is valid JSON;
- `ok` is `false`;
- `error.code` is `INVALID_REQUEST`.

- [ ] **Step 5: Boundary audit**

Inspect the final diff and verify none of these were introduced:

```text
aos-cli model serve
provider raw command
storyboard command
pipeline command
workspace command
HTTP daemon
plugin system
sidecar daemon
business retry logic inside .claude/skills/_shared/aos_cli_model.py
```

- [ ] **Step 6: Final commit if regression fixes were needed**

If Task 7 required fixes, commit them:

```bash
git add <changed-files>
git commit -m "Stabilize model boundary validation"
```

If no files changed, do not commit.

---

## Execution Order

Use this order:

1. Task 1 — clarify docs and boundaries.
2. Task 2 — add protocol-level validation payload.
3. Task 3 — expose `model validate` through CLI.
4. Task 4 — lock capability registry consistency.
5. Task 5 — standardize minimal error taxonomy.
6. Task 6 — keep shared adapter thin.
7. Task 7 — run full regression and boundary audit.

Do not skip tests. Do not batch unrelated source changes into the docs commit. Do not introduce daemon/service/raw-provider behavior while executing this plan.

---

## Self-Review

### Spec coverage

- Boundary docs: Task 1.
- `model validate`: Tasks 2 and 3.
- Protocol tests: Tasks 2, 3, and 7.
- Capability registry consistency: Task 4.
- Error taxonomy: Task 5.
- Thin shared adapter: Task 6.
- Deferred daemon/raw/business commands: Tasks 1 and 7.

### Placeholder scan

No TBD/TODO/fill-in-later placeholders remain. Conditional steps are explicit and tied to observed file state.

### Type and name consistency

The plan consistently uses:

- `validate_request_payload(payload: dict) -> dict`
- `aos-cli model validate --input ...`
- `UNSUPPORTED_OUTPUT_KIND`
- `API_VERSION = "aos-cli.model/v1"`
- `ok`, `apiVersion`, `task`, `capability`, `warnings`, `error.code`, `error.retryable`
