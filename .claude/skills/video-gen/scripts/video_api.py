#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video generation prompts and async task envelopes
# output: normalized aos-cli video task and task_result envelopes
# pos: video model boundary adapter for video-gen skill

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from config_loader import get_generation_config, get_video_model_config

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_poll, aos_cli_model_submit  # noqa: E402

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


def _parse_duration_seconds(duration: Any) -> int:
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


def _normalize_reference_images(reference_images: Optional[List[Dict]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for image in reference_images or []:
        url = image.get("url")
        if not url:
            continue
        entry: Dict[str, Any] = {"url": _public_url(url)}
        name = image.get("name")
        if name:
            entry["name"] = name
        role = image.get("role")
        if role:
            entry["role"] = role
        normalized.append(entry)
    return normalized


def submit_video_generation(
    *,
    prompt: str,
    duration: Any,
    ratio: str,
    quality: str,
    project_dir: str | Path,
    task: str,
    reference_images: Optional[List[Dict[str, Any]]] = None,
    first_frame_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Submit a video generation request through the aos-cli model boundary."""

    input_payload: Dict[str, Any] = {
        "prompt": prompt,
        "duration": int(_parse_duration_seconds(duration)),
        "ratio": ratio,
        "quality": quality,
    }
    if reference_images:
        input_payload["referenceImages"] = reference_images
    if first_frame_url:
        input_payload["firstFrameUrl"] = _public_url(first_frame_url)

    request: Dict[str, Any] = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "video.generate",
        "output": {"kind": "task"},
        "input": input_payload,
    }
    model = os.environ.get("VIDEO_MODEL")
    if model:
        request["modelPolicy"] = {"model": model}

    with tempfile.TemporaryDirectory(prefix="video-submit-aos-cli-") as tmp:
        request_path = Path(tmp) / "request.json"
        task_path = Path(tmp) / "task.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
        completed = aos_cli_model_submit(request_path, task_path, cwd=project_dir)
        if completed.returncode != 0:
            raise RuntimeError(
                completed.stderr or f"aos-cli failed with exit code {completed.returncode}"
            )
        envelope = json.loads(task_path.read_text(encoding="utf-8"))

    if not envelope.get("ok"):
        error = envelope.get("error", {}) or {}
        raise RuntimeError(error.get("message") or "aos-cli video submit failed")
    return envelope


def poll_video_generation(
    *,
    task_envelope: Dict[str, Any],
    project_dir: str | Path,
) -> Dict[str, Any]:
    """Poll a previously-submitted aos-cli video task for its task_result."""

    with tempfile.TemporaryDirectory(prefix="video-poll-aos-cli-") as tmp:
        task_path = Path(tmp) / "task.json"
        result_path = Path(tmp) / "result.json"
        task_path.write_text(
            json.dumps(task_envelope, ensure_ascii=False), encoding="utf-8"
        )
        completed = aos_cli_model_poll(task_path, result_path, cwd=project_dir)
        if completed.returncode != 0:
            raise RuntimeError(
                completed.stderr or f"aos-cli failed with exit code {completed.returncode}"
            )
        envelope = json.loads(result_path.read_text(encoding="utf-8"))

    if not envelope.get("ok"):
        error = envelope.get("error", {}) or {}
        raise RuntimeError(error.get("message") or "aos-cli video poll failed")
    return envelope


def upload_to_cos(file_path: str, scene_type: str = "first_frame") -> Optional[str]:
    print(f"[WARN] local upload disabled; public URL required for {file_path}", file=sys.stderr)
    return None


def _cos_relative_url(full_url: str) -> str:
    return full_url


def build_subject_prompt_params(
    subjects: List[Dict], duration: str = "5", ratio: str = "16:9", quality: str = "720"
) -> Dict:
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
) -> Dict[str, Any]:
    try:
        if subjects:
            raise RuntimeError("subject references are not supported; use public image/video URLs")
        normalized_refs = _normalize_reference_images(reference_images)
        envelope = submit_video_generation(
            prompt=prompt,
            duration=duration,
            ratio=ratio,
            quality=quality,
            project_dir=Path.cwd(),
            task="video.generate",
            reference_images=normalized_refs or None,
            first_frame_url=first_frame_url,
        )
        output = envelope.get("output", {}) or {}
        return {
            "success": True,
            "task_id": output.get("taskId"),
            "message": "submitted",
            "provider": envelope.get("provider") or get_provider_for_model(model_code),
            "model_code": envelope.get("model") or model_code,
            "task_envelope": envelope,
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
        [{
            "task_id": submit_result["task_id"],
            "task_envelope": submit_result.get("task_envelope"),
            "output_path": output_path,
            "provider": submit_result["provider"],
            "model_code": model_code,
        }],
        interval=_gen_cfg.get("poll_interval", 10),
        timeout=_gen_cfg.get("poll_timeout", 1830),
    )[0]
    return poll_result


def _extract_video_artifact(envelope: Dict[str, Any]) -> Dict[str, Any]:
    artifacts = envelope.get("output", {}).get("artifacts", []) or []
    return next((a for a in artifacts if a.get("kind") == "video"), {})


def poll_multiple_tasks(
    tasks: List[Dict[str, Any]],
    interval: int = 10,
    timeout: int = 1830,
    on_complete: callable = None,
) -> List[Dict[str, Any]]:
    start = time.time()
    pending: Dict[str, Dict[str, Any]] = {}
    for task in tasks:
        task_id = task.get("task_id")
        if not task_id:
            continue
        pending[task_id] = dict(task, success=None)

    finished: Dict[str, Dict[str, Any]] = {}

    project_dir = Path.cwd()

    while pending:
        if time.time() - start > timeout:
            for task_id, info in pending.items():
                info.update(
                    success=False,
                    message=f"poll timeout ({timeout}s)",
                    video_url=None,
                    video_path=None,
                )
                finished[task_id] = info
            pending.clear()
            break

        for task_id in list(pending.keys()):
            info = pending[task_id]
            try:
                stored_envelope = info.get("task_envelope")
                if not stored_envelope:
                    raise RuntimeError(
                        f"task {task_id} missing task_envelope; cannot poll without aos-cli task envelope"
                    )
                envelope = poll_video_generation(
                    task_envelope=stored_envelope,
                    project_dir=project_dir,
                )
                output = envelope.get("output", {}) or {}
                kind = output.get("kind")
                if kind != "task_result":
                    # still pending, continue next iteration
                    continue
                status = str(output.get("status") or "UNKNOWN").upper()
                if status == "SUCCESS":
                    artifact = _extract_video_artifact(envelope)
                    video_url = artifact.get("uri") or artifact.get("remoteUrl")
                    last_frame_url = (
                        artifact.get("lastFrameUrl")
                        or artifact.get("last_frame_url")
                    )
                    video_path = None
                    if video_url and info.get("output_path"):
                        video_path = download_video(video_url, info["output_path"])
                    info.update(
                        success=True,
                        message="completed",
                        video_url=video_url,
                        video_path=video_path,
                        result_data=envelope,
                        last_frame_url=last_frame_url,
                    )
                    finished[task_id] = info
                    pending.pop(task_id, None)
                    if on_complete:
                        on_complete(info)
                elif status in {"FAIL", "FAILED"}:
                    error = envelope.get("error", {}) or {}
                    message = (
                        output.get("errorMsg")
                        or error.get("message")
                        or "failed"
                    )
                    info.update(
                        success=False,
                        message=message,
                        video_url=None,
                        video_path=None,
                        result_data=envelope,
                    )
                    finished[task_id] = info
                    pending.pop(task_id, None)
            except Exception as exc:
                info.update(
                    success=False,
                    message=str(exc),
                    video_url=None,
                    video_path=None,
                )
                finished[task_id] = info
                pending.pop(task_id, None)

        if pending:
            time.sleep(interval)

    return [
        finished.get(task.get("task_id"), dict(task, success=False, message="not submitted"))
        for task in tasks
    ]


if __name__ == "__main__":
    print(json.dumps({"default_model": DEFAULT_MODEL_CODE, "provider": DEFAULT_PROVIDER}, ensure_ascii=False))
