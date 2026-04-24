#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: Ark video model config, prompts, reference URLs, and task ids
# output: submitted Ark tasks, normalized poll results, and downloaded videos
# pos: provider adapter boundary for video-gen runtime

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Dict, List, Optional

from config_loader import get_generation_config, get_video_model_config

_vm_cfg = get_video_model_config()
_gen_cfg = get_generation_config()

ACTIVE_VIDEO_PROVIDER = _vm_cfg.get("provider", "volcengine_ark")
PROVIDERS = _vm_cfg.get("providers", {})
VIDEO_MODEL_CONFIG = {
    name: {
        "provider": cfg.get("provider", ACTIVE_VIDEO_PROVIDER),
        "model_code": cfg["model_code"],
        "model_group_code": cfg.get("model_group_code", ""),
        "subject_reference": cfg.get("subject_reference", False),
    }
    for name, cfg in _vm_cfg.get("models", {}).items()
}
ACTIVE_VIDEO_MODEL = _vm_cfg.get("active_model", "seedance2")
DEFAULT_MODEL_CODE = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL]["model_code"]
DEFAULT_MODEL_GROUP_CODE = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL]["model_group_code"]
DEFAULT_SUBJECT_REFERENCE = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL]["subject_reference"]
DEFAULT_PROVIDER = VIDEO_MODEL_CONFIG[ACTIVE_VIDEO_MODEL].get("provider", ACTIVE_VIDEO_PROVIDER)
TERMINAL_STATUSES = {"SUCCESS", "FAIL", "FAILED"}


def get_subject_reference_for_model(model_code: str) -> bool:
    for cfg in VIDEO_MODEL_CONFIG.values():
        if cfg["model_code"] == model_code:
            return bool(cfg["subject_reference"])
    return bool(DEFAULT_SUBJECT_REFERENCE)


def get_provider_for_model(model_code: str = None) -> str:
    for cfg in VIDEO_MODEL_CONFIG.values():
        if cfg["model_code"] == model_code:
            return cfg.get("provider", DEFAULT_PROVIDER)
    return DEFAULT_PROVIDER


def _provider_config(provider: str) -> Dict:
    return PROVIDERS.get(provider, {})


def _quality_to_resolution(quality: str) -> str:
    quality_text = str(quality or "720").strip().lower()
    return quality_text if quality_text.endswith("p") else f"{quality_text}p"


def _parse_duration_seconds(duration: str) -> int:
    try:
        return int(float(duration))
    except (TypeError, ValueError):
        return 6


def _public_url(url: str) -> str:
    if not url:
        return url
    if url.startswith(("http://", "https://", "data:")):
        return url
    raise RuntimeError(f"reference URL must be public http(s), got: {url}")


def _ark_content_item_for_image(url: str, role: Optional[str] = None) -> Dict:
    item = {"type": "image_url", "image_url": {"url": _public_url(url)}}
    if role:
        item["role"] = role
    return item


def _ark_content_item_for_video(url: str, role: str = "reference_video") -> Dict:
    return {"type": "video_url", "video_url": {"url": _public_url(url)}, "role": role}


def build_ark_video_task_body(
    model_code: str,
    prompt: str,
    reference_images: List[Dict] = None,
    duration: str = "6",
    quality: str = "720",
    ratio: str = "16:9",
    need_audio: bool = True,
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    reference_videos: List[Dict] = None,
    return_last_frame: bool = True,
) -> Dict:
    content = [{"type": "text", "text": prompt}]
    first_frame_seen = False

    for image in reference_images or []:
        url = image.get("url")
        if not url:
            continue
        role = "first_frame" if image.get("name") == "lsi" else "reference_image"
        if role == "first_frame":
            first_frame_seen = True
        content.append(_ark_content_item_for_image(url, role))

    if first_frame_url and not first_frame_seen:
        content.append(_ark_content_item_for_image(first_frame_url, "first_frame"))

    for video in reference_videos or []:
        url = video.get("url")
        if url:
            content.append(_ark_content_item_for_video(url))

    return {
        "model": model_code,
        "content": content,
        "generate_audio": bool(need_audio),
        "ratio": ratio,
        "duration": _parse_duration_seconds(duration),
        "resolution": _quality_to_resolution(quality),
        "watermark": False,
        "return_last_frame": bool(return_last_frame),
    }


