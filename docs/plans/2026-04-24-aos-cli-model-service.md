# aos-cli Model Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a separate `/Users/dingzhijian/lingjing/aos-cli` infrastructure project whose first shipped namespace is `aos-cli model`, providing stable atomic model calls for AgentOS pipelines.

**Architecture:** Build a Python CLI with a small model service core, stable request/response envelopes, schema validation, provider adapters, real preflight checks, and no pipeline-stage knowledge. AgentOS harnesses call the CLI through files; provider-specific SDK and API details remain behind adapters.

**Tech Stack:** Python 3.11+, `uv`, `argparse`, `urllib.request`, `jsonschema`, `pytest`, `ruff`. No Bun/TypeScript runtime in the new CLI MVP.

**Reference spec:** `docs/specs/2026-04-24-aos-cli-model-service.md`

---

## Scope

Implement only the model namespace:

- `aos-cli model run --input request.json --output response.json`
- `aos-cli model preflight --json`
- `aos-cli model capabilities --json`

Do not implement:

- pipeline state management
- workspace/project lifecycle
- Web server
- video submit/poll
- full image generation integration

Image and video adapters are planned interfaces but not required for the first passing milestone.

---

## Task 1: Create Standalone Project Skeleton

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/pyproject.toml`
- Create: `/Users/dingzhijian/lingjing/aos-cli/README.md`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/__init__.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/cli.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/__init__.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_cli_smoke.py`

**Step 1: Create the project directory**

Run:

```bash
mkdir -p /Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model
mkdir -p /Users/dingzhijian/lingjing/aos-cli/tests
cd /Users/dingzhijian/lingjing/aos-cli
```

Expected: directory exists and is separate from `AgentOS-TS`.

**Step 2: Create `pyproject.toml`**

```toml
[project]
name = "aos-cli"
version = "0.1.0"
description = "AgentOS infrastructure CLI"
requires-python = ">=3.11"
dependencies = [
  "jsonschema>=4.22.0",
]

[project.scripts]
aos-cli = "aos_cli.cli:main"

[dependency-groups]
dev = [
  "pytest>=8.0.0",
  "ruff>=0.5.0",
]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Step 3: Create package markers**

```python
__all__ = []
```

Write the same minimal marker into:

- `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/__init__.py`
- `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/__init__.py`

**Step 4: Write the first failing smoke test**

```python
from aos_cli.cli import main


def test_main_help_returns_zero(capsys):
    code = main(["--help"])

    assert code == 0
    captured = capsys.readouterr()
    assert "agentos" in captured.out
