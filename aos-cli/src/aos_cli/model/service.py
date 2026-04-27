# input: aos-cli model request envelopes
# output: stable model response envelopes
# pos: core model capability service used by CLI and future daemon interfaces

from collections.abc import Callable
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import time
from urllib.parse import unquote, urlparse
import urllib.request

from aos_cli.model.artifacts import CHUNK_SIZE, build_artifact_descriptor, build_remote_artifact_descriptor
from aos_cli.model.config import (
    resolve_ark_video_config,
    resolve_gemini_config,
    resolve_gemini_embedding_config,
    resolve_openai_image_config,
)
from aos_cli.model.errors import (
    ARTIFACT_ERROR,
    INVALID_REQUEST,
    PROVIDER_REJECTED,
    UNSUPPORTED_CAPABILITY,
    ModelServiceError,
    canonical_error_code,
)
from aos_cli.model.media import infer_mime_type
from aos_cli.model.protocol import envelope_metadata, failure_response, parse_request, success_response
from aos_cli.model.providers.gemini import GeminiProvider
from aos_cli.model.providers.ark_video import ArkVideoProvider
from aos_cli.model.providers.openai_image import OpenAIImageProvider


@dataclass(frozen=True)
class _Dispatch:
    handler: Callable[[object, dict], dict]
    resolver: Callable[[dict], object]
    provider_name: str


ProviderFactory = Callable[[dict, "_Dispatch | None"], object]
VIDEO_OPTION_FIELDS = ("referenceImages", "referenceVideos", "duration", "ratio", "resolution", "quality", "needAudio")
METADATA_FIELDS = ("trace", "labels")


def _normalized_service_error(exc: ModelServiceError) -> ModelServiceError:
    return ModelServiceError(
        canonical_error_code(exc.code),
        exc.message,
        retryable=exc.retryable,
        provider=exc.provider,
        status_code=exc.status_code,
    )


def _failure_response_from_exception(payload: dict, exc: ModelServiceError) -> dict:
    normalized = _normalized_service_error(exc)
    metadata = envelope_metadata(payload) if isinstance(payload, dict) else {}
    return failure_response(
        task=payload.get("task", "unknown") if isinstance(payload, dict) else "unknown",
        capability=payload.get("capability", "unknown") if isinstance(payload, dict) else "unknown",
        code=normalized.code,
        message=normalized.message,
        retryable=normalized.retryable,
        provider=normalized.provider,
        status_code=normalized.status_code,
        **metadata,
    )


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


def _resolve_gemini_provider(request: dict) -> GeminiProvider:
    config = resolve_gemini_config(request)
    return GeminiProvider(
        api_key=config["api_key"],
        base_url=config["base_url"],
        model=config["model"],
    )


def _resolve_gemini_embed_provider(request: dict) -> GeminiProvider:
    embedding_config = resolve_gemini_embedding_config(request)
    return GeminiProvider(
        api_key=embedding_config["api_key"],
        base_url=embedding_config["base_url"],
        model=embedding_config["model"],
    )


def _resolve_openai_image_provider(request: dict) -> OpenAIImageProvider:
    image_config = resolve_openai_image_config(request)
    return OpenAIImageProvider(
        api_key=image_config["api_key"],
        base_url=image_config["base_url"],
        model=image_config["model"],
    )


def _resolve_ark_video_provider(request: dict) -> ArkVideoProvider:
    video_config = resolve_ark_video_config(request)
    return ArkVideoProvider(
        api_key=video_config["api_key"],
        base_url=video_config["base_url"],
        model=video_config["model"],
    )


_RUN_DISPATCH: dict[str, _Dispatch] = {
    "generate":         _Dispatch(_handle_generate,       _resolve_gemini_provider,        "gemini"),
    "vision.analyze":   _Dispatch(_handle_vision,         _resolve_gemini_provider,        "gemini"),
    "vision.review":    _Dispatch(_handle_vision,         _resolve_gemini_provider,        "gemini"),
    "video.analyze":    _Dispatch(_handle_vision,         _resolve_gemini_provider,        "gemini"),
    "audio.transcribe": _Dispatch(_handle_audio,          _resolve_gemini_provider,        "gemini"),
    "embed":            _Dispatch(_handle_embed,          _resolve_gemini_embed_provider,  "gemini"),
    "image.generate":   _Dispatch(_handle_image_generate, _resolve_openai_image_provider,  "openai_compatible"),
}