def _ark_api_key(provider_cfg: Dict) -> str:
    api_key_env = provider_cfg.get("api_key_env", "ARK_API_KEY")
    api_key = os.environ.get(api_key_env, "")
    if not api_key:
        raise RuntimeError(f"missing env: {api_key_env}")
    return api_key


def ark_request(path: str, data: bytes = None, method: str = "GET") -> Dict:
    provider_cfg = _provider_config("volcengine_ark")
    base_url = provider_cfg.get("base_url", "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    url = f"{base_url}/{path.lstrip('/')}"
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {_ark_api_key(provider_cfg)}",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Ark API failed HTTP {exc.code}: {exc.read().decode()}") from exc


def submit_ark_video_task(
    model_code: str,
    prompt: str,
    reference_images: List[Dict] = None,
    duration: str = "6",
    quality: str = "720",
    ratio: str = "16:9",
    need_audio: bool = True,
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    reference_videos: List[Dict] = None,
) -> str:
    body = build_ark_video_task_body(
        model_code=model_code,
        prompt=prompt,
        reference_images=reference_images,
        duration=duration,
        quality=quality,
        ratio=ratio,
        need_audio=need_audio,
        first_frame_url=first_frame_url,
        first_frame_text=first_frame_text,
        reference_videos=reference_videos,
    )
    response = ark_request(
        "contents/generations/tasks",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
    )
    task_id = response.get("id")
    if not task_id:
        raise RuntimeError(f"Ark response missing task id: {response}")
    return str(task_id)


def poll_ark_video_task(task_id: str) -> Dict:
    return ark_request(f"contents/generations/tasks/{urllib.parse.quote(task_id)}")


def _extract_ark_video_url(data: Dict) -> Optional[str]:
    content = data.get("content") or {}
    if isinstance(content, dict):
        video_url = content.get("video_url")
        if isinstance(video_url, dict):
            return video_url.get("url")
        return video_url
    return None


def _normalize_ark_poll_result(data: Dict) -> Dict:
    normalized = deepcopy(data)
    video_url = _extract_ark_video_url(data)
    normalized["taskStatus"] = {
        "succeeded": "SUCCESS",
        "failed": "FAILED",
        "expired": "FAILED",
    }.get(str(data.get("status", "")).lower(), str(data.get("status", "UNKNOWN")).upper())
    if video_url:
        normalized["resultFileList"] = [video_url]
        normalized["resultFileDisplayList"] = [video_url]
    if data.get("error"):
        normalized["errorMsg"] = data.get("error")
    return normalized


def upload_to_cos(file_path: str, scene_type: str = "first_frame") -> Optional[str]:
    print(f"[WARN] local upload disabled; public URL required for {file_path}", file=sys.stderr)
    return None


def _cos_relative_url(full_url: str) -> str:
    return full_url


def build_subject_prompt_params(subjects: List[Dict], duration: str = "5", ratio: str = "16:9", quality: str = "720") -> Dict:
    raise RuntimeError("subject reference mode is not supported by the active provider")


def build_image_reference_params(
    reference_images: List[Dict],
    duration: str = "5",
    ratio: str = "16:9",
    quality: str = "720",
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    reference_videos: List[Dict] = None,
) -> Dict:
    return {
        "reference_images": reference_images or [],
        "reference_videos": reference_videos or [],
        "first_frame_url": first_frame_url,
        "first_frame_text": first_frame_text,
        "duration": duration,
        "ratio": ratio,
        "quality": quality,
    }


def download_video(url: str, output_path: str) -> str:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "AgentOS-TS/video-gen"})
    with urllib.request.urlopen(request, timeout=600) as response:
        output.write_bytes(response.read())
    return str(output)


