import json

import pytest

from aos_cli.model.errors import AUTH_ERROR, PROVIDER_REJECTED, RATE_LIMITED, ModelServiceError
from aos_cli.model.providers.gemini import GeminiProvider, map_http_error


class FakeTransport:
    def __init__(self, payload):
        self.payload = payload
        self.last_url = None
        self.last_body = None
        self.last_headers = None
        self.last_timeout = None

    def post_json(self, url, body, headers, timeout):
        self.last_url = url
        self.last_body = body
        self.last_headers = headers
        self.last_timeout = timeout
        return self.payload


def test_gemini_provider_extracts_text():
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "hello"}],
                    },
                }
            ],
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2},
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
    assert result.model == "gemini-3.1-flash-lite"
    assert result.usage == {"inputTokens": 3, "outputTokens": 2}
    assert transport.last_url == (
        "https://example.com/gemini/v1beta/models/gemini-3.1-flash-lite:generateContent"
    )
    assert transport.last_headers["x-goog-api-key"] == "test"
    assert transport.last_body["systemInstruction"]["parts"][0]["text"] == "sys"


def test_gemini_provider_extracts_json_text():
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"title": "ok"})}],
                    },
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    result = provider.generate_text(
        system="sys",
        content={"x": 1},
        options={"responseMimeType": "application/json"},
    )

    assert json.loads(result.text) == {"title": "ok"}
    assert transport.last_body["generationConfig"]["responseMimeType"] == "application/json"


def test_gemini_provider_passes_json_schema_to_generation_config():
    schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
    }
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"title": "ok"})}],
                    },
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    provider.generate_text(
        system=None,
        content="return a title",
        options={"responseMimeType": "application/json", "responseJsonSchema": schema},
    )

    assert transport.last_body["generationConfig"]["responseMimeType"] == "application/json"
    assert transport.last_body["generationConfig"]["responseJsonSchema"] == schema


def test_gemini_provider_builds_vision_parts(tmp_path):
    image_path = tmp_path / "frame.png"
    image_path.write_bytes(b"png")
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"approved": True})}],
                    },
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    result = provider.generate_multimodal(
        system=None,
        content={"prompt": "review", "images": [image_path.as_uri()]},
        options={"responseMimeType": "application/json"},
    )

    parts = transport.last_body["contents"][0]["parts"]
    assert json.loads(result.text) == {"approved": True}
    assert parts[0]["text"] == "review"
    assert "inline_data" in parts[1]


def test_gemini_provider_passes_multimodal_json_schema_to_generation_config(tmp_path):
    image_path = tmp_path / "frame.png"
    image_path.write_bytes(b"png")
    schema = {
        "type": "object",
        "properties": {"approved": {"type": "boolean"}},
        "required": ["approved"],
    }
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"approved": True})}],
                    },
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    provider.generate_multimodal(
        system=None,
        content={"prompt": "review", "images": [image_path.as_uri()]},
        options={"responseMimeType": "application/json", "responseJsonSchema": schema},
    )

    assert transport.last_body["generationConfig"]["responseMimeType"] == "application/json"
    assert transport.last_body["generationConfig"]["responseJsonSchema"] == schema


def test_gemini_provider_builds_audio_parts(tmp_path):
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"mp3")
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"segments": []})}],
                    },
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    result = provider.generate_multimodal(
        system=None,
        content={"prompt": "transcribe", "audio": audio_path.as_uri()},
        options={"responseMimeType": "application/json"},
    )

    parts = transport.last_body["contents"][0]["parts"]
    assert json.loads(result.text) == {"segments": []}
    assert parts[0]["text"] == "transcribe"
    assert parts[1]["inline_data"]["mime_type"] == "audio/mpeg"


def test_gemini_provider_builds_video_parts(tmp_path):
    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"mp4")
    transport = FakeTransport(
        {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps({"shots": []})}],
                    },
                }
            ]
        }
    )
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", transport)

    result = provider.generate_multimodal(
        system=None,
        content={"prompt": "analyze", "videos": [video_path.as_uri()]},
        options={"responseMimeType": "application/json"},
    )

    parts = transport.last_body["contents"][0]["parts"]
    assert json.loads(result.text) == {"shots": []}
    assert parts[0]["text"] == "analyze"
    assert parts[1]["inline_data"]["mime_type"] == "video/mp4"


def test_gemini_provider_rejects_large_inline_media(tmp_path):
    video_path = tmp_path / "large.mp4"
    video_path.write_bytes(b"0")
    with video_path.open("ab") as file:
        file.truncate(20 * 1024 * 1024 + 1)
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", FakeTransport({}))

    with pytest.raises(ModelServiceError) as exc:
        provider.generate_multimodal(system=None, content={"videos": [video_path.as_uri()]}, options={})

    assert exc.value.code == "INVALID_REQUEST"


def test_gemini_provider_rejects_unreadable_local_media(tmp_path):
    missing_path = tmp_path / "missing.png"
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", FakeTransport({}))

    with pytest.raises(ModelServiceError) as exc:
        provider.generate_multimodal(system=None, content={"images": [missing_path.as_uri()]}, options={})

    assert exc.value.code == "INVALID_REQUEST"


def test_gemini_provider_embeds_content():
    transport = FakeTransport({"embedding": {"values": [0.1, 0.2]}})
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-embedding-001", transport)

    result = provider.embed_content(content="quiet scene", options={"taskType": "SEMANTIC_SIMILARITY"})

    assert result.values == [0.1, 0.2]
    assert transport.last_url == "https://example.com/gemini/v1beta/models/gemini-embedding-001:embedContent"
    assert transport.last_body["task_type"] == "SEMANTIC_SIMILARITY"


def test_gemini_provider_rejects_missing_text():
    provider = GeminiProvider("test", "https://example.com/gemini", "gemini-test", FakeTransport({}))

    with pytest.raises(ModelServiceError) as exc:
        provider.generate_text(system=None, content="hi", options={})

    assert exc.value.code == PROVIDER_REJECTED


def test_map_http_error_classifies_auth_failure():
    error = map_http_error(401, "bad key")

    assert error.code == AUTH_ERROR
    assert error.retryable is False
    assert error.status_code == 401


def test_map_http_error_classifies_quota_failure():
    error = map_http_error(429, "quota")

    assert error.code == RATE_LIMITED
    assert error.retryable is True
    assert error.status_code == 429
