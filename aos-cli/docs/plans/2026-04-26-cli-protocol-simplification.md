# aos-cli Protocol Simplification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the `aos-cli` model protocol by removing redundant commands, dead fields, business knowledge that leaked into the gateway, and lifecycle abstractions that surfaced in the request envelope. Replace the implicit duck-typed dispatch with a single source of truth driven by the capability registry.

**Architecture:** All changes are **subtractive or tightening**. The CLI command surface shrinks from 7 to 6. The required request envelope drops from 5 fields to 3. JSON schema validation moves out of the gateway. Video lifecycle stops bleeding into `output.kind`. The dispatch in `service.run` stops being a 6-branch switch and becomes a lookup. No new abstractions are introduced.

**Tech Stack:** Python ≥3.11, `uv`, `argparse`, `urllib.request`, `pytest`, `ruff`. Drop `jsonschema` runtime dependency.

---

## Execution Policy

Run tasks **serially**. Most tasks share `src/aos_cli/cli.py`, `src/aos_cli/model/protocol.py`, `src/aos_cli/model/service.py`, and the same test files. Parallel edits would create conflicts.

Do not use subagents by default. Re-evaluate parallelism only if a task has a disjoint write set after the protocol changes settle (Task 8 onwards).

Each task ends with a single commit using the repository's current short imperative subject style (e.g. `Drop redundant aos-cli model validate command`). Do not amend earlier commits.

Working tree at plan start has uncommitted changes (the `aos-cli` naming consolidation and `.env` support). **Land those changes first under the existing commit policy before starting Task 1**, or rebase them into Task 7 if they belong there. Do not stage `uv.lock` registry-URL drift unless a task intentionally changes dependencies.

## Task Order And Dependencies

```
1. Delete validate command         (independent, smallest blast radius)
2. apiVersion → optional           (independent, trivial)
3. Drop JSON schema validation     (touches protocol + service)
4. Drop output.kind for video      (touches protocol + service + fixtures)
5. embed → output.kind=vector      (depends on Task 3 removing schema noise)
6. stdin/stdout via "-"            (additive, independent)
7. .env explicit anchor            (independent behavior fix)
8. Table-driven service.run        (refactor on cleaned protocol)
9. Documentation sweep             (final consistency pass)
```

Explicitly **out of scope** for this plan:

- Adding a daemon, server, or worker process.
- Adding retry, backoff, or rate limiting inside the CLI.
- Adding streaming.
- Rewriting in TypeScript or Rust.
- Extending `modelPolicy` to carry credentials.
- Changing provider HTTP behavior.

---

## Task 1: Delete the `validate` Command

**Why:** `aos-cli model validate` only checks envelope shape. It does not check `env`, provider reachability, model existence, or schema content. Skills calling `validate` before `run` pay one extra subprocess startup for zero new information; `run` re-runs the same parse on entry. The command is vestigial.

**Files:**
- Delete: `tests/test_model_validate_cli.py`
- Modify: `src/aos_cli/cli.py` (remove subparser, branch, `validate_request_payload`, `validation_failure_payload`, now-unused imports)
- Modify: `examples/call_from_skill.sh` (remove the validate line)
- Modify: `README.md` (remove validate references)
- Modify: `docs/MODEL_PROTOCOL.md` (delete the "Validation" section + table row)
- Modify: `docs/AOS_CLI_MIGRATION.md` (remove "Validate before spending tokens" block)

### Steps

- [ ] **Step 1: Capture baseline**

```bash
uv run pytest -q
```

Expected: `73 passed`.

- [ ] **Step 2: Delete the validate test file**

```bash
git rm tests/test_model_validate_cli.py
```

- [ ] **Step 3: Remove the validate subparser and handler from `src/aos_cli/cli.py`**

Delete these lines from `build_parser`:

```python
    validate = model_commands.add_parser("validate")
    validate.add_argument("--input", required=True)
```

Delete this whole branch from `run_model_command`:

```python
    if args.model_command == "validate":
        try:
            request = json.loads(Path(args.input).read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            response = validation_failure_payload(
                payload={},
                error=ModelServiceError(
                    "INVALID_REQUEST",
                    f"Request file is not valid JSON: {exc.msg}",
                ),
            )
        else:
            response = validate_request_payload(request)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 0 if response.get("ok") else 2
```

Delete the helpers `validate_request_payload` and `validation_failure_payload` at the bottom of the file.

Update the import line so it no longer pulls `API_VERSION`, `envelope_metadata`, `parse_request`, or `ModelServiceError` (none are used after this task):

```python
from aos_cli.env import load_project_env
from aos_cli.model.batch import batch_failure_report, parse_batch_manifest, run_batch
from aos_cli.model.capabilities import capabilities_payload
from aos_cli.model.errors import ModelServiceError
from aos_cli.model.preflight import preflight_payload
from aos_cli.model.service import build_default_model_service
```

