# input: environment variables and minimal provider probe responses
# output: structured preflight payloads for CLI and harness checks
# pos: real runnability gate for model-provider configuration

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from aos_cli.model.config import (
    DEFAULT_ARK_VIDEO_MODEL,
    DEFAULT_GEMINI_BASE_URL,
    DEFAULT_GEMINI_EMBED_MODEL,
    DEFAULT_GEMINI_TEXT_MODEL,
    DEFAULT_OPENAI_IMAGE_MODEL,
)
from aos_cli.model.errors import AUTH_ERROR, PROVIDER_REJECTED, RATE_LIMITED
from aos_cli.model.registry import CAPABILITIES


def classify_probe_response(status_code: int, content_type: str, raw: str) -> dict:
    if "html" in content_type.lower() or raw.lstrip().startswith("<"):
        return _failed_check(PROVIDER_REJECTED, "Provider returned HTML", True, status_code)
    if status_code in {401, 403}:
        return _failed_check(AUTH_ERROR, raw or "Provider authentication failed", False, status_code)
    if status_code in {402, 429}:
        return _failed_check(RATE_LIMITED, raw or "Provider quota exhausted", True, status_code)
    if status_code >= 500:
        return _failed_check(PROVIDER_REJECTED, raw or "Provider server error", True, status_code)
    if status_code >= 400:
        return _failed_check(PROVIDER_REJECTED, raw or "Provider request failed", False, status_code)
    return {"ok": True}


def preflight_payload() -> dict:
    start = time.monotonic()
    checks = [_capability_preflight_check(name) for name in CAPABILITIES]
    if checks:
        checks[0]["latencyMs"] = int((time.monotonic() - start) * 1000)
    return {
        "ok": all(check["ok"] for check in checks),
        "checks": checks,
        "warnings": [],
    }


def _capability_preflight_check(capability: str) -> dict:
    if os.environ.get("AOS_CLI_MODEL_FAKE") == "1":
        return _ok_check(capability)
    if capability == "image.generate":
        return _env_preflight_check(
            capability=capability,
            name="openai_compatible.image.generate",
            provider="openai_compatible",
            model=os.environ.get("OPENAI_IMAGE_MODEL", DEFAULT_OPENAI_IMAGE_MODEL),
            env_name="OPENAI_API_KEY",
        )
    if capability == "video.generate":
        return _env_preflight_check(
            capability=capability,
            name="ark.video.generate",
            provider="ark",
            model=os.environ.get("ARK_VIDEO_MODEL", DEFAULT_ARK_VIDEO_MODEL),
            env_name="ARK_API_KEY",
        )
    if capability == "embed":
        return _gemini_preflight_check(
            capability=capability,
            name="gemini.embed",
            model=os.environ.get("GEMINI_EMBED_MODEL", DEFAULT_GEMINI_EMBED_MODEL),
            probe=False,
        )
    return _gemini_preflight_check(
        capability=capability,
        name=f"gemini.{capability}",
        model=os.environ.get("GEMINI_TEXT_MODEL", DEFAULT_GEMINI_TEXT_MODEL),
        probe=capability == "generate",
    )


def _ok_check(capability: str) -> dict:
    registered = CAPABILITIES[capability]
    return {
        "name": f"fake.{capability}",
        "capability": capability,
        "ok": True,
        "provider": registered.providers[0],
        "model": registered.models[0] if registered.models else "fake-model",
        "probeMode": "fake",
    }


def _gemini_preflight_check(*, capability: str, name: str, model: str, probe: bool) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return {
            "name": name,
            "capability": capability,
            "ok": False,
            "provider": "gemini",
            "model": model,
            "probeMode": "provider" if probe else "env",
            "error": {
                "code": AUTH_ERROR,
                "message": "GEMINI_API_KEY is not set",
                "retryable": False,
            },
        }

    if not probe:
        return {
            "name": name,
            "capability": capability,
            "ok": True,
            "provider": "gemini",
            "model": model,
            "probeMode": "env",
        }

    base_url = os.environ.get("GEMINI_BASE_URL", DEFAULT_GEMINI_BASE_URL).rstrip("/")
    status_code, content_type, raw = _probe_gemini(base_url, model, api_key)
    classification = classify_probe_response(status_code, content_type, raw)
    if not classification["ok"]:
        return {
            "name": name,
            "capability": capability,
            "ok": False,
            "provider": "gemini",
            "model": model,
            "probeMode": "provider",
            "error": classification["error"],
        }

    try:
        json.loads(raw)
    except json.JSONDecodeError:
        return {
            "name": name,
            "capability": capability,
            "ok": False,
            "provider": "gemini",
            "model": model,
            "probeMode": "provider",
            "error": {
                "code": PROVIDER_REJECTED,
                "message": "Provider returned non-JSON",
                "retryable": True,
            },
        }

    return {
        "name": name,
        "capability": capability,
        "ok": True,
        "provider": "gemini",
        "model": model,
        "probeMode": "provider",
    }


def _env_preflight_check(*, capability: str, name: str, provider: str, model: str, env_name: str) -> dict:
    if os.environ.get(env_name, ""):
        return {
            "name": name,
            "capability": capability,
            "ok": True,
            "provider": provider,
            "model": model,
            "probeMode": "env",
        }
    return {
        "name": name,
        "capability": capability,
        "ok": False,
        "provider": provider,
        "model": model,
        "probeMode": "env",
        "error": {
            "code": AUTH_ERROR,
            "message": f"{env_name} is not set",
            "retryable": False,
        },
    }


def _probe_gemini(base_url: str, model: str, api_key: str) -> tuple[int, str, str]:
    body = {
        "contents": [{"role": "user", "parts": [{"text": "Return ok."}]}],
        "generationConfig": {"maxOutputTokens": 8, "temperature": 0},
    }
    request = urllib.request.Request(
        f"{base_url}/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return (
                response.status,
                response.headers.get("content-type", ""),
                response.read().decode("utf-8", errors="replace"),
            )
    except urllib.error.HTTPError as exc:
        return (
            exc.code,
            exc.headers.get("content-type", ""),
            exc.read().decode("utf-8", errors="replace"),
        )
    except TimeoutError:
        return 408, "application/json", "Provider timeout"


def _failed_check(code: str, message: str, retryable: bool, status_code: int) -> dict:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "statusCode": status_code,
        },
    }
