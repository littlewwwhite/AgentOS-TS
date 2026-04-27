# input: provider-independent video generation requests and Ark endpoint configuration
# output: normalized provider task results or stable model-service errors
# pos: Ark video provider adapter for AgentOS async model service

from __future__ import annotations

from dataclasses import dataclass
import urllib.parse

from aos_cli.model.errors import INVALID_REQUEST, PROVIDER_REJECTED, ModelServiceError
from aos_cli.model.http import JsonHttpTransport, map_http_error as map_provider_http_error


@dataclass(frozen=True)
class ProviderVideoTask:
    task_id: str
    model: str
    raw: dict


@dataclass(frozen=True)
class ProviderVideoTaskResult:
    task_id: str
    status: str
    artifacts: list[dict]
    model: str
    raw: dict


def build_ark_video_task_body(
    *,
    model: str,
    prompt: str,
    reference_images: list[dict] | None = None,
    duration: int = 6,
    ratio: str = "16:9",
    resolution: str = "720p",
    need_audio: bool = True,
    reference_videos: list[dict] | None = None,
) -> dict:
    content = [{"type": "text", "text": prompt}]
    for image in reference_images or []:
        url = image.get("url")
        if url:
            item = {"type": "image_url", "image_url": {"url": url}}
            if image.get("role"):
                item["role"] = image["role"]
            content.append(item)
    for video in reference_videos or []:
        url = video.get("url")
        if url:
            content.append({"type": "video_url", "video_url": {"url": url}, "role": video.get("role", "reference_video")})
    return {
        "model": model,
        "content": content,
        "generate_audio": bool(need_audio),
        "ratio": ratio,
        "duration": int(duration),
        "resolution": _normalize_resolution(resolution),
        "watermark": False,
        "return_last_frame": True,
    }


def extract_ark_task_id(payload: dict) -> str:
    task_id = payload.get("id") or (payload.get("data") or {}).get("id")
    if not task_id:
        raise ModelServiceError(
            PROVIDER_REJECTED,
            "Ark response missing task id",
            retryable=True,
            provider="ark",
        )
    return str(task_id)


def extract_ark_task_result(payload: dict) -> dict:
    status = str(payload.get("status", "UNKNOWN")).upper()
    content = payload.get("content") or {}
    video_url = None
    if isinstance(content, dict):
        video_url_value = content.get("video_url")
        if isinstance(video_url_value, dict):
            video_url = video_url_value.get("url")
        elif isinstance(video_url_value, str):
            video_url = video_url_value
    artifacts = []
    if video_url:
        artifacts.append({"kind": "video", "uri": video_url, "remoteUrl": video_url, "mimeType": "video/mp4"})
    return {
        "taskId": str(payload.get("id", "")),
        "status": status,
        "artifacts": artifacts,
        "raw": payload,
    }


def map_http_error(status_code: int, raw: str) -> ModelServiceError:
    return map_provider_http_error(provider="ark", status_code=status_code, raw=raw)


class UrllibTransport(JsonHttpTransport):
    def __init__(self) -> None:
        super().__init__(provider="ark", timeout_message="Ark request timed out", bad_json_message="Ark returned non-JSON")


class ArkVideoProvider:
    def __init__(self, api_key: str, base_url: str, model: str, transport=None) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.transport = transport or UrllibTransport()

    def submit_video(self, *, prompt: str, options: dict) -> ProviderVideoTask:
        body = build_ark_video_task_body(
            model=self.model,
            prompt=prompt,
            reference_images=options.get("referenceImages"),
            reference_videos=options.get("referenceVideos"),
            duration=int(options.get("duration", 6)),
            ratio=options.get("ratio", "16:9"),
            resolution=options.get("resolution") or options.get("quality", "720p"),
            need_audio=bool(options.get("needAudio", True)),
        )
        payload = self.transport.post_json(
            f"{self.base_url}/contents/generations/tasks",
            body,
            headers=self._headers(),
            timeout=int(options.get("timeoutSeconds", 180)),
        )
        return ProviderVideoTask(task_id=extract_ark_task_id(payload), model=self.model, raw=payload)

    def poll_video(self, *, task_id: str, options: dict) -> ProviderVideoTaskResult:
        payload = self.transport.get_json(
            f"{self.base_url}/contents/generations/tasks/{urllib.parse.quote(task_id)}",
            headers=self._headers(),
            timeout=int(options.get("timeoutSeconds", 60)),
        )
        result = extract_ark_task_result(payload)
        return ProviderVideoTaskResult(
            task_id=result["taskId"] or task_id,
            status=result["status"],
            artifacts=result["artifacts"],
            model=self.model,
            raw=result["raw"],
        )

    def _headers(self) -> dict:
        return {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }


def _normalize_resolution(resolution: str) -> str:
    resolution_text = str(resolution or "720p").strip().lower()
    if resolution_text == "standard":
        return "720p"
    if resolution_text.endswith("p") and resolution_text[:-1].isdigit():
        return resolution_text
    if resolution_text.isdigit():
        return f"{resolution_text}p"
    raise ModelServiceError(
        INVALID_REQUEST,
        f"Invalid Ark video resolution: {resolution}",
        retryable=False,
        provider="ark",
    )