(`ModelServiceError` is still needed for the `batch` branch's `except` clause — keep it. `parse_request` / `envelope_metadata` / `API_VERSION` go.)

- [ ] **Step 4: Update `examples/call_from_skill.sh`**

Remove the `aos-cli model validate ...` invocation. The wrapper script should call `aos-cli model run` directly with the input/output paths.

- [ ] **Step 5: Sweep `validate` mentions out of `README.md`**

Remove these from the Commands list and the Business Integration section:

```text
aos-cli model validate --input request.json
```

```text
uv run --project aos-cli aos-cli model validate --input /tmp/request.json
```

- [ ] **Step 6: Sweep `validate` out of `docs/MODEL_PROTOCOL.md`**

Delete the `aos-cli model validate ...` line from the Commands block. Delete the entire `## Validation` section (heading and body).

- [ ] **Step 7: Sweep `validate` out of `docs/AOS_CLI_MIGRATION.md`**

Delete the "Validate before spending tokens" block. Replace the migration-rule line `Call aos-cli model validate before run, submit, or batch.` with nothing (just delete it).

- [ ] **Step 8: Run suite, expect 4 fewer tests still all green**

```bash
uv run pytest -q
```

Expected: `69 passed` (the 4 deleted tests are gone, the rest remain green).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Drop redundant aos-cli model validate command"
```

---

## Task 2: Make `apiVersion` Optional With Default

**Why:** `apiVersion` has one consumer (same-repo skills) and one accepted value (`aos-cli.model/v1`). It is dead weight in every request file. Make it optional; preserve rejection of *wrong* values so the field still has migration value if the protocol ever needs to evolve.

**Files:**
- Modify: `src/aos_cli/model/protocol.py:12-25` (parse_request)
- Modify: `tests/test_model_protocol.py` (replace `test_parse_request_requires_api_version`)

### Steps

- [ ] **Step 1: Replace the failing-when-missing test with two new tests**

In `tests/test_model_protocol.py`, delete `test_parse_request_requires_api_version`. Add:

```python
def test_parse_request_defaults_apiversion_when_missing():
    request = parse_request(
        {
            "task": "x",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
        }
    )

    assert request["apiVersion"] == "aos-cli.model/v1"


def test_parse_request_rejects_wrong_apiversion():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "apiVersion": "aos-cli.model/v0",
                "task": "x",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        )

    assert exc.value.code == "INVALID_REQUEST"
```

- [ ] **Step 2: Run, expect failures**

```bash
uv run pytest tests/test_model_protocol.py -q
```

Expected: `test_parse_request_defaults_apiversion_when_missing` FAILS with "Missing required field: apiVersion".

- [ ] **Step 3: Update `parse_request` in `src/aos_cli/model/protocol.py`**

Replace the `required` block with:

```python
    required = ["task", "capability", "output", "input"]
    for field in required:
        if field not in payload:
            raise ModelServiceError("INVALID_REQUEST", f"Missing required field: {field}")

    api_version = payload.get("apiVersion", API_VERSION)
    if api_version != API_VERSION:
        raise ModelServiceError(
            "INVALID_REQUEST",
            f"Unsupported apiVersion: {api_version}",
        )
    payload = {**payload, "apiVersion": API_VERSION}
```

The trailing reassignment guarantees downstream code can still read `request["apiVersion"]` unconditionally.

- [ ] **Step 4: Run protocol tests, expect green**

```bash
uv run pytest tests/test_model_protocol.py -q
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```bash
uv run pytest -q
```

Expected: `70 passed` (Task 1 left 69; this task deletes 1 and adds 2).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Default request apiVersion when callers omit it"
```

---

## Task 3: Drop In-Gateway JSON Schema Validation

**Why:** The schema registry contains exactly one entry (`generic.object.v1`) which validates "any object." Calling `validated: true` on output checked against this is a lie. If any skill ever needs a real schema (e.g. storyboard), it would have to add it to `aos-cli/schemas.py`, which violates the "no business knowledge in the gateway" boundary. Cleanest fix: the gateway parses JSON and returns it. Skills that need schema validation own that step.

**Files:**
- Delete: `src/aos_cli/model/schemas.py`
- Delete: `src/aos_cli/model/validators.py`
- Delete: `tests/test_json_output_validation.py`
- Modify: `src/aos_cli/model/protocol.py` (drop schema lookup)
- Modify: `src/aos_cli/model/service.py` (drop validate calls; drop `validated`/`schema` from json output)
- Modify: `src/aos_cli/model/errors.py` (remove `OUTPUT_SCHEMA_FAILED`, `SCHEMA_NOT_FOUND` if no longer raised — verify with grep first)
- Modify: `tests/test_model_protocol.py` (delete `test_parse_request_rejects_unknown_json_schema`)
- Modify: `tests/test_model_service.py` (drop `validated` / `schema` assertions)
- Modify: `pyproject.toml` (remove `jsonschema` runtime dependency)
- Modify: `examples/embed.request.json` (drop `output.schema`)
- Modify: `docs/MODEL_PROTOCOL.md` (drop schema fields from json response example, drop SCHEMA_NOT_FOUND / OUTPUT_SCHEMA_FAILED from error code list)

### Steps

- [ ] **Step 1: Update json-output assertions in `tests/test_model_service.py`**

Find every test asserting `response["output"]["validated"]` or `response["output"]["schema"]`. Replace with assertions only on `kind` and `data`:

```python
assert response["output"] == {"kind": "json", "data": {"title": "ok"}}
```

(Adjust the inner `data` to whatever each test's fixture returns.)

- [ ] **Step 2: Run service tests, expect failures**

```bash
uv run pytest tests/test_model_service.py -q
```

Expected: assertions fail because the current implementation still adds `validated` and `schema`.

- [ ] **Step 3: Update `_normalize_output` in `src/aos_cli/model/service.py`**

Replace the json branch:

```python
    if output_kind == "json":
        data = _parse_json_output(text)
        return {"kind": "json", "data": data}
```

Remove the `validate_json_output(...)` and `get_schema(...)` calls.

- [ ] **Step 4: Update `_normalize_embedding_output` in `src/aos_cli/model/service.py`**

Replace with:

```python
def _normalize_embedding_output(request: dict, values: list[float]) -> dict:
    return {"kind": "json", "data": {"embedding": values}}
