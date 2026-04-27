from aos_cli.model.errors import (
    ARTIFACT_ERROR,
    AUTH_ERROR,
    CANONICAL_ERROR_CODES,
    CONFIG_ERROR,
    INVALID_REQUEST,
    PROVIDER_REJECTED,
    RATE_LIMITED,
    ModelServiceError,
)
from aos_cli.model.config import resolve_gemini_config
from aos_cli.model.registry import CAPABILITIES
from aos_cli.model.service import ModelService, _RUN_DISPATCH, build_default_model_service


def test_resolve_gemini_config_defaults_to_gemini_3_flash_preview(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)

    config = resolve_gemini_config({})

    assert config["model"] == "gemini-3-flash-preview"


class FakeResult:
    def __init__(self, text: str, model: str = "fake-model", usage: dict | None = None):
        self.text = text
        self.model = model
        self.usage = usage or {}


class FakeImageResult:
    def __init__(self, urls: list[str], model: str = "fake-image-model", usage: dict | None = None):
        self.urls = urls
        self.model = model
        self.usage = usage or {}


class FakeVideoTask:
    def __init__(self, task_id: str = "task-1", model: str = "fake-video-model", raw: dict | None = None):
        self.task_id = task_id
        self.model = model
        self.raw = raw or {}


class FakeVideoResult:
    def __init__(self, task_id: str = "task-1", status: str = "SUCCESS", model: str = "fake-video-model"):
        self.task_id = task_id
        self.status = status
        self.artifacts = [{"kind": "video", "uri": "https://example.com/video.mp4", "mimeType": "video/mp4"}]
        self.model = model
        self.raw = {}


class FakeEmbeddingResult:
    def __init__(self, values: list[float], model: str = "fake-embedding-model", usage: dict | None = None):
        self.values = values
        self.model = model
        self.usage = usage or {}


class FakeEmbeddingProvider:
    def __init__(self, values: list[float]):
        self.values = values

    def embed_content(self, *, content, options):
        return FakeEmbeddingResult(self.values)


class FakeProvider:
    def __init__(self, text: str = '{"title":"ok"}'):
        self.text = text
        self.last_options = None

    def generate_text(self, *, system, content, options):
        self.last_options = options
        return FakeResult(self.text)

    def generate_multimodal(self, *, system, content, options):
        self.last_options = options
        return FakeResult(self.text)

    def generate_image(self, *, prompt, options):
        self.last_options = options
        return FakeImageResult([options["testImageUri"]])

    def submit_video(self, *, prompt, options):
        self.last_options = options
        return FakeVideoTask()

    def poll_video(self, *, task_id, options):
        self.last_options = options
        return FakeVideoResult(task_id=task_id)


def test_every_run_dispatch_capability_exists_in_registry():
    assert set(_RUN_DISPATCH).issubset(set(CAPABILITIES))


def test_service_returns_text_output():
    service = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider("plain text"))
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
    assert response["output"]["text"] == "plain text"


def test_service_passes_trace_and_labels_through():
    service = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider("plain text"))
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "storyboard.scene",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
            "trace": {"episode": 1, "scene": 3},
            "labels": {"stage": "STORYBOARD"},
        }
    )

    assert response["trace"] == {"episode": 1, "scene": 3}
    assert response["labels"] == {"stage": "STORYBOARD"}


def test_service_returns_validated_json_output():
    provider = FakeProvider('{"title":"ok"}')
    service = ModelService(provider_factory=lambda request, dispatch=None: provider)
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.json",
            "capability": "generate",
            "output": {"kind": "json"},
            "input": {"system": "sys", "content": {"x": 1}},
        }
    )

    assert response["ok"] is True
    assert response["output"] == {"kind": "json", "data": {"title": "ok"}}
    assert provider.last_options["responseMimeType"] == "application/json"


def test_service_passes_output_schema_to_provider_options():
    schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
    }
    provider = FakeProvider('{"title":"ok"}')
    service = ModelService(provider_factory=lambda request, dispatch=None: provider)

    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.json.schema",
            "capability": "generate",
            "output": {"kind": "json", "schema": schema},
            "input": {"content": "return a title"},
        }
    )

    assert response["ok"] is True
    assert provider.last_options["responseMimeType"] == "application/json"
    assert provider.last_options["responseJsonSchema"] == schema


def test_service_returns_vision_json_output():
    response = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider('{"approved":true}')).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "review.frame",
            "capability": "vision.analyze",
            "output": {"kind": "json"},
            "input": {"content": {"prompt": "review", "images": ["file:///tmp/frame.png"]}},
        }
    )

    assert response["ok"] is True
    assert response["output"] == {"kind": "json", "data": {"approved": True}}