```

**Step 5: Implement minimal CLI**

```python
import argparse
from collections.abc import Sequence


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agentos")
    subparsers = parser.add_subparsers(dest="namespace")
    subparsers.add_parser("model")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    parser.parse_args(argv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**Step 6: Run tests**

Run:

```bash
cd /Users/dingzhijian/lingjing/aos-cli
uv run pytest -q
```

Expected: `1 passed`.

**Step 7: Commit**

```bash
git add pyproject.toml README.md src tests
git commit -m "Create standalone aos-cli skeleton"
```

---

## Task 2: Define Protocol Models and Error Envelope

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/protocol.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/errors.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_model_protocol.py`

**Step 1: Write failing tests for request validation**

```python
import pytest

from aos_cli.model.errors import ModelServiceError
from aos_cli.model.protocol import parse_request, success_response, failure_response


def test_parse_request_requires_api_version():
    with pytest.raises(ModelServiceError) as exc:
        parse_request({"task": "x", "capability": "generate", "output": {"kind": "text"}})

    assert exc.value.code == "INVALID_REQUEST"


def test_success_response_has_stable_shape():
    response = success_response(
        task="storyboard.scene",
        capability="generate",
        output={"kind": "text", "text": "ok"},
        provider="gemini",
        model="gemini-3.1-flash-lite",
        usage={},
        latency_ms=12,
    )

    assert response["ok"] is True
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["output"]["text"] == "ok"


def test_failure_response_has_stable_shape():
    response = failure_response(
        task="storyboard.scene",
        capability="generate",
        code="PROVIDER_AUTH_FAILED",
        message="bad key",
        retryable=False,
        provider="gemini",
        status_code=401,
    )

    assert response["ok"] is False
    assert response["error"]["code"] == "PROVIDER_AUTH_FAILED"
```

**Step 2: Implement `ModelServiceError`**

```python
class ModelServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        provider: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.provider = provider
        self.status_code = status_code
```

**Step 3: Implement protocol helpers**

```python
API_VERSION = "aos-cli.model/v1"


def parse_request(payload: dict) -> dict:
    required = ["apiVersion", "task", "capability", "output", "input"]
    for field in required:
        if field not in payload:
            raise ModelServiceError("INVALID_REQUEST", f"Missing required field: {field}")
    if payload["apiVersion"] != API_VERSION:
        raise ModelServiceError("INVALID_REQUEST", f"Unsupported apiVersion: {payload['apiVersion']}")
    if not isinstance(payload["output"], dict) or "kind" not in payload["output"]:
        raise ModelServiceError("INVALID_REQUEST", "output.kind is required")
    return payload
```

Also implement `success_response()` and `failure_response()` exactly matching the spec.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_model_protocol.py -q
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/protocol.py src/aos_cli/model/errors.py tests/test_model_protocol.py
git commit -m "Define model protocol envelope"
```

---

## Task 3: Add JSON Output Validation

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/validators.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/schemas.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_json_output_validation.py`

**Step 1: Write failing tests**

```python
import pytest

from aos_cli.model.errors import ModelServiceError
from aos_cli.model.validators import validate_json_output


def test_validate_json_output_accepts_schema_valid_data():
    schema = {
        "type": "object",
        "required": ["title"],
        "properties": {"title": {"type": "string"}},
        "additionalProperties": False,
    }

    assert validate_json_output({"title": "Scene 1"}, schema) == {"title": "Scene 1"}


def test_validate_json_output_rejects_missing_field():
    schema = {
        "type": "object",
        "required": ["title"],
        "properties": {"title": {"type": "string"}},
    }

    with pytest.raises(ModelServiceError) as exc:
        validate_json_output({}, schema)

    assert exc.value.code == "OUTPUT_SCHEMA_FAILED"
```

**Step 2: Implement validation**

```python
from jsonschema import ValidationError, validate

from aos_cli.model.errors import ModelServiceError


def validate_json_output(data: object, schema: dict) -> object:
    try:
        validate(instance=data, schema=schema)
    except ValidationError as exc:
        raise ModelServiceError(
            "OUTPUT_SCHEMA_FAILED",
            exc.message,
            retryable=True,
        ) from exc
    return data
```

**Step 3: Add initial schema registry**

```python
SCHEMAS: dict[str, dict] = {
    "generic.object.v1": {
        "type": "object",
    }
}


def get_schema(name: str) -> dict:
    try:
        return SCHEMAS[name]
    except KeyError as exc:
        raise ModelServiceError("SCHEMA_NOT_FOUND", f"Unknown schema: {name}") from exc
```

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_json_output_validation.py -q
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/validators.py src/aos_cli/model/schemas.py tests/test_json_output_validation.py
git commit -m "Validate structured model output"
```

---

## Task 4: Implement Gemini Provider for Text and JSON

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/providers/__init__.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/providers/gemini.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_gemini_provider.py`

**Step 1: Write tests with fake HTTP transport**

```python
import json

from aos_cli.model.providers.gemini import GeminiProvider


class FakeTransport:
    def __init__(self, payload):
        self.payload = payload
        self.last_url = None
        self.last_body = None

    def post_json(self, url, body, headers, timeout):
        self.last_url = url
        self.last_body = body
        return self.payload


def test_gemini_provider_extracts_text():
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "hello"}]
                    }
                }
            ]
        }
    )
    provider = GeminiProvider(
        api_key="test",
        base_url="https://example.com/gemini",
        model="gemini-3.1-flash-lite",
        transport=transport,
    )

    result = provider.generate_text(system="sys", content="hi", options={})

    assert result.text == "hello"
    assert "generateContent" in transport.last_url


def test_gemini_provider_extracts_json_text():
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"title": "ok"})}]
                    }
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    result = provider.generate_text(system="sys", content={"x": 1}, options={"responseMimeType": "application/json"})

    assert json.loads(result.text) == {"title": "ok"}