```

(Task 5 will further evolve this to `kind: vector`. For now we only remove the schema lie.)

- [ ] **Step 5: Drop schema-aware imports from `src/aos_cli/model/service.py`**

Remove:

```python
from aos_cli.model.schemas import get_schema
from aos_cli.model.validators import validate_json_output
```

- [ ] **Step 6: Drop schema check from `parse_request` in `src/aos_cli/model/protocol.py`**

Remove:

```python
    if payload["output"]["kind"] == "json":
        get_schema(payload["output"].get("schema", "generic.object.v1"))
```

And remove the `from aos_cli.model.schemas import get_schema` import.

- [ ] **Step 7: Delete obsolete files**

```bash
git rm src/aos_cli/model/schemas.py
git rm src/aos_cli/model/validators.py
git rm tests/test_json_output_validation.py
```

- [ ] **Step 8: Delete schema test from `tests/test_model_protocol.py`**

Remove `test_parse_request_rejects_unknown_json_schema`.

- [ ] **Step 9: Verify `OUTPUT_SCHEMA_FAILED` and `SCHEMA_NOT_FOUND` are no longer raised**

```bash
rg "OUTPUT_SCHEMA_FAILED|SCHEMA_NOT_FOUND" src tests
```

Expected: no hits in `src/`. If hits remain (e.g. constants in `errors.py`), keep them defined but unused — they are part of the documented stable error code list. Update the docs in Task 9 to remove them only if every reference is gone.

- [ ] **Step 10: Drop `jsonschema` from `pyproject.toml`**

In `pyproject.toml`, change:

```toml
dependencies = [
  "jsonschema>=4.22.0",
]
```

to:

```toml
dependencies = []
```

- [ ] **Step 11: Resync uv lock**

```bash
uv sync
```

Stage `uv.lock` only if the change is purely the removal of `jsonschema` and its transitive deps; if `uv sync` introduces unrelated registry-URL drift, do not stage those hunks (use `git add -p`).

- [ ] **Step 12: Update `examples/embed.request.json`**

Replace its current contents with (also drops `apiVersion` per Task 2 — leave that for Task 9 if you want strict per-task isolation, otherwise update now):

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "semantic.embed",
  "capability": "embed",
  "output": {
    "kind": "json"
  },
  "input": {
    "content": "quiet emotional scene"
  },
  "options": {
    "taskType": "SEMANTIC_SIMILARITY",
    "outputDimensionality": 768
  }
}
```

(Schema name removed; `kind` will further change in Task 5.)

- [ ] **Step 13: Run full suite, expect green**

```bash
uv run pytest -q
```