def test_service_returns_vision_review_json_output():
    provider = FakeProvider('{"approved":true,"issues":[]}')
    response = ModelService(provider_factory=lambda request, dispatch=None: provider).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "asset.review",
            "capability": "vision.review",
            "output": {"kind": "json"},
            "input": {
                "content": {
                    "prompt": "review this asset",
                    "images": ["file:///tmp/asset.png"],
                    "rubric": {"style": "match project bible"},
                }
            },
        }
    )

    assert response["ok"] is True
    assert response["output"] == {"kind": "json", "data": {"approved": True, "issues": []}}


def test_build_default_model_service_fakes_vision_review(monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")

    response = build_default_model_service().run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "asset.review",
            "capability": "vision.review",
            "output": {"kind": "json"},
            "input": {"content": {"prompt": "review", "images": ["file:///tmp/asset.png"]}},
        }
    )

    assert response["ok"] is True
    assert response["provider"] == "gemini"
    assert response["output"] == {"kind": "json", "data": {"ok": True, "task": "asset.review"}}


def test_service_returns_video_analyze_json_output():
    provider = FakeProvider('{"overall":{"recommendation":"use"},"shots":[]}')
    response = ModelService(provider_factory=lambda request, dispatch=None: provider).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip.analysis",
            "capability": "video.analyze",
            "output": {"kind": "json"},
            "input": {"content": {"prompt": "compare variants", "videos": ["file:///tmp/clip.mp4"]}},
        }
    )

    assert response["ok"] is True
    assert response["output"] == {
        "kind": "json",
        "data": {"overall": {"recommendation": "use"}, "shots": []},
    }


def test_build_default_model_service_fakes_video_analyze(monkeypatch):
    monkeypatch.setenv("AOS_CLI_MODEL_FAKE", "1")

    response = build_default_model_service().run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip.analysis",
            "capability": "video.analyze",
            "output": {"kind": "json"},
            "input": {"content": {"prompt": "compare", "videos": ["file:///tmp/clip.mp4"]}},
        }
    )

    assert response["ok"] is True
    assert response["provider"] == "gemini"
    assert response["output"] == {"kind": "json", "data": {"ok": True, "task": "video.clip.analysis"}}


def test_service_returns_audio_transcript_json():
    response = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider('{"segments":[]}')).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "subtitle.transcribe",
            "capability": "audio.transcribe",
            "output": {"kind": "json"},
            "input": {"audio": "file:///tmp/audio.mp3", "glossary": []},
        }
    )

    assert response["ok"] is True
    assert response["output"] == {"kind": "json", "data": {"segments": []}}


def test_service_returns_embedding_vector():
    response = ModelService(provider_factory=lambda request, dispatch=None: FakeEmbeddingProvider([0.1, 0.2])).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "music.match.embed",
            "capability": "embed",
            "output": {"kind": "vector"},
            "input": {"content": "quiet emotional scene"},
        }
    )

    assert response["ok"] is True
    assert response["output"] == {
        "kind": "vector",
        "values": [0.1, 0.2],
        "dimension": 2,
    }


def test_service_returns_image_artifact_output(tmp_path):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"png")
    provider = FakeProvider()
    service = ModelService(provider_factory=lambda request, dispatch=None: provider)

    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "asset.character.front",
            "capability": "image.generate",
            "output": {"kind": "artifact"},
            "input": {"prompt": "draw"},
            "options": {"testImageUri": image_path.as_uri()},
        }
    )

    assert response["ok"] is True
    assert response["provider"] == "openai_compatible"
    assert response["output"]["kind"] == "artifact"
    assert response["output"]["artifacts"][0]["kind"] == "image"
    assert response["output"]["artifacts"][0]["bytes"] == 3


def test_service_submits_video_task():
    service = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider())

    response = service.submit(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task"},
            "input": {"prompt": "move"},
        }
    )

    assert response["ok"] is True
    assert response["output"]["kind"] == "task"
    assert response["output"]["taskId"] == "task-1"


def test_service_passes_video_resolution_from_input_to_provider_options():
    provider = FakeProvider()
    service = ModelService(provider_factory=lambda request, dispatch=None: provider)

    response = service.submit(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task"},
            "input": {"prompt": "move", "resolution": "720p", "quality": "standard"},
        }
    )

    assert response["ok"] is True
    assert provider.last_options["resolution"] == "720p"


def test_service_polls_video_task_result():
    service = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider())

    response = service.poll(
        {
            "ok": True,
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task", "taskId": "task-1"},
            "trace": {"episode": 1},
            "labels": {"stage": "VIDEO"},
        }
    )

    assert response["ok"] is True
    assert response["output"]["kind"] == "task_result"
    assert response["output"]["status"] == "SUCCESS"
    assert response["trace"] == {"episode": 1}
    assert response["labels"] == {"stage": "VIDEO"}