def submit_video(
    prompt: str,
    model_code: str = DEFAULT_MODEL_CODE,
    subjects: List[Dict] = None,
    reference_images: List[Dict] = None,
    duration: str = "5",
    quality: str = "720",
    ratio: str = "16:9",
    need_audio: bool = True,
    first_frame_url: Optional[str] = None,
    first_frame_text: Optional[str] = None,
    reference_videos: List[Dict] = None,
) -> Dict:
    try:
        provider = get_provider_for_model(model_code)
        if provider != "volcengine_ark":
            raise RuntimeError(f"unsupported provider: {provider}")
        if subjects:
            raise RuntimeError("subject references are not supported; use public image/video URLs")
        task_id = submit_ark_video_task(
            model_code=model_code,
            prompt=prompt,
            reference_images=reference_images or [],
            duration=duration,
            quality=quality,
            ratio=ratio,
            need_audio=need_audio,
            first_frame_url=first_frame_url,
            first_frame_text=first_frame_text,
            reference_videos=reference_videos or [],
        )
        return {
            "success": True,
            "task_id": task_id,
            "message": "submitted",
            "provider": provider,
            "model_code": model_code,
        }
    except Exception as exc:
        return {"success": False, "task_id": None, "message": str(exc)}


def create_video(
    prompt: str,
    output_path: str,
    model_code: str = DEFAULT_MODEL_CODE,
    subjects: List[Dict] = None,
    reference_images: List[Dict] = None,
    duration: str = "5",
    quality: str = "720",
    ratio: str = "16:9",
    need_audio: bool = True,
) -> Dict:
    submit_result = submit_video(
        prompt=prompt,
        model_code=model_code,
        subjects=subjects,
        reference_images=reference_images,
        duration=duration,
        quality=quality,
        ratio=ratio,
        need_audio=need_audio,
    )
    if not submit_result["success"]:
        return submit_result
    poll_result = poll_multiple_tasks(
        [{"task_id": submit_result["task_id"], "output_path": output_path, "provider": submit_result["provider"], "model_code": model_code}],
        interval=_gen_cfg.get("poll_interval", 10),
        timeout=_gen_cfg.get("poll_timeout", 1830),
    )[0]
    return poll_result


def poll_multiple_tasks(
    tasks: List[Dict],
    interval: int = 10,
    timeout: int = 1830,
    on_complete: callable = None,
) -> List[Dict]:
    start = time.time()
    pending = {task["task_id"]: dict(task, success=None) for task in tasks if task.get("task_id")}
    finished: dict[str, Dict] = {}

    while pending:
        if time.time() - start > timeout:
            for task_id, info in pending.items():
                info.update(success=False, message=f"poll timeout ({timeout}s)", video_url=None, video_path=None)
                finished[task_id] = info
            pending.clear()
            break

        for task_id in list(pending.keys()):
            info = pending[task_id]
            try:
                data = _normalize_ark_poll_result(poll_ark_video_task(task_id))
                status = data.get("taskStatus", "UNKNOWN")
                if status == "SUCCESS":
                    video_url = (data.get("resultFileList") or [None])[0]
                    video_path = None
                    if video_url and info.get("output_path"):
                        video_path = download_video(video_url, info["output_path"])
                    content = data.get("content") or {}
                    info.update(
                        success=True,
                        message="completed",
                        video_url=video_url,
                        video_path=video_path,
                        result_data=data,
                        last_frame_url=content.get("last_frame_url") if isinstance(content, dict) else None,
                    )
                    finished[task_id] = info
                    pending.pop(task_id, None)
                    if on_complete:
                        on_complete(info)
                elif status in {"FAIL", "FAILED"}:
                    info.update(success=False, message=data.get("errorMsg", "failed"), video_url=None, video_path=None, result_data=data)
                    finished[task_id] = info
                    pending.pop(task_id, None)
            except Exception as exc:
                info.update(success=False, message=str(exc), video_url=None, video_path=None)
                finished[task_id] = info
                pending.pop(task_id, None)

        if pending:
            time.sleep(interval)

    return [finished.get(task.get("task_id"), dict(task, success=False, message="not submitted")) for task in tasks]


if __name__ == "__main__":
    print(json.dumps({"default_model": DEFAULT_MODEL_CODE, "provider": DEFAULT_PROVIDER}, ensure_ascii=False))