Expected: tests pass; total drops by 3 (`test_json_output_validation` had 3) plus 1 (`test_parse_request_rejects_unknown_json_schema`) = 4 fewer; net `66 passed` (Task 2 left 70).

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "Remove in-gateway JSON schema registry and validation"
```

---

## Task 4: Drop `output.kind` Requirement For Video Submit/Poll

**Why:** Today `submit` requests must declare `output.kind=task` and `poll` requests must declare `output.kind=task_result`. These are not "what shape do I want" — they describe **lifecycle phase**, which the operation (`submit` vs `poll`) already tells us. Forcing skills to write the phase into the envelope is abstraction leakage. The CLI subcommand fills the right `output.kind` before `parse_request` runs.

**Files:**
- Modify: `src/aos_cli/model/service.py` (`submit` and `poll` inject default output)
- Modify: `examples/video.submit.request.json` (drop `output`)
- Modify: `tests/test_model_submit_poll_cli.py` (cover submit-without-output and poll-without-output)
- Modify: `docs/MODEL_PROTOCOL.md` (request examples + capabilities table)

### Steps

- [ ] **Step 1: Add new submit/poll tests**

In `tests/test_model_submit_poll_cli.py`, add:

```python
def test_model_submit_accepts_request_without_output_kind(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "task.json"
    request_path.write_text(
        json.dumps(
            {
                "task": "video.clip",
                "capability": "video.generate",
                "input": {"prompt": "moonlight"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "submit", "--input", str(request_path), "--output", str(output_path)])

    assert code == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task"
    assert payload["output"]["taskId"]


def test_model_poll_accepts_request_without_output_kind(tmp_path, monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    request_path = tmp_path / "request.json"
    output_path = tmp_path / "result.json"
    request_path.write_text(
        json.dumps(
            {
                "task": "video.clip",
                "capability": "video.generate",
                "input": {"taskId": "fake-video-task"},
            }
        ),
        encoding="utf-8",
    )

    code = main(["model", "poll", "--input", str(request_path), "--output", str(output_path)])

    assert code == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
    assert payload["output"]["kind"] == "task_result"
```

- [ ] **Step 2: Run, expect failures**

```bash
uv run pytest tests/test_model_submit_poll_cli.py -q
```

Expected: both new tests fail with `INVALID_REQUEST` ("output.kind is required").

- [ ] **Step 3: Update `ModelService.submit` in `src/aos_cli/model/service.py`**

At the top of `submit`, replace the parse step with:

```python
    def submit(self, payload: dict) -> dict:
        start = time.monotonic()
        try:
            normalized = _ensure_video_output(payload, "task")
            request = parse_request(normalized)
            metadata = envelope_metadata(request)
            if request["capability"] != "video.generate":
                raise ModelServiceError(
                    "UNSUPPORTED_CAPABILITY",
                    "submit only supports video.generate",
                    retryable=False,
                )
            if request["output"]["kind"] != "task":
                raise ModelServiceError(
                    "UNSUPPORTED_CAPABILITY",
                    "submit output.kind must be task or omitted",
                    retryable=False,
                )
            ...
```

(Keep the rest of `submit` unchanged.)

- [ ] **Step 4: Update `_poll_request_from_payload` in `src/aos_cli/model/service.py`**

Refactor so the "raw poll request" branch tolerates a missing `output`:

```python
def _poll_request_from_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError("INVALID_REQUEST", "Poll input must be an object", retryable=False)
    if payload.get("ok") is True and (payload.get("output") or {}).get("kind") == "task":
        request = {
            "task": payload.get("task", "unknown"),
            "capability": payload.get("capability", "video.generate"),
            "output": {"kind": "task_result"},
            "input": {"taskId": payload["output"].get("taskId")},
            "modelPolicy": {"model": payload.get("model")} if payload.get("model") else {},
        }
        return parse_request(request)
    request = parse_request(_ensure_video_output(payload, "task_result"))
    if request["capability"] != "video.generate" or request["output"]["kind"] != "task_result":
        raise ModelServiceError(
            "UNSUPPORTED_CAPABILITY",
            "poll only supports video.generate with output.kind=task_result",
            retryable=False,
        )
    if not request["input"].get("taskId"):
        raise ModelServiceError("INVALID_REQUEST", "input.taskId is required", retryable=False)
    return request
```

- [ ] **Step 5: Add the `_ensure_video_output` helper at the bottom of `src/aos_cli/model/service.py`**

```python
def _ensure_video_output(payload: dict, kind: str) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError("INVALID_REQUEST", "Request must be an object", retryable=False)
    if payload.get("capability") != "video.generate":
        return payload
    if "output" in payload and isinstance(payload["output"], dict) and "kind" in payload["output"]:
        return payload
    output = dict(payload.get("output") or {})
    output["kind"] = kind
    return {**payload, "output": output}
```

- [ ] **Step 6: Run submit/poll tests, expect green**

```bash
uv run pytest tests/test_model_submit_poll_cli.py -q
```

Expected: all pass, including the two new ones.

- [ ] **Step 7: Update `examples/video.submit.request.json`**

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "video.clip",
  "capability": "video.generate",
  "input": {
    "prompt": "A stylized 3D historical fantasy character turns toward moonlight.",
    "referenceImages": [
      {
        "url": "https://example.com/reference.png",
        "role": "reference_image"
      }
    ],
    "duration": 6,
    "ratio": "9:16",
    "quality": "720p"
  },
  "modelPolicy": {
    "model": "ep-20260303234827-tfnzm"
  }
}
```

- [ ] **Step 8: Run full suite**

```bash
uv run pytest -q
```

Expected: `68 passed` (Task 3 left 66; +2 new tests).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Stop requiring output.kind in video submit and poll requests"
```

---

## Task 5: Give `embed` Its Own Output Kind

**Why:** Embeddings are a known shape (a vector of floats). Wrapping them in `output.kind=json` plus a `data.embedding` field, and pretending they were validated against a schema, is a smell. A new `output.kind=vector` is honest and trivially usable by downstream code.

**Files:**
- Modify: `src/aos_cli/model/registry.py` (`embed.output_kinds = ("vector",)`)
- Modify: `src/aos_cli/model/service.py` (`_normalize_embedding_output` returns vector kind)
- Modify: `tests/test_model_service.py` (`test_service_returns_embedding_vector` updated)
- Modify: `tests/test_capabilities.py` (`test_capabilities_declares_embed_json` → `test_capabilities_declares_embed_vector`)
- Modify: `examples/embed.request.json` (`output.kind = "vector"`)
- Modify: `docs/MODEL_PROTOCOL.md` (capabilities table + add vector kind under Success Envelope)

### Steps

- [ ] **Step 1: Update embedding test in `tests/test_model_service.py`**

Replace the success-shape assertion in `test_service_returns_embedding_vector` with:

```python
assert response["output"] == {
    "kind": "vector",
    "values": [0.1, 0.2],
    "dimension": 2,
}
```

- [ ] **Step 2: Update embed-capability test in `tests/test_capabilities.py`**

Rename `test_capabilities_declares_embed_json` to `test_capabilities_declares_embed_vector`. Assert:

```python
def test_capabilities_declares_embed_vector():
    payload = capabilities_payload()
    embed = next(c for c in payload["capabilities"] if c["name"] == "embed")
    assert embed["outputKinds"] == ["vector"]
    assert embed["providers"] == ["gemini"]
```

- [ ] **Step 3: Run tests, expect failures**

```bash
uv run pytest tests/test_model_service.py tests/test_capabilities.py -q
```

Expected: both new assertions fail.

- [ ] **Step 4: Update `src/aos_cli/model/registry.py`**

Change the `embed` capability:

```python
    "embed": Capability(
        name="embed",
        output_kinds=("vector",),
        providers=("gemini",),
        models=("gemini-embedding-001",),
    ),
```

- [ ] **Step 5: Update `_normalize_embedding_output` in `src/aos_cli/model/service.py`**

```python
def _normalize_embedding_output(request: dict, values: list[float]) -> dict:
    return {"kind": "vector", "values": values, "dimension": len(values)}
```

- [ ] **Step 6: Update `examples/embed.request.json`**

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "semantic.embed",
  "capability": "embed",
  "output": {
    "kind": "vector"
  },
  "input": {
    "content": "quiet emotional scene"
  },
  "options": {
    "taskType": "SEMANTIC_SIMILARITY",
    "outputDimensionality": 768
  }
}
```

- [ ] **Step 7: Run suite, expect green**

```bash
uv run pytest -q
```

Expected: `68 passed`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Use dedicated vector output kind for embedding capability"
```

---

## Task 6: Accept `-` For stdin/stdout In `--input` And `--output`

**Why:** Forcing every call through tempfiles is convention, not a requirement. Allowing `-` makes pipes work and removes per-call cleanup concerns for skills.

**Files:**
- Modify: `src/aos_cli/cli.py` (introduce `_read_input_text`/`_write_output_text`; rewrite `run`/`submit`/`poll` branches)
- Add: `tests/test_cli_stdio.py` (unit tests for the helpers)
- Modify: `docs/MODEL_PROTOCOL.md` (note `-` support)

`batch` keeps file paths only because the manifest references files by path; piping a manifest through stdin still works for `--manifest -` but `--report -` is the more useful new affordance. Keep the same convention there too.

### Steps

- [ ] **Step 1: Add `tests/test_cli_stdio.py`**

```python
import io
import json

import pytest

from aos_cli.cli import _read_input_text, _write_output_text


def test_read_input_text_reads_stdin_when_dash(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("hello"))
    assert _read_input_text("-") == "hello"


def test_read_input_text_reads_file_when_path(tmp_path):
    path = tmp_path / "in.json"
    path.write_text("hi", encoding="utf-8")
    assert _read_input_text(str(path)) == "hi"


def test_write_output_text_writes_stdout_when_dash(capsys):
    _write_output_text("-", "payload")
    captured = capsys.readouterr()
    assert captured.out == "payload"


def test_write_output_text_writes_file_when_path(tmp_path):
    path = tmp_path / "out.json"
    _write_output_text(str(path), "payload")
    assert path.read_text(encoding="utf-8") == "payload"
```

- [ ] **Step 2: Run, expect import error / NameError**

```bash
uv run pytest tests/test_cli_stdio.py -q
```

Expected: ImportError because helpers do not exist.

- [ ] **Step 3: Add helpers to `src/aos_cli/cli.py`**

Above `def main`:

```python
import sys


def _read_input_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def _write_output_text(path: str, payload: str) -> None:
    if path == "-":
        sys.stdout.write(payload)
        return
    Path(path).write_text(payload, encoding="utf-8")
```

- [ ] **Step 4: Use the helpers in the `run`, `submit`, `poll`, and `batch` branches**

Replace each occurrence of `Path(args.input).read_text(...)` with `_read_input_text(args.input)`, and each `Path(args.output).write_text(...)` with `_write_output_text(args.output, ...)`. For `batch`, replace `Path(args.report).write_text(...)` with `_write_output_text(args.report, ...)`.

- [ ] **Step 5: Run unit tests**

```bash
uv run pytest tests/test_cli_stdio.py -q
```

Expected: 4 passed.

- [ ] **Step 6: Run full suite**

```bash
uv run pytest -q
```

Expected: `72 passed` (Task 5 left 68; +4 new stdio tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Accept dash as stdin/stdout for model commands"
```

---

## Task 7: Replace `.env` Upward Walk With Explicit Anchor

**Why:** Walking `.env` from `cwd` upward makes loaded credentials a function of caller location. A skill that `cd`s under a different parent silently picks up a different `.env`. Replace with: (a) an explicit `--env-file PATH` flag and (b) a single-level lookup at `cwd/.env`. No walk.

**Files:**
- Modify: `src/aos_cli/env.py` (drop walk; keep loader; respect explicit path)
- Modify: `src/aos_cli/cli.py` (add `--env-file`; load env after parse_args)
- Rewrite: `tests/test_env.py`
- Modify: `README.md` (env precedence section)
- Modify: `docs/MODEL_PROTOCOL.md` (Environment section)

### Steps

- [ ] **Step 1: Replace `tests/test_env.py` with the new contract**

```python
import os
from pathlib import Path

from aos_cli.env import load_project_env, parse_env_line


def test_load_project_env_loads_cwd_dot_env_only(tmp_path, monkeypatch):
    project = tmp_path / "project"
    nested = project / "aos-cli"
    nested.mkdir(parents=True)
    (project / ".env").write_text("PARENT_ONLY=parent\n", encoding="utf-8")
    (nested / ".env").write_text("CHILD_ONLY=child\n", encoding="utf-8")

    monkeypatch.chdir(nested)
    monkeypatch.delenv("PARENT_ONLY", raising=False)
    monkeypatch.delenv("CHILD_ONLY", raising=False)

    loaded = load_project_env()

    assert loaded == nested / ".env"
    assert os.environ["CHILD_ONLY"] == "child"
    assert "PARENT_ONLY" not in os.environ


def test_load_project_env_returns_none_when_no_dot_env(tmp_path, monkeypatch):
    nested = tmp_path / "nowhere"
    nested.mkdir()
    monkeypatch.chdir(nested)

    assert load_project_env() is None


def test_load_project_env_uses_explicit_path_when_given(tmp_path, monkeypatch):
    explicit = tmp_path / "custom.env"
    explicit.write_text("EXPLICIT=value\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("EXPLICIT", raising=False)

    assert load_project_env(explicit) == explicit
    assert os.environ["EXPLICIT"] == "value"


def test_load_project_env_explicit_path_wins_over_cwd(tmp_path, monkeypatch):
    explicit = tmp_path / "custom.env"
    explicit.write_text("KEY=from-explicit\n", encoding="utf-8")
    (tmp_path / ".env").write_text("KEY=from-cwd\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("KEY", raising=False)

    load_project_env(explicit)

    assert os.environ["KEY"] == "from-explicit"


def test_load_project_env_does_not_override_existing_environment(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("KEEP=from-file\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("KEEP", "from-shell")

    load_project_env()

    assert os.environ["KEEP"] == "from-shell"


def test_parse_env_line_supports_export_and_quoted_values():
    assert parse_env_line('export ARK_VIDEO_MODEL="ep-1"') == ("ARK_VIDEO_MODEL", "ep-1")
    assert parse_env_line("ARK_API_KEY='ark-key'") == ("ARK_API_KEY", "ark-key")
    assert parse_env_line("# comment") is None
```

- [ ] **Step 2: Run, expect failures (old loader still walks)**

```bash
uv run pytest tests/test_env.py -q
```

Expected: assertions about the parent walk fail.

- [ ] **Step 3: Rewrite `src/aos_cli/env.py`**

```python
# input: process environment, optional explicit env file path
# output: environment variables loaded for CLI provider configuration
# pos: startup configuration adapter for project-scoped aos-cli runs

from __future__ import annotations

import os
from pathlib import Path


def load_project_env(env_file: Path | None = None) -> Path | None:
    """Load a single .env file into os.environ without overriding existing keys.

    If env_file is given and exists, it is loaded. Otherwise, ``cwd/.env`` is
    loaded if present. No ancestor walk. Existing environment variables always
    win over file-supplied values.
    """

    if env_file is not None:
        if env_file.is_file():
            load_env_file(env_file)
            return env_file
        return None
    candidate = Path.cwd() / ".env"
    if candidate.is_file():
        load_env_file(candidate)
        return candidate
    return None


def load_env_file(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        parsed = parse_env_line(raw_line)
        if parsed is None:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].lstrip()
    if "=" not in stripped:
        return None

    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key or not key.replace("_", "").isalnum() or key[0].isdigit():
        return None

    return key, _parse_env_value(value.strip())


def _parse_env_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        quote = value[0]
        value = value[1:-1]
        if quote == '"':
            return value.encode("utf-8").decode("unicode_escape")
        return value
    return _strip_inline_comment(value).strip()


def _strip_inline_comment(value: str) -> str:
    in_single = False
    in_double = False
    for index, char in enumerate(value):
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == "#" and not in_single and not in_double:
            if index == 0 or value[index - 1].isspace():
                return value[:index]
    return value
```

(`find_project_env` and `find_project_env_files` are deleted.)

- [ ] **Step 4: Wire `--env-file` into `src/aos_cli/cli.py`**

In `build_parser`, before the namespace subparser:

```python
    parser.add_argument(
        "--env-file",
        type=Path,
        default=None,
        help="Path to a .env file to load before running the command.",
    )
```

In `main`, change the order so env loading respects the parsed flag:

```python
def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code)
    load_project_env(args.env_file)
    return run_model_command(args)
```

- [ ] **Step 5: Run env tests, expect green**

```bash
uv run pytest tests/test_env.py -q
```

Expected: 6 passed.

- [ ] **Step 6: Run full suite**

```bash
uv run pytest -q
```

Expected: `74 passed` (72 from end of Task 6, +2 new env tests after replacing 4 with 6).

- [ ] **Step 7: Update README.md and docs/MODEL_PROTOCOL.md env sections**

Replace the precedence text in both files. Use this canonical phrasing in README.md (under `## Configuration`):

```text
The CLI loads a single `.env` file. If `--env-file PATH` is passed, that file
is loaded. Otherwise, `./.env` (cwd) is loaded if present. No ancestor walk.
Existing shell environment variables always win over `.env` file values.
```

Mirror the same text in docs/MODEL_PROTOCOL.md `## Environment` section.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Anchor env loading to explicit path or cwd dot env"
```

---

## Task 8: Make `service.run` Table-Driven

**Why:** `ModelService.run` is a 6-branch `if/elif` keyed by `capability`, and `_default_provider_factory` is a second 3-branch keyed switch on the same axis. The capability registry exists but is not the execution truth. Consolidate into a single dispatch table per concern (handlers + provider resolvers), keyed by capability name.

This task is a **refactor with no behavior change**. Existing tests cover every capability path. They must remain green throughout.

**Files:**
- Modify: `src/aos_cli/model/service.py` (extract handlers; replace branches with table lookup)

### Steps

- [ ] **Step 1: Capture pre-refactor baseline**

```bash
uv run pytest -q
```

Expected: `74 passed`.

- [ ] **Step 2: Refactor `src/aos_cli/model/service.py`**

Replace `ModelService.run` and the helper closures with a table-driven implementation. Add this at module scope (above `class ModelService`):

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class _Dispatch:
    handler: Callable[[object, dict], dict]
    resolver: Callable[[dict], object]
    provider_name: str
```

Add the four handlers (one per capability that flows through `run`):

```python
def _handle_generate(provider, request):
    result = provider.generate_text(
        system=request["input"].get("system"),
        content=request["input"].get("content", ""),
        options=_build_options(request),
    )
    return {
        "output": _normalize_output(request, result.text),
        "model": result.model,
        "usage": result.usage,
    }


def _handle_vision(provider, request):
    result = provider.generate_multimodal(
        system=request["input"].get("system"),
        content=request["input"].get("content", {}),
        options=_build_options(request),
    )
    return {
        "output": _normalize_output(request, result.text),
        "model": result.model,
        "usage": result.usage,
    }


def _handle_audio(provider, request):
    result = provider.generate_multimodal(
        system=request["input"].get("system"),
        content=_audio_content(request),
        options=_build_options(request),
    )
    return {
        "output": _normalize_output(request, result.text),
        "model": result.model,
        "usage": result.usage,
    }


def _handle_embed(provider, request):
    result = provider.embed_content(
        content=request["input"].get("content", ""),
        options=dict(request.get("options") or {}),
    )
    return {
        "output": _normalize_embedding_output(request, result.values),
        "model": result.model,
        "usage": result.usage,
    }


def _handle_image_generate(provider, request):
    result = provider.generate_image(
        prompt=str(request["input"].get("prompt", "")),
        options=dict(request.get("options") or {}),
    )
    return {
        "output": _normalize_image_output(request, result.urls),
        "model": result.model,
        "usage": result.usage,
    }
```

Add the resolvers (rename existing config resolvers as needed; or wrap them):

```python
def _resolve_gemini_provider(request):
    config = resolve_gemini_config(request)
    return GeminiProvider(
        api_key=config["api_key"],
        base_url=config["base_url"],
        model=config["model"],
    )


def _resolve_gemini_embed_provider(request):
    config = resolve_gemini_embedding_config(request)
    return GeminiProvider(
        api_key=config["api_key"],
        base_url=config["base_url"],
        model=config["model"],
    )


def _resolve_openai_image_provider(request):
    config = resolve_openai_image_config(request)
    return OpenAIImageProvider(
        api_key=config["api_key"],
        base_url=config["base_url"],
        model=config["model"],
    )


def _resolve_ark_video_provider(request):
    config = resolve_ark_video_config(request)
    return ArkVideoProvider(
        api_key=config["api_key"],
        base_url=config["base_url"],
        model=config["model"],
    )
```

Build the dispatch table:

```python
_RUN_DISPATCH: dict[str, _Dispatch] = {
    "generate":         _Dispatch(_handle_generate,       _resolve_gemini_provider,        "gemini"),
    "vision.analyze":   _Dispatch(_handle_vision,         _resolve_gemini_provider,        "gemini"),
    "audio.transcribe": _Dispatch(_handle_audio,          _resolve_gemini_provider,        "gemini"),
    "embed":            _Dispatch(_handle_embed,          _resolve_gemini_embed_provider,  "gemini"),
    "image.generate":   _Dispatch(_handle_image_generate, _resolve_openai_image_provider,  "openai_compatible"),
}
```

Replace `ModelService.run`:

```python
    def run(self, payload: dict) -> dict:
        start = time.monotonic()
        try:
            request = parse_request(payload)
            metadata = envelope_metadata(request)
            dispatch = _RUN_DISPATCH.get(request["capability"])
            if dispatch is None:
                raise ModelServiceError(
                    "UNSUPPORTED_CAPABILITY",
                    f"Unsupported capability: {request['capability']}",
                    retryable=False,
                )
            provider = self.provider_factory(request, dispatch)
            result = dispatch.handler(provider, request)
            return success_response(
                task=request["task"],
                capability=request["capability"],
                output=result["output"],
                provider=dispatch.provider_name,
                model=result["model"],
                usage=result["usage"],
                latency_ms=int((time.monotonic() - start) * 1000),
                **metadata,
            )
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
```

Update `ModelService.__init__` and the factory shape so the factory takes a `_Dispatch` (or simply ignores it for the fake path):

```python
ProviderFactory = Callable[[dict, "_Dispatch"], object]


class ModelService:
    def __init__(self, provider_factory: ProviderFactory):
        self.provider_factory = provider_factory
```

The default factory becomes:

```python
def _default_provider_factory(request: dict, dispatch: _Dispatch) -> object:
    if request["capability"] == "video.generate":
        return _resolve_ark_video_provider(request)
    return dispatch.resolver(request)
```

(Video stays special-cased because it does not flow through `_RUN_DISPATCH`; its dispatch is handled by `submit`/`poll` directly.)

The fake factory simply ignores `dispatch`:

```python
def _fake_provider_factory(request: dict, dispatch: _Dispatch | None = None):
    return _FakeProvider(request)
```

`submit` and `poll` keep calling `self.provider_factory(request, ...)`. Since they only use the Ark resolver, pass `None` for dispatch:

```python
provider = self.provider_factory(request, None)
```

Update `_default_provider_factory` to tolerate `dispatch is None` for the video path (already does via the `capability == "video.generate"` branch).

- [ ] **Step 3: Run full suite, expect green with no count change**

```bash
uv run pytest -q
```

Expected: `74 passed`. If any test fails, the refactor is wrong — fix until green before committing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Drive ModelService.run from a capability dispatch table"
```

---

## Task 9: Documentation Sweep

**Why:** Several earlier tasks touched docs and examples in passing. This task makes one final pass so README, MODEL_PROTOCOL, MIGRATION, examples, and the call-from-skill wrapper are consistent with the new protocol surface.

**Files:**
- Modify: `README.md`
- Modify: `docs/MODEL_PROTOCOL.md`
- Modify: `docs/AOS_CLI_MIGRATION.md`
- Modify: `examples/call_from_skill.sh`
- Modify: every JSON file under `examples/` (verify per-file shape)

### Steps

- [ ] **Step 1: Audit each example JSON for stale fields**

For each `examples/*.json`, confirm:

- `apiVersion` is either present (still accepted) or removed (the protocol now defaults).
- No `output.schema` field remains.
- For `video.submit.request.json`, no `output.kind` is present.
- For `embed.request.json`, `output.kind == "vector"`.

Pick a single convention (recommended: keep `apiVersion` in examples for documentation clarity, but drop `output.schema` everywhere). Update all examples to match.

- [ ] **Step 2: Update `docs/MODEL_PROTOCOL.md`**

- Update the Commands code block to remove `aos-cli model validate ...`.
- Update the capabilities table: change `embed` row's "Output kind" from `json` to `vector`.
- Update the Success Envelope section: replace the JSON-output example to match `{"kind": "json", "data": {...}}` (no `validated`/`schema`); add a Vector Output sub-example:

```json
{
  "kind": "vector",
  "values": [0.013, -0.044, ...],
  "dimension": 768
}
```

- Update the Async Video section to show requests without `output.kind`:

```json
{
  "task": "video.clip",
  "capability": "video.generate",
  "input": {"prompt": "..."}
}
```

- Update the Environment section per Task 7's anchor language.
- Trim the Stable error codes list: keep `INVALID_REQUEST`, `UNSUPPORTED_CAPABILITY`, `PROVIDER_AUTH_FAILED`, `PROVIDER_QUOTA_EXHAUSTED`, `PROVIDER_TIMEOUT`, `PROVIDER_BAD_RESPONSE`, `OUTPUT_PARSE_FAILED`. Remove `OUTPUT_SCHEMA_FAILED` and `SCHEMA_NOT_FOUND` (no longer raised after Task 3).
- Add a single line under Batch noting: `Batch only runs synchronous run jobs. Video submit/poll are not supported in a batch manifest; orchestrate them from the skill.`
- Add a single line under Commands noting that `--input -` and `--output -` (and `--manifest -` / `--report -` for batch) read/write stdin/stdout.

- [ ] **Step 3: Update `README.md`**

- Remove the `aos-cli model validate ...` line from the Commands list.
- Update the Configuration section per Task 7's env language.
- Update the embedding example to show `output.kind=vector` if any inline example exists.
- Add a one-line note under Commands: stdin/stdout via `-`.

- [ ] **Step 4: Update `docs/AOS_CLI_MIGRATION.md`**

- Remove "Validate before spending tokens" section.
- Replace the migration rule line about `aos-cli model validate` with: `Use aos-cli model preflight to check provider credentials and reachability before launching a batch.`
- Update the env section per Task 7.

- [ ] **Step 5: Update `examples/call_from_skill.sh`**

Final shape (no validate; demonstrate stdin/stdout optional usage with a comment):

```bash
#!/usr/bin/env bash
set -euo pipefail

REQUEST="${1:?usage: call_from_skill.sh REQUEST_JSON OUTPUT_JSON}"
OUTPUT="${2:?usage: call_from_skill.sh REQUEST_JSON OUTPUT_JSON}"

uv run --project aos-cli aos-cli model run \
    --input "${REQUEST}" \
    --output "${OUTPUT}"
```

- [ ] **Step 6: Run full suite as a final sanity check**

```bash
uv run pytest -q
```

Expected: `74 passed`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Sweep docs and examples to match simplified protocol"
```

---

## Self-Review Checklist (For The Plan Author)

Run before handing off:

1. **Spec coverage:**
   - Real problems P0–P3 from the analysis: ✓ each maps to a task (validate→T1, video.kind→T4, apiVersion→T2, schemas→T3, stdin/stdout→T6, .env anchor→T7, table-driven→T8, embed kind→T5, batch+video doc→T9).
   - Concept-错位 items: ✓ embed (T5), task-as-required (intentionally deferred — not in this plan; record as future), .env (T7).
   - Out-of-scope items explicitly listed in Execution Policy.

2. **Placeholder scan:** No "TODO", "appropriate error handling", "similar to Task N", or stub references. Every code block is concrete.

3. **Type and name consistency:**
   - `_ensure_video_output` defined Task 4, used Task 4. ✓
   - `_RUN_DISPATCH`, `_Dispatch`, `_handle_*` defined and used in Task 8. ✓
   - `_read_input_text` / `_write_output_text` defined Task 6. ✓
   - `load_project_env(env_file=None)` signature consistent across Task 7 tests, source, and CLI.
   - Embedding response shape consistent across Task 3 (intermediate), Task 5 (final), and Task 9 (docs).

4. **Test count tracking:**
   - Baseline: **73**.
   - T1 deletes 4 → **69**.
   - T2 deletes 1, adds 2 → **70**.
   - T3 deletes 4 (3 schema-output cases + 1 unknown-schema parse case) → **66**.
   - T4 adds 2 → **68**.
   - T5 net 0 (one capability test renamed; one service test rewritten in place) → **68**.
   - T6 adds 4 → **72**.
   - T7 deletes 4, adds 6 → **74**.
   - T8 net 0 (refactor only) → **74**.
   - T9 net 0 (docs only) → **74**.
   Final: **74 passed**. The expected counts in each task's "run full suite" step have been updated inline to match this sequence.

---

## Future Work Not In This Plan

These were identified during analysis but are deliberately out of scope:

- Make `task` an optional field (currently required at the top level despite being trace-style metadata). Defer until a skill actually wants to omit it.
- Add `--check-env` to `preflight` so it can be a one-stop gating call for skills before batches.
- Decide whether `output.schema` should re-enter the protocol as **inline schemas only** (no registry) once a skill demonstrates a real need.
- Allow `batch` to run video submit/poll lifecycles, with poll-until-done semantics. Defer until a skill demonstrates the pain.