def test_service_maps_invalid_json_to_provider_rejected():
    service = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider("not json"))
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.json",
            "capability": "generate",
            "output": {"kind": "json"},
            "input": {"content": "hi"},
        }
    )

    assert response["ok"] is False
    assert response["error"]["code"] == PROVIDER_REJECTED


def test_service_returns_provider_errors():
    def provider_factory(request, dispatch=None):
        raise ModelServiceError(
            AUTH_ERROR,
            "bad key",
            retryable=False,
            provider="gemini",
            status_code=401,
        )

    response = ModelService(provider_factory=provider_factory).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.text",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
        }
    )

    assert response["ok"] is False
    assert response["error"] == {
        "code": AUTH_ERROR,
        "message": "bad key",
        "retryable": False,
        "provider": "gemini",
        "statusCode": 401,
    }
    assert response["error"]["code"] in CANONICAL_ERROR_CODES


def test_model_service_returns_canonical_provider_error():
    class FailingProvider:
        def generate_text(self, *, system, content, options):
            raise ModelServiceError(
                RATE_LIMITED,
                "Provider quota exceeded",
                retryable=True,
                provider="gemini",
                status_code=429,
            )

    service = ModelService(provider_factory=lambda request, dispatch=None: FailingProvider())
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
    assert response["error"]["code"] == RATE_LIMITED
    assert response["error"]["retryable"] is True
    assert response["error"]["provider"] == "gemini"
    assert response["error"]["statusCode"] == 429


def test_model_service_normalizes_legacy_provider_error_at_boundary():
    class LegacyFailingProvider:
        def generate_text(self, *, system, content, options):
            raise ModelServiceError(
                "PROVIDER_QUOTA_EXHAUSTED",
                "Provider quota exceeded",
                retryable=True,
                provider="gemini",
                status_code=429,
            )

    service = ModelService(provider_factory=lambda request, dispatch=None: LegacyFailingProvider())
    response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "legacy-rate-limit-test",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hello"},
        }
    )

    assert response["ok"] is False
    assert response["error"]["code"] == RATE_LIMITED
    assert response["error"]["code"] in CANONICAL_ERROR_CODES
    assert response["error"]["retryable"] is True
    assert response["error"]["provider"] == "gemini"
    assert response["error"]["statusCode"] == 429


def test_model_service_normalizes_legacy_transport_error_at_boundary():
    def provider_factory(request, dispatch=None):
        raise ModelServiceError(
            "PROVIDER_AUTH_FAILED",
            "bad key",
            retryable=False,
            provider="gemini",
            status_code=401,
        )

    response = ModelService(provider_factory=provider_factory).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "legacy-auth-test",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
        }
    )

    assert response["ok"] is False
    assert response["error"]["code"] == AUTH_ERROR
    assert response["error"]["code"] in CANONICAL_ERROR_CODES
    assert response["error"]["retryable"] is False
    assert response["error"]["provider"] == "gemini"
    assert response["error"]["statusCode"] == 401


def test_model_service_normalizes_legacy_parse_error_at_boundary():
    class LegacyParseFailingProvider:
        def generate_text(self, *, system, content, options):
            raise ModelServiceError(
                "OUTPUT_PARSE_FAILED",
                "Model returned invalid JSON",
                retryable=True,
                provider="gemini",
            )

    response = ModelService(provider_factory=lambda request, dispatch=None: LegacyParseFailingProvider()).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "legacy-parse-test",
            "capability": "generate",
            "output": {"kind": "json"},
            "input": {"content": "hi"},
        }
    )

    assert response["ok"] is False
    assert response["error"]["code"] == PROVIDER_REJECTED
    assert response["error"]["code"] in CANONICAL_ERROR_CODES
    assert response["error"]["retryable"] is True
    assert response["error"]["provider"] == "gemini"
    assert "statusCode" not in response["error"]