```

**Step 2: Implement transport seam**

```python
import json
import urllib.error
import urllib.request

from aos_cli.model.errors import ModelServiceError


def map_http_error(status_code: int, raw: str) -> ModelServiceError:
    if status_code in {401, 403}:
        return ModelServiceError("PROVIDER_AUTH_FAILED", raw, retryable=False, status_code=status_code)
    if status_code in {402, 429}:
        return ModelServiceError("PROVIDER_QUOTA_EXHAUSTED", raw, retryable=True, status_code=status_code)
    return ModelServiceError("PROVIDER_BAD_RESPONSE", raw, retryable=status_code >= 500, status_code=status_code)


def extract_text(payload: dict) -> str:
    try:
        return payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelServiceError("PROVIDER_BAD_RESPONSE", "Gemini response missing text", retryable=True) from exc


def extract_usage(payload: dict) -> dict:
    usage = payload.get("usageMetadata") or {}
    return {
        "inputTokens": usage.get("promptTokenCount", 0),
        "outputTokens": usage.get("candidatesTokenCount", 0),
    }


class UrllibTransport:
    def post_json(self, url: str, body: dict, headers: dict, timeout: int) -> dict:
        request = urllib.request.Request(
            url,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get("content-type", "")
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise map_http_error(exc.code, raw) from exc

        if "html" in content_type.lower() or raw.lstrip().startswith("<"):
            raise ModelServiceError("PROVIDER_BAD_RESPONSE", "Provider returned HTML", retryable=True)

        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ModelServiceError("PROVIDER_BAD_RESPONSE", "Provider returned non-JSON", retryable=True) from exc
```

**Step 3: Implement provider**

```python
from dataclasses import dataclass
import json


@dataclass(frozen=True)
class ProviderTextResult:
    text: str
    model: str
    usage: dict


class GeminiProvider:
    def __init__(self, api_key: str, base_url: str, model: str, transport=None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.transport = transport or UrllibTransport()

    def generate_text(self, *, system: str | None, content: object, options: dict) -> ProviderTextResult:
        body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)}],
                }
            ],
            "generationConfig": {
                "temperature": options.get("temperature", 0.6),
                "maxOutputTokens": options.get("maxOutputTokens", 2000),
            },
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if options.get("responseMimeType"):
            body["generationConfig"]["responseMimeType"] = options["responseMimeType"]

        url = f"{self.base_url}/v1beta/models/{self.model}:generateContent"
        payload = self.transport.post_json(
            url,
            body,
            headers={"x-goog-api-key": self.api_key, "content-type": "application/json"},
            timeout=options.get("timeoutSeconds", 180),
        )
        text = extract_text(payload)
        return ProviderTextResult(text=text, model=self.model, usage=extract_usage(payload))
```

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_gemini_provider.py -q
```

Expected: all tests pass without network.

**Step 5: Commit**

```bash
git add src/aos_cli/model/providers tests/test_gemini_provider.py
git commit -m "Add Gemini model provider adapter"
```

---

## Task 5: Implement Model Service Routing

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/service.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/config.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_model_service.py`

**Step 1: Write failing tests**

```python
from aos_cli.model.service import ModelService


class FakeProvider:
    def generate_text(self, *, system, content, options):
        return type("Result", (), {"text": "{\"title\":\"ok\"}", "model": "fake", "usage": {}})()


def test_service_returns_text_output():
    service = ModelService(provider_factory=lambda request: FakeProvider())
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.text",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"system": "sys", "content": "hi"},
        }
    )

    assert response["ok"] is True
    assert response["output"]["text"] == "{\"title\":\"ok\"}"


def test_service_returns_validated_json_output():
    service = ModelService(provider_factory=lambda request: FakeProvider())
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.json",
            "capability": "generate",
            "output": {"kind": "json", "schema": "generic.object.v1"},
            "input": {"system": "sys", "content": {"x": 1}},
        }
    )

    assert response["ok"] is True
    assert response["output"]["data"] == {"title": "ok"}
```

**Step 2: Implement config resolver**

```python
import os


def resolve_gemini_config(request: dict) -> dict:
    policy = request.get("modelPolicy") or {}
    return {
        "api_key": os.environ.get("GEMINI_API_KEY", ""),
        "base_url": os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com"),
        "model": policy.get("model") or os.environ.get("GEMINI_TEXT_MODEL", "gemini-3.1-flash-lite"),
    }
