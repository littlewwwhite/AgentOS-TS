# input: raw request payloads and normalized response values
# output: validated request dictionaries and stable response envelopes
# pos: aos-cli model protocol boundary

from aos_cli.model.errors import (
    INVALID_REQUEST,
    UNSUPPORTED_CAPABILITY,
    UNSUPPORTED_OUTPUT_KIND,
    ModelServiceError,
)
from aos_cli.model.registry import get_capability

API_VERSION = "aos-cli.model/v1"


def parse_request(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError(INVALID_REQUEST, "Request payload must be an object")

    required = ["apiVersion", "task", "capability", "output", "input"]
    for field in required:
        if field not in payload:
            raise ModelServiceError(INVALID_REQUEST, f"Missing required field: {field}")

    api_version = payload["apiVersion"]
    if api_version != API_VERSION:
        raise ModelServiceError(
            INVALID_REQUEST,
            f"Unsupported apiVersion: {api_version}",
        )
    payload = {**payload, "apiVersion": API_VERSION}

    capability = get_capability(payload["capability"])
    if capability is None:
        raise ModelServiceError(
            UNSUPPORTED_CAPABILITY,
            f"Unsupported capability: {payload['capability']}",
        )

    if not isinstance(payload["input"], dict):
        raise ModelServiceError(INVALID_REQUEST, "input must be an object")

    if not isinstance(payload["output"], dict) or "kind" not in payload["output"]:
        raise ModelServiceError(INVALID_REQUEST, "output.kind is required")

    if payload["output"]["kind"] not in capability.output_kinds:
        raise ModelServiceError(
            UNSUPPORTED_OUTPUT_KIND,
            f"Unsupported output kind: {payload['output']['kind']}",
        )

    return payload


def envelope_metadata(request: dict) -> dict:
    metadata = {}
    if isinstance(request.get("trace"), dict):
        metadata["trace"] = request["trace"]
    if isinstance(request.get("labels"), dict):
        metadata["labels"] = request["labels"]
    return metadata


def success_response(
    *,
    task: str,
    capability: str,
    output: dict,
    provider: str,
    model: str,
    usage: dict,
    latency_ms: int,
    warnings: list[str] | None = None,
    trace: dict | None = None,
    labels: dict | None = None,
) -> dict:
    response = {
        "ok": True,
        "apiVersion": API_VERSION,
        "task": task,
        "capability": capability,
        "output": output,
        "provider": provider,
        "model": model,
        "usage": usage,
        "latencyMs": latency_ms,
        "warnings": warnings or [],
    }
    if trace is not None:
        response["trace"] = trace
    if labels is not None:
        response["labels"] = labels
    return response


def failure_response(
    *,
    task: str,
    capability: str,
    code: str,
    message: str,
    retryable: bool,
    provider: str | None = None,
    status_code: int | None = None,
    warnings: list[str] | None = None,
    trace: dict | None = None,
    labels: dict | None = None,
) -> dict:
    error = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if provider is not None:
        error["provider"] = provider
    if status_code is not None:
        error["statusCode"] = status_code

    response = {
        "ok": False,
        "apiVersion": API_VERSION,
        "task": task,
        "capability": capability,
        "error": error,
        "warnings": warnings or [],
    }
    if trace is not None:
        response["trace"] = trace
    if labels is not None:
        response["labels"] = labels
    return response


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