def test_model_service_normalizes_legacy_errors_for_submit_and_poll():
    class LegacyVideoProvider:
        def submit_video(self, *, prompt, options):
            raise ModelServiceError(
                "PROVIDER_BAD_RESPONSE",
                "Ark rejected response",
                retryable=True,
                provider="ark",
                status_code=502,
            )

        def poll_video(self, *, task_id, options):
            raise ModelServiceError(
                "PROVIDER_QUOTA_EXHAUSTED",
                "Provider quota exceeded",
                retryable=True,
                provider="ark",
                status_code=429,
            )

    service = ModelService(provider_factory=lambda request, dispatch=None: LegacyVideoProvider())
    submit_response = service.submit(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task"},
            "input": {"prompt": "move"},
        }
    )
    poll_response = service.poll(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task_result"},
            "input": {"taskId": "task-1"},
        }
    )

    assert submit_response["ok"] is False
    assert submit_response["error"]["code"] == PROVIDER_REJECTED
    assert submit_response["error"]["code"] in CANONICAL_ERROR_CODES
    assert submit_response["error"]["retryable"] is True
    assert submit_response["error"]["provider"] == "ark"
    assert submit_response["error"]["statusCode"] == 502

    assert poll_response["ok"] is False
    assert poll_response["error"]["code"] == RATE_LIMITED
    assert poll_response["error"]["code"] in CANONICAL_ERROR_CODES
    assert poll_response["error"]["retryable"] is True
    assert poll_response["error"]["provider"] == "ark"
    assert poll_response["error"]["statusCode"] == 429

    for response in (submit_response, poll_response):
        assert response["error"]["code"] not in {
            "PROVIDER_AUTH_FAILED",
            "PROVIDER_QUOTA_EXHAUSTED",
            "PROVIDER_BAD_RESPONSE",
            "OUTPUT_PARSE_FAILED",
        }
        assert set(response["error"]) == {"code", "message", "retryable", "provider", "statusCode"}
        assert response["warnings"] == []
        assert response["ok"] is False
        assert response["apiVersion"] == "aos-cli.model/v1"
        assert response["task"] == "video.clip"
        assert response["capability"] == "video.generate"



def test_model_service_error_responses_preserve_shape_and_canonical_codes():
    def provider_factory(request, dispatch=None):
        raise ModelServiceError(
            "PROVIDER_AUTH_FAILED",
            "bad key",
            retryable=False,
            provider="gemini",
            status_code=401,
        )

    response = ModelService(provider_factory=provider_factory).run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.text",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
        }
    )

    assert response["ok"] is False
    assert response["apiVersion"] == "aos-cli.model/v1"
    assert response["task"] == "test.text"
    assert response["capability"] == "generate"
    assert response["warnings"] == []
    assert "trace" not in response
    assert "labels" not in response
    assert response["error"] == {
        "code": AUTH_ERROR,
        "message": "bad key",
        "retryable": False,
        "provider": "gemini",
        "statusCode": 401,
    }
    assert response["error"]["code"] in CANONICAL_ERROR_CODES
    assert response["error"]["code"] not in {
        "PROVIDER_AUTH_FAILED",
        "PROVIDER_QUOTA_EXHAUSTED",
        "PROVIDER_BAD_RESPONSE",
        "OUTPUT_PARSE_FAILED",
    }




def test_build_default_model_service_requires_gemini_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    response = build_default_model_service().run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.text",
            "capability": "generate",
            "output": {"kind": "text"},
            "input": {"content": "hi"},
        }
    )

    assert response["ok"] is False
    assert response["error"]["code"] == CONFIG_ERROR


def test_service_error_responses_use_canonical_codes_for_run_submit_and_poll(tmp_path):
    artifact_dir = tmp_path / "artifacts"
    service = ModelService(provider_factory=lambda request, dispatch=None: FakeProvider("not json"))

    run_response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "test.json",
            "capability": "generate",
            "output": {"kind": "json"},
            "input": {"content": "hi"},
        }
    )
    submit_response = service.submit(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task_result"},
            "input": {"prompt": "move"},
        }
    )
    poll_response = service.poll(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "video.clip",
            "capability": "video.generate",
            "output": {"kind": "task_result"},
            "input": {},
        }
    )
    artifact_response = service.run(
        {
            "apiVersion": "aos-cli.model/v1",
            "task": "asset.character.front",
            "capability": "image.generate",
            "output": {"kind": "artifact"},
            "input": {"prompt": "draw"},
            "options": {"testImageUri": "https://127.0.0.1:1/image.png"},
            "artifactPolicy": {"download": True, "localDir": str(artifact_dir)},
        }
    )

    responses = [run_response, submit_response, poll_response, artifact_response]

    assert [response["ok"] for response in responses] == [False, False, False, False]
    for response in responses:
        assert response["error"]["code"] in CANONICAL_ERROR_CODES
    assert run_response["error"]["code"] == PROVIDER_REJECTED
    assert submit_response["error"]["code"] == INVALID_REQUEST
    assert poll_response["error"]["code"] == INVALID_REQUEST
    assert artifact_response["error"]["code"] == ARTIFACT_ERROR
    assert artifact_response["error"]["retryable"] is True
    assert artifact_response["error"]["provider"] == "openai_compatible"
    assert artifact_response["error"]["message"].startswith("Failed to download artifact:")
    if artifact_dir.exists():
        assert list(artifact_dir.iterdir()) == []
