#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video generation prompts and async task envelopes
# output: normalized aos-cli video task and task_result envelopes
# pos: video model boundary adapter for video-gen skill

from __future__ import annotations

import json
import os
import sys
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

from aos_cli_envelope import poll_envelope, submit_envelope  # noqa: E402

_vm_cfg = get_video_model_config()
_gen_cfg = get_generation_config()

_active_model = _vm_cfg.get("active_model", "seedance2")
DEFAULT_MODEL_CODE = _vm_cfg.get("models", {}).get(_active_model, {}).get(
    "model_code", "ep-20260303234827-tfnzm"
)


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
    """Normalize boundary contract for Ark referenceImages[].

    Each entry must carry an explicit `role` (Ark rejects the request otherwise).
    Fail-fast at the boundary so missing role never silently survives downstream.
    """
    normalized: List[Dict[str, Any]] = []
    for image in reference_images or []:
        url = image.get("url")
        if not url:
            continue
        role = image.get("role")
        if not role:
            raise ValueError(
                "reference image missing required 'role' field "
                f"(name={image.get('name')!r}, url={url[:60]!r})"
            )
        entry: Dict[str, Any] = {"url": _public_url(url), "role": role}
        name = image.get("name")
        if name:
            entry["name"] = name
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

    return submit_envelope(request, cwd=project_dir, tmp_prefix="video-submit-aos-cli-")


def poll_video_generation(
    *,
    task_envelope: Dict[str, Any],
    project_dir: str | Path,
) -> Dict[str, Any]:
    """Poll a previously-submitted aos-cli video task for its task_result."""

    return poll_envelope(task_envelope, cwd=project_dir, tmp_prefix="video-poll-aos-cli-")


def upload_to_cos(file_path: str, scene_type: str = "first_frame") -> Optional[str]:
    print(f"[WARN] local upload disabled; public URL required for {file_path}", file=sys.stderr)
    return None


def _cos_relative_url(full_url: str) -> str:
    return full_url


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
    reference_images: List[Dict] = None,
    duration: str = "5",
    quality: str = "720",
    ratio: str = "16:9",
    first_frame_url: Optional[str] = None,
) -> Dict[str, Any]:
    try:
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
            "model_code": envelope.get("model") or model_code,
            "task_envelope": envelope,
        }
    except Exception as exc:
        return {"success": False, "task_id": None, "message": str(exc)}


def create_video(
    prompt: str,
    output_path: str,
    model_code: str = DEFAULT_MODEL_CODE,
    reference_images: List[Dict] = None,
    duration: str = "5",
    quality: str = "720",
    ratio: str = "16:9",
) -> Dict:
    submit_result = submit_video(
        prompt=prompt,
        model_code=model_code,
        reference_images=reference_images,
        duration=duration,
        quality=quality,
        ratio=ratio,
    )
    if not submit_result["success"]:
        return submit_result
    poll_result = poll_multiple_tasks(
        [{
            "task_id": submit_result["task_id"],
            "task_envelope": submit_result.get("task_envelope"),
            "output_path": output_path,
            "model_code": model_code,
        }],
        interval=_gen_cfg.get("poll_interval", 10),
        timeout=_gen_cfg.get("poll_timeout", 1830),
    )[0]
    return poll_result


def _extract_video_artifact(envelope: Dict[str, Any]) -> Dict[str, Any]:
    artifacts = envelope.get("output", {}).get("artifacts", []) or []
    return next((a for a in artifacts if a.get("kind") == "video"), {})


def _extract_actual_duration_seconds(artifact: Dict[str, Any]) -> Optional[float]:
    for key in ("actualDurationSeconds", "durationSeconds", "duration"):
        value = artifact.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    metadata = artifact.get("metadata") or {}
    for key in ("actualDurationSeconds", "durationSeconds", "duration"):
        value = metadata.get(key)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


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
                    actual_duration_seconds = _extract_actual_duration_seconds(artifact)
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
                        actual_duration_seconds=actual_duration_seconds,
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
    print(json.dumps({"default_model": DEFAULT_MODEL_CODE}, ensure_ascii=False))