```

**Step 3: Implement service**

```python
import json
import time

from aos_cli.model.errors import ModelServiceError
from aos_cli.model.protocol import failure_response, parse_request, success_response
from aos_cli.model.schemas import get_schema
from aos_cli.model.validators import validate_json_output


class ModelService:
    def __init__(self, provider_factory):
        self.provider_factory = provider_factory

    def run(self, payload: dict) -> dict:
        start = time.monotonic()
        try:
            request = parse_request(payload)
            if request["capability"] != "generate":
                raise ModelServiceError("UNSUPPORTED_CAPABILITY", request["capability"])

            provider = self.provider_factory(request)
            output_kind = request["output"]["kind"]
            options = dict(request.get("options") or {})
            if output_kind == "json":
                options["responseMimeType"] = "application/json"

            result = provider.generate_text(
                system=request["input"].get("system"),
                content=request["input"].get("content", ""),
                options=options,
            )

            if output_kind == "text":
                if not result.text.strip():
                    raise ModelServiceError("OUTPUT_PARSE_FAILED", "Model returned empty text", retryable=True)
                output = {"kind": "text", "text": result.text}
            elif output_kind == "json":
                try:
                    data = json.loads(result.text)
                except json.JSONDecodeError as exc:
                    raise ModelServiceError(
                        "OUTPUT_PARSE_FAILED",
                        "Model returned invalid JSON",
                        retryable=True,
                    ) from exc
                schema_name = request["output"].get("schema", "generic.object.v1")
                data = validate_json_output(data, get_schema(schema_name))
                output = {"kind": "json", "data": data, "validated": True, "schema": schema_name}
            else:
                raise ModelServiceError("UNSUPPORTED_CAPABILITY", f"Unsupported output kind: {output_kind}")

            return success_response(
                task=request["task"],
                capability=request["capability"],
                output=output,
                provider="gemini",
                model=result.model,
                usage=result.usage,
                latency_ms=int((time.monotonic() - start) * 1000),
            )
        except ModelServiceError as exc:
            return failure_response(
                task=payload.get("task", "unknown"),
                capability=payload.get("capability", "unknown"),
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
                provider=exc.provider,
                status_code=exc.status_code,
            )
```

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_model_service.py -q
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/service.py src/aos_cli/model/config.py tests/test_model_service.py
git commit -m "Route model requests through service core"
```

---

## Task 6: Wire `aos-cli model run`

**Files:**
- Modify: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/cli.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_model_run_cli.py`

**Step 1: Write failing CLI tests**

```python
import json

from aos_cli.cli import main


