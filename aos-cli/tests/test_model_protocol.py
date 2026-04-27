import pytest

from aos_cli.model.errors import AUTH_ERROR, INVALID_REQUEST, UNSUPPORTED_CAPABILITY, UNSUPPORTED_OUTPUT_KIND, ModelServiceError
from aos_cli.model.protocol import (
    failure_response,
    parse_request,
    success_response,
    validate_request_payload,
)


def test_parse_request_rejects_missing_apiversion():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "task": "x",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": {"content": "hi"},
            }
        )

    assert exc.value.code == INVALID_REQUEST
    assert exc.value.message == "Missing required field: apiVersion"


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

    assert exc.value.code == INVALID_REQUEST


def test_parse_request_requires_input_object():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "x",
                "capability": "generate",
                "output": {"kind": "text"},
                "input": "hi",
            }
        )

    assert exc.value.code == INVALID_REQUEST
    assert exc.value.message == "input must be an object"


def test_parse_request_requires_output_kind():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "x",
                "capability": "generate",
                "output": {},
                "input": {},
            }
        )

    assert exc.value.code == INVALID_REQUEST


def test_parse_request_rejects_unsupported_capability():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "x",
                "capability": "unknown.generate",
                "output": {"kind": "artifact"},
                "input": {},
            }
        )

    assert exc.value.code == UNSUPPORTED_CAPABILITY


def test_parse_request_rejects_unsupported_output_kind():
    with pytest.raises(ModelServiceError) as exc:
        parse_request(
            {
                "apiVersion": "aos-cli.model/v1",
                "task": "x",
                "capability": "generate",
                "output": {"kind": "artifact"},
                "input": {},
            }
        )

    assert exc.value.code == UNSUPPORTED_OUTPUT_KIND


def test_validate_request_payload_accepts_valid_request():
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


def test_validate_request_payload_rejects_missing_apiversion():
    response = validate_request_payload(
        {
            "task": "bad-request",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hello"},
        }
    )

    assert response["ok"] is False
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["task"] == "bad-request"
    assert response["capability"] == "generate"
    assert response["error"]["code"] == INVALID_REQUEST
    assert response["error"]["message"] == "Missing required field: apiVersion"
    assert response["error"]["retryable"] is False
    assert response["warnings"] == []


def test_validate_request_payload_rejects_missing_input():
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
    assert response["error"]["code"] == INVALID_REQUEST
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

    assert exc.value.code == UNSUPPORTED_OUTPUT_KIND


def test_parse_request_accepts_all_registered_generate_output_kinds():
    for output_kind in ("text", "json"):
        request = {
            "apiVersion": "aos-cli.model/v1",
            "task": "x",
            "capability": "generate",
            "output": {"kind": output_kind},
            "input": {},
        }

        assert parse_request(request)["output"]["kind"] == output_kind


def test_parse_request_accepts_registered_image_generate():
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": "asset.character.front",
        "capability": "image.generate",
        "output": {"kind": "artifact"},
        "input": {"prompt": "draw"},
    }

    assert parse_request(request)["capability"] == "image.generate"


def test_parse_request_accepts_registered_video_generate_task():
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": "video.clip",
        "capability": "video.generate",
        "output": {"kind": "task"},
        "input": {"prompt": "move"},
    }

    assert parse_request(request)["output"]["kind"] == "task"


def test_parse_request_accepts_registered_video_generate_task_result():
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": "video.clip",
        "capability": "video.generate",
        "output": {"kind": "task_result"},
        "input": {"taskId": "task-1"},
    }

    assert parse_request(request)["output"]["kind"] == "task_result"


def test_parse_request_accepts_registered_video_analyze_json():
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": "video.clip.analysis",
        "capability": "video.analyze",
        "output": {"kind": "json"},
        "input": {"content": {"prompt": "compare variants", "videos": ["file:///tmp/clip.mp4"]}},
    }

    assert parse_request(request)["capability"] == "video.analyze"


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
    assert response["provider"] == "gemini"
    assert response["latencyMs"] == 12


def test_failure_response_has_stable_shape():
    response = failure_response(
        task="storyboard.scene",
        capability="generate",
        code=AUTH_ERROR,
        message="bad key",
        retryable=False,
        provider="gemini",
        status_code=401,
    )

    assert response["ok"] is False
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["error"]["code"] == AUTH_ERROR
    assert response["error"]["statusCode"] == 401