class ModelService:
    def __init__(self, provider_factory: ProviderFactory):
        self.provider_factory = provider_factory

    def run(self, payload: dict) -> dict:
        start = time.monotonic()
        try:
            request = parse_request(payload)
            metadata = envelope_metadata(request)
            dispatch = _RUN_DISPATCH.get(request["capability"])
            if dispatch is None:
                raise ModelServiceError(
                    UNSUPPORTED_CAPABILITY,
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
            return _failure_response_from_exception(payload, exc)

    def submit(self, payload: dict) -> dict:
        start = time.monotonic()
        try:
            request = _parse_video_request(payload, default_output_kind="task", operation="submit")
            metadata = envelope_metadata(request)
            provider = self.provider_factory(request, None)
            result = provider.submit_video(
                prompt=str(request["input"].get("prompt", "")),
                options=_build_video_options(request),
            )
            return success_response(
                task=request["task"],
                capability=request["capability"],
                output={"kind": "task", "taskId": result.task_id, "raw": result.raw},
                provider="ark",
                model=result.model,
                usage={},
                latency_ms=int((time.monotonic() - start) * 1000),
                **metadata,
            )
        except ModelServiceError as exc:
            return _failure_response_from_exception(payload, exc)

    def poll(self, payload: dict) -> dict:
        start = time.monotonic()
        try:
            request = _poll_request_from_payload(payload)
            metadata = envelope_metadata(request)
            provider = self.provider_factory(request, None)
            result = provider.poll_video(
                task_id=request["input"]["taskId"],
                options=dict(request.get("options") or {}),
            )
            return success_response(
                task=request["task"],
                capability=request["capability"],
                output={
                    "kind": "task_result",
                    "taskId": result.task_id,
                    "status": result.status,
                    "artifacts": result.artifacts,
                    "raw": result.raw,
                },
                provider="ark",
                model=result.model,
                usage={},
                latency_ms=int((time.monotonic() - start) * 1000),
                **metadata,
            )
        except ModelServiceError as exc:
            return _failure_response_from_exception(payload, exc)


def build_default_model_service() -> ModelService:
    if os.environ.get("AOS_CLI_MODEL_FAKE") == "1":
        return ModelService(provider_factory=_fake_provider_factory)
    return ModelService(provider_factory=_default_provider_factory)


def _default_provider_factory(request: dict, dispatch: "_Dispatch | None") -> object:
    if request["capability"] == "video.generate":
        return _resolve_ark_video_provider(request)
    if dispatch is None:
        raise ModelServiceError(
            UNSUPPORTED_CAPABILITY,
            f"Unsupported capability: {request['capability']}",
            retryable=False,
        )
    return dispatch.resolver(request)


def _fake_provider_factory(request: dict, dispatch: "_Dispatch | None" = None):
    return _FakeProvider(request)


class _FakeProvider:
    def __init__(self, request: dict) -> None:
        self.request = request

    def generate_text(self, *, system, content, options):
        output_kind = self.request["output"]["kind"]
        if output_kind == "json":
            text = json.dumps(_fake_json_payload(self.request))
        else:
            text = "fake response"
        return type("Result", (), {"text": text, "model": "fake-model", "usage": {}})()

    def generate_multimodal(self, *, system, content, options):
        return self.generate_text(system=system, content=content, options=options)

    def generate_image(self, *, prompt, options):
        policy = self.request.get("artifactPolicy") or {}
        local_dir = Path(policy.get("localDir") or "/tmp/aos-cli-model-fake")
        local_dir.mkdir(parents=True, exist_ok=True)
        image_path = local_dir / "fake-image.png"
        image_path.write_bytes(b"fake-image")
        return type(
            "ImageResult",
            (),
            {"urls": [image_path.resolve().as_uri()], "model": "fake-image-model", "usage": {}},
        )()

    def submit_video(self, *, prompt, options):
        return type("VideoTask", (), {"task_id": "fake-video-task", "model": "fake-video-model", "raw": {}})()

    def poll_video(self, *, task_id, options):
        return type(
            "VideoResult",
            (),
            {
                "task_id": task_id,
                "status": "SUCCESS",
                "artifacts": [
                    {
                        "kind": "video",
                        "uri": "https://example.com/fake-video.mp4",
                        "remoteUrl": "https://example.com/fake-video.mp4",
                        "mimeType": "video/mp4",
                    }
                ],
                "model": "fake-video-model",
                "raw": {},
            },
        )()

    def embed_content(self, *, content, options):
        return type("EmbeddingResult", (), {"values": [0.1, 0.2], "model": "fake-embedding-model", "usage": {}})()


def _fake_json_payload(request: dict) -> dict:
    if request.get("capability") == "audio.transcribe":
        return {
            "segments": [
                {
                    "start": "00:00:00,000",
                    "end": "00:00:02,000",
                    "speaker": "",
                    "text": "fake transcript",
                }
            ]
        }
    return {"ok": True, "task": request["task"]}


def _build_options(request: dict) -> dict:
    options = dict(request.get("options") or {})
    if request["output"]["kind"] == "json":
        options["responseMimeType"] = "application/json"
        if request["output"].get("schema"):
            options["responseJsonSchema"] = request["output"]["schema"]
    return options


def _build_video_options(request: dict) -> dict:
    options = dict(request.get("options") or {})
    content = request.get("input") or {}
    for field in VIDEO_OPTION_FIELDS:
        if field in content and field not in options:
            options[field] = content[field]
    return options


def _audio_content(request: dict) -> dict:
    content = dict(request.get("input") or {})
    content.setdefault("prompt", "Transcribe this audio and return JSON.")
    return content


def _poll_request_from_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError(INVALID_REQUEST, "Poll input must be an object", retryable=False)
    if _is_task_receipt(payload):
        return _poll_request_from_task_receipt(payload)
    return _parse_video_request(payload, default_output_kind="task_result", operation="poll")


def _is_task_receipt(payload: dict) -> bool:
    return payload.get("ok") is True and (payload.get("output") or {}).get("kind") == "task"


def _poll_request_from_task_receipt(payload: dict) -> dict:
    request = {
        "apiVersion": payload.get("apiVersion"),
        "task": payload.get("task", "unknown"),
        "capability": payload.get("capability", "video.generate"),
        "output": {"kind": "task_result"},
        "input": {"taskId": payload["output"].get("taskId")},
        "modelPolicy": {"model": payload.get("model")} if payload.get("model") else {},
    }
    for field in METADATA_FIELDS:
        if isinstance(payload.get(field), dict):
            request[field] = payload[field]
    return _parse_video_request(request, default_output_kind="task_result", operation="poll")


def _parse_video_request(payload: dict, *, default_output_kind: str, operation: str) -> dict:
    request = parse_request(_ensure_video_output(payload, default_output_kind))
    if request["capability"] != "video.generate":
        raise ModelServiceError(
            UNSUPPORTED_CAPABILITY,
            f"{operation} only supports video.generate",
            retryable=False,
        )
    expected_kind = "task" if operation == "submit" else "task_result"
    if request["output"]["kind"] != expected_kind:
        raise ModelServiceError(
            INVALID_REQUEST,
            f"{operation} output.kind must be {expected_kind} or omitted",
            retryable=False,
        )
    if operation == "poll" and not request["input"].get("taskId"):
        raise ModelServiceError(INVALID_REQUEST, "input.taskId is required", retryable=False)
    return request


def _ensure_video_output(payload: dict, kind: str) -> dict:
    if not isinstance(payload, dict):
        raise ModelServiceError(INVALID_REQUEST, "Request must be an object", retryable=False)
    if payload.get("capability") != "video.generate":
        return payload
    if "output" in payload and isinstance(payload["output"], dict) and "kind" in payload["output"]:
        return payload
    output = dict(payload.get("output") or {})
    output["kind"] = kind
    return {**payload, "output": output}


def _normalize_output(request: dict, text: str) -> dict:
    output_kind = request["output"]["kind"]
    if output_kind == "text":
        if not text.strip():
            raise ModelServiceError(PROVIDER_REJECTED, "Model returned empty text", retryable=True)
        return {"kind": "text", "text": text}
    if output_kind == "json":
        data = _parse_json_output(text)
        return {"kind": "json", "data": data}
    raise ModelServiceError(
        UNSUPPORTED_CAPABILITY,
        f"Unsupported output kind: {output_kind}",
        retryable=False,
    )


def _normalize_image_output(request: dict, urls: list[str]) -> dict:
    artifacts = [_artifact_from_url(request, url, index) for index, url in enumerate(urls)]
    return {
        "kind": "artifact",
        "artifacts": artifacts,
    }


def _normalize_embedding_output(request: dict, values: list[float]) -> dict:
    return {"kind": "vector", "values": values, "dimension": len(values)}


def _artifact_from_url(request: dict, url: str, index: int) -> dict:
    policy = request.get("artifactPolicy") or {}
    role = policy.get("role")
    parsed = urlparse(url)
    mime_type = _mime_type_from_url(url)
    if parsed.scheme == "file":
        path = Path(unquote(parsed.path))
        return build_artifact_descriptor(
            path=path,
            kind="image",
            mime_type=mime_type,
            role=role,
            remote_url=None,
        )
    if not policy.get("download", True):
        return build_remote_artifact_descriptor(
            uri=url,
            kind="image",
            mime_type=mime_type,
            role=role,
            remote_url=url,
        )
    local_path, sha256, byte_count = _download_artifact(url, Path(policy.get("localDir") or "/tmp/aos-cli-model-artifacts"), index)
    return build_artifact_descriptor(
        path=local_path,
        kind="image",
        mime_type=mime_type,
        role=role,
        remote_url=url,
        sha256=sha256,
        byte_count=byte_count,
    )


def _download_artifact(url: str, local_dir: Path, index: int) -> tuple[Path, str, int]:
    local_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(urlparse(url).path).suffix or ".bin"
    path = local_dir / f"artifact-{index + 1}{suffix}"
    try:
        with urllib.request.urlopen(url, timeout=180) as response, path.open("wb") as output:
            digest = hashlib.sha256()
            byte_count = 0
            while chunk := response.read(CHUNK_SIZE):
                output.write(chunk)
                digest.update(chunk)
                byte_count += len(chunk)
    except OSError as exc:
        raise ModelServiceError(
            ARTIFACT_ERROR,
            f"Failed to download artifact: {url}",
            retryable=True,
            provider="openai_compatible",
        ) from exc
    return path, digest.hexdigest(), byte_count


def _mime_type_from_url(url: str) -> str:
    return infer_mime_type(url, "image/png")


def _parse_json_output(text: str) -> object:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ModelServiceError(
            PROVIDER_REJECTED,
            "Model returned invalid JSON",
            retryable=True,
        ) from exc