def test_model_run_writes_response_file(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    response_path = tmp_path / "response.json"
    request_path.write_text(
        json.dumps(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "test.text",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")
    code = main(["model", "run", "--input", str(request_path), "--output", str(response_path)])

    assert code == 0
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert payload["ok"] is True
```

**Step 2: Add subcommands**

```python
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agentos")
    namespaces = parser.add_subparsers(dest="namespace", required=True)

    model = namespaces.add_parser("model")
    model_commands = model.add_subparsers(dest="model_command", required=True)

    run = model_commands.add_parser("run")
    run.add_argument("--input", required=True)
    run.add_argument("--output", required=True)

    preflight = model_commands.add_parser("preflight")
    preflight.add_argument("--json", action="store_true", dest="json_output")

    capabilities = model_commands.add_parser("capabilities")
    capabilities.add_argument("--json", action="store_true", dest="json_output")
    return parser
```

**Step 3: Implement file IO**

```python
def run_model_command(args: argparse.Namespace) -> int:
    if args.model_command == "run":
        request = json.loads(Path(args.input).read_text(encoding="utf-8"))
        service = build_default_model_service()
        response = service.run(request)
        Path(args.output).write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0 if response.get("ok") else 2
    raise SystemExit(f"Unsupported model command: {args.model_command}")
```

Logs must go to stderr only.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_model_run_cli.py -q
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/aos_cli/cli.py tests/test_model_run_cli.py
git commit -m "Expose model run CLI"
```

---

## Task 7: Implement Real Preflight

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/preflight.py`
- Modify: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/cli.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_preflight.py`

**Step 1: Write failing tests for bad provider responses**

```python
from aos_cli.model.preflight import classify_probe_response


def test_preflight_rejects_html_response():
    result = classify_probe_response(200, "text/html", "<!DOCTYPE html>")

    assert result["ok"] is False
    assert result["error"]["code"] == "PROVIDER_BAD_RESPONSE"


def test_preflight_classifies_auth_failure():
    result = classify_probe_response(401, "application/json", "{\"error\":\"bad key\"}")

    assert result["ok"] is False
    assert result["error"]["code"] == "PROVIDER_AUTH_FAILED"


def test_preflight_classifies_quota_failure():
    result = classify_probe_response(429, "application/json", "{\"error\":\"quota\"}")

    assert result["ok"] is False
    assert result["error"]["code"] == "PROVIDER_QUOTA_EXHAUSTED"
```

**Step 2: Implement classifier**

```python
def classify_probe_response(status_code: int, content_type: str, raw: str) -> dict:
    if "html" in content_type.lower() or raw.lstrip().startswith("<"):
        return {"ok": False, "error": {"code": "PROVIDER_BAD_RESPONSE", "retryable": True}}
    if status_code in {401, 403}:
        return {"ok": False, "error": {"code": "PROVIDER_AUTH_FAILED", "retryable": False}}
    if status_code in {402, 429}:
        return {"ok": False, "error": {"code": "PROVIDER_QUOTA_EXHAUSTED", "retryable": True}}
    if status_code >= 500:
        return {"ok": False, "error": {"code": "PROVIDER_BAD_RESPONSE", "retryable": True}}
    if status_code >= 400:
        return {"ok": False, "error": {"code": "PROVIDER_BAD_RESPONSE", "retryable": False}}
    return {"ok": True}
```

**Step 3: Implement preflight command**

Preflight should:

- Check `GEMINI_API_KEY`.
- Check `GEMINI_BASE_URL`.
- Send a minimal generateContent request.
- Require JSON response.
- Return a structured checks array.

**Step 4: Run tests**

Run:

```bash
uv run pytest tests/test_preflight.py -q
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/aos_cli/model/preflight.py src/aos_cli/cli.py tests/test_preflight.py
git commit -m "Add real model preflight checks"
```

---

## Task 8: Implement Capabilities Command

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/model/capabilities.py`
- Modify: `/Users/dingzhijian/lingjing/aos-cli/src/aos_cli/cli.py`
- Create: `/Users/dingzhijian/lingjing/aos-cli/tests/test_capabilities.py`

**Step 1: Write failing test**

```python
from aos_cli.model.capabilities import capabilities_payload


def test_capabilities_declares_generate_text_and_json():
    payload = capabilities_payload()

    names = {item["name"] for item in payload["capabilities"]}
    assert "generate" in names
    generate = next(item for item in payload["capabilities"] if item["name"] == "generate")
    assert "text" in generate["outputKinds"]
    assert "json" in generate["outputKinds"]
```

**Step 2: Implement payload**

```python
from aos_cli.model.protocol import API_VERSION


def capabilities_payload() -> dict:
    return {
        "apiVersion": API_VERSION,
        "capabilities": [
            {
                "name": "generate",
                "outputKinds": ["text", "json"],
                "providers": ["gemini"],
                "models": [],
            }
        ],
    }
```

**Step 3: Wire CLI**

Run:

```bash
aos-cli model capabilities --json
```

Expected: JSON printed to stdout and no human prose.

**Step 4: Commit**

```bash
git add src/aos_cli/model/capabilities.py src/aos_cli/cli.py tests/test_capabilities.py
git commit -m "Expose model capabilities"
```

---

## Task 9: Add Contract Examples

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/examples/text.request.json`
- Create: `/Users/dingzhijian/lingjing/aos-cli/examples/json.request.json`
- Create: `/Users/dingzhijian/lingjing/aos-cli/docs/MODEL_PROTOCOL.md`

**Step 1: Create text example**

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "example.text",
  "capability": "generate",
  "output": {
    "kind": "text"
  },
  "modelPolicy": {
    "tier": "fast",
    "provider": "auto"
  },
  "input": {
    "system": "You write concise production notes.",
    "content": "Summarize why stable model envelopes matter."
  }
}
```

**Step 2: Create JSON example**

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "example.json",
  "capability": "generate",
  "output": {
    "kind": "json",
    "schema": "generic.object.v1"
  },
  "modelPolicy": {
    "tier": "fast",
    "provider": "auto"
  },
  "input": {
    "system": "Return only JSON.",
    "content": {
      "title": "Scene analysis"
    }
  }
}
```

**Step 3: Document protocol**

Copy the stable protocol sections from the AgentOS-TS spec into the new project doc. Keep it concise and make `/Users/dingzhijian/lingjing/aos-cli/docs/MODEL_PROTOCOL.md` the local source of truth once implementation starts.

**Step 4: Commit**

```bash
git add examples docs
git commit -m "Document model protocol examples"
```

---

## Task 10: Add AgentOS-TS Integration Spike

**Files:**
- Create: `/Users/dingzhijian/lingjing/aos-cli/examples/aos_cli_storyboard_request.json`
- Create: `/Users/dingzhijian/lingjing/aos-cli/examples/call_from_skill.sh`

**Step 1: Create integration request**

```json
{
  "apiVersion": "aos-cli.model/v1",
  "task": "storyboard.scene",
  "capability": "generate",
  "output": {
    "kind": "json",
    "schema": "generic.object.v1"
  },
  "modelPolicy": {
    "tier": "fast",
    "provider": "auto"
  },
  "input": {
    "system": "You are a storyboard director.",
    "content": {
      "scene_id": "scn001",
      "summary": "A quiet meeting at night.",
      "style": "stylized 3D ancient drama"
    }
  }
}
```

**Step 2: Create shell example**

```bash
#!/usr/bin/env bash
set -euo pipefail

REQUEST_PATH="${1:?request path is required}"
RESPONSE_PATH="${2:?response path is required}"

aos-cli model run --input "$REQUEST_PATH" --output "$RESPONSE_PATH"
```

**Step 3: Run local dry call with fake provider**

Run:

```bash
AOS_CLI_MODEL_FAKE=1 aos-cli model run \
  --input examples/aos_cli_storyboard_request.json \
  --output /tmp/aos-cli-model-response.json
```

Expected: response file exists and contains `"ok": true`.

**Step 4: Commit**

```bash
git add examples/aos_cli_storyboard_request.json examples/call_from_skill.sh
git commit -m "Add AgentOS skill integration example"
```

---

## Task 11: Full Verification

**Files:**
- Modify only if verification finds defects.

**Step 1: Run unit tests**

```bash
cd /Users/dingzhijian/lingjing/aos-cli
uv run pytest -q
```

Expected: all tests pass.

**Step 2: Run lint**

```bash
uv run ruff check .
```

Expected: no lint failures.

**Step 3: Test installed console script**

```bash
uv run aos-cli --help
uv run aos-cli model capabilities --json
```

Expected: commands print valid help or JSON.

**Step 4: Run fake-provider file round trip**

```bash
AOS_CLI_MODEL_FAKE=1 uv run aos-cli model run \
  --input examples/text.request.json \
  --output /tmp/aos-cli-text-response.json
```

Expected: `/tmp/aos-cli-text-response.json` contains `"ok": true`.

**Step 5: Commit verification fixes if needed**

```bash
git add .
git commit -m "Stabilize aos-cli model verification"
```

Skip this commit if no files changed.

---

## Milestone Definition of Done

The MVP is complete only when:

- `aos-cli model run` handles `output.kind=text`.
- `aos-cli model run` handles `output.kind=json`.
- JSON output is schema validated.
- Provider auth/quota/bad-response errors map to stable error codes.
- `aos-cli model preflight --json` rejects HTML and non-JSON responses.
- `aos-cli model capabilities --json` returns a stable machine payload.
- Logs do not pollute stdout.
- AgentOS-TS can call the CLI through a shell command without importing provider code.

## Remaining Risks

- Gemini proxy header/query authentication may need provider-specific adjustment after first real probe.
- JSON repair/retry is intentionally not in the first implementation slice; schema failure returns a structured error first.
- Image and video adapters are specified but not implemented in the first milestone.
- The new CLI must not become a second pipeline runtime; keep stage logic in AgentOS harness.
