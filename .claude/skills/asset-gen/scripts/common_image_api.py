#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: prompt text, optional reference image URLs, and aos-cli model env vars
# output: image artifact URLs/paths exposed through the asset-gen submit/poll contract
# pos: model boundary adapter for asset-gen image generation

from __future__ import annotations

import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_envelope import extract_artifacts, run_envelope


DEFAULT_MODEL = (
    os.environ.get("ASSET_IMAGE_MODEL")
    or os.environ.get("OPENAI_IMAGE_MODEL")
    or "gpt-image-2"
)
_TASKS: dict[str, dict[str, Any]] = {}


class InsufficientCreditsError(Exception):
    """Provider quota is exhausted or billing blocks generation."""


def _size_from_params(params: dict[str, Any]) -> str:
    raw_size = str(params.get("size") or "").strip()
    if raw_size in {"1024x1024", "1536x1024", "1024x1536"}:
        return raw_size

    ratio = str(params.get("ratio") or "1:1").strip()
    if ratio in {"16:9", "3:2", "landscape"}:
        return "1536x1024"
    if ratio in {"9:16", "2:3", "portrait"}:
        return "1024x1536"
    return "1024x1024"


def _reference_images(params: dict[str, Any]) -> list[str]:
    image = params.get("image") or params.get("iref")
    if not image:
        return []
    if isinstance(image, str):
        return [image] if image.startswith(("http://", "https://", "file://")) else []
    if isinstance(image, list):
        return [str(item) for item in image if str(item).startswith(("http://", "https://", "file://"))]
    return []


def _resolve_local_dir(params: dict[str, Any], working_dir: Path) -> str:
    configured = params.get("local_dir") or params.get("output_dir")
    if configured:
        return str(Path(configured).resolve())
    return str((working_dir / "output" / "asset-gen-artifacts").resolve())


def _build_request(prompt: str, params: dict[str, Any], model: str, working_dir: Path) -> dict[str, Any]:
    options: dict[str, Any] = {
        "size": _size_from_params(params),
        "quality": params.get("quality", "2K"),
        "generateNum": int(str(params.get("generate_num") or params.get("n") or "1")),
    }
    references = _reference_images(params)
    if references:
        options["referenceImages"] = references

    request: dict[str, Any] = {
        "apiVersion": "aos-cli.model/v1",
        "task": str(params.get("task") or "asset.image.generate"),
        "capability": "image.generate",
        "output": {"kind": "artifact"},
        "input": {"prompt": prompt},
        "options": options,
        "artifactPolicy": {
            "download": True,
            "localDir": _resolve_local_dir(params, working_dir),
        },
    }
    role = params.get("role")
    if role:
        request["artifactPolicy"]["role"] = str(role)
    if model:
        request["modelPolicy"] = {"model": model}
    return request


def _artifact_uri_to_display_url(artifact: dict[str, Any]) -> str:
    remote_url = artifact.get("remoteUrl")
    if isinstance(remote_url, str) and remote_url:
        return remote_url
    uri = artifact.get("uri")
    if isinstance(uri, str) and uri:
        return uri
    raise RuntimeError(f"aos-cli image artifact missing uri: {artifact}")


def _post_generation(
    prompt: str,
    params: dict[str, Any],
    model: str,
    working_dir: Path | None = None,
) -> list[dict[str, Any]]:
    cwd = (working_dir or Path.cwd()).resolve()
    request = _build_request(prompt, params, model, cwd)
    envelope = run_envelope(
        request,
        cwd=cwd,
        expected_kind="artifact",
        tmp_prefix="asset-gen-image-aos-cli-",
        validate_ok=False,
    )
    if not envelope.get("ok"):
        error = envelope.get("error") or {}
        message = error.get("message") or "aos-cli image generation failed"
        if error.get("code") in {"RATE_LIMITED", "AUTH_ERROR"}:
            raise InsufficientCreditsError(message)
        raise RuntimeError(message)
    return extract_artifacts(envelope)


def submit_image_task(
    model_code: str,
    prompt: str,
    params: dict[str, Any] | None = None,
    max_retries: int = 3,
    *,
    project_dir: str | Path | None = None,
):
    """Submit an image request and return a local task id."""
    params = dict(params or {})
    working_dir = Path(project_dir or os.getcwd()).resolve()
    effective_model = (model_code or DEFAULT_MODEL or "").strip() or DEFAULT_MODEL

    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            artifacts = _post_generation(prompt, params, effective_model, working_dir)
            if not artifacts:
                raise RuntimeError("aos-cli image response contained no artifact objects")
            result_urls: list[str] = []
            display_urls: list[str] = []
            for artifact in artifacts:
                uri = artifact.get("uri")
                if not isinstance(uri, str) or not uri:
                    raise RuntimeError(f"aos-cli image artifact missing uri: {artifact}")
                result_urls.append(uri)
                display_urls.append(_artifact_uri_to_display_url(artifact))
            task_id = f"aos-cli-image-{uuid.uuid4().hex}"
            _TASKS[task_id] = {
                "status": "succeeded",
                "result_urls": result_urls,
                "display_urls": display_urls,
                "artifacts": artifacts,
                "created_at": time.time(),
            }
            print(f"  ✓ aos-cli image generated: {task_id}", flush=True)
            return task_id
        except InsufficientCreditsError:
            raise
        except Exception as exc:
            last_error = exc
            print(f"  ⚠ aos-cli image generation failed ({attempt}/{max_retries}): {exc}", flush=True)
            if attempt < max_retries:
                time.sleep(2)

    print(f"  ❌ aos-cli image generation failed after {max_retries} retries: {last_error}", flush=True)
    return None


def poll_image_task(task_id, timeout=600, label=""):
    task = _TASKS.get(task_id)
    if not task:
        return None
    if task["status"] == "succeeded":
        return {"result": task["result_urls"], "show": task["display_urls"]}
    return None


def check_task_once(task_id):
    task = _TASKS.get(task_id)
    if not task:
        return {"status": "ERROR", "error_msg": f"unknown task id: {task_id}"}
    return {
        "status": task["status"],
        "result_urls": task.get("result_urls", []),
        "display_urls": task.get("display_urls", []),
        "artifacts": task.get("artifacts", []),
        "error_msg": task.get("error_msg", ""),
        "queue_num": 0,
    }


def _copy_file_uri(uri: str, output_path: Path) -> str | None:
    parsed = urllib.parse.urlparse(uri)
    if parsed.scheme != "file":
        return None
    source_path = Path(urllib.parse.unquote(parsed.path))
    if not source_path.exists():
        return None
    shutil.copyfile(source_path, output_path)
    return str(output_path)


def download_image(url, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        copied = _copy_file_uri(str(url), output_path)
        if copied:
            print(f"  ✓ copied: {output_path.name} ({output_path.stat().st_size // 1024}KB)", flush=True)
            return copied
        request = urllib.request.Request(url, headers={"User-Agent": "AgentOS-TS/asset-gen"})
        with urllib.request.urlopen(request, timeout=120) as response:
            output_path.write_bytes(response.read())
        if output_path.exists() and output_path.stat().st_size > 0:
            print(f"  ✓ downloaded: {output_path.name} ({output_path.stat().st_size // 1024}KB)", flush=True)
            return str(output_path)
    except Exception as exc:
        print(f"  ❌ image download failed: {exc}", flush=True)
    return None
