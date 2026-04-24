#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: prompt text, optional reference image URLs, and OpenAI-compatible image env vars
# output: image URLs downloaded into local asset files
# pos: provider boundary for asset-gen image generation

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


DEFAULT_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
DEFAULT_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.chatfire.cn").rstrip("/")
_TASKS: dict[str, dict[str, Any]] = {}


class InsufficientCreditsError(Exception):
    """Provider quota is exhausted or billing blocks generation."""


def _endpoint() -> str:
    base_url = DEFAULT_BASE_URL
    if base_url.endswith("/v1"):
        return f"{base_url}/images/generations"
    return f"{base_url}/v1/images/generations"


def _api_key() -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for asset image generation")
    return api_key


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


def _reference_images(params: dict[str, Any]) -> str | list[str] | None:
    image = params.get("image") or params.get("iref")
    if not image:
        return None
    if isinstance(image, str):
        return image
    if isinstance(image, list):
        return [str(item) for item in image if str(item).startswith(("http://", "https://"))]
    return None


def _post_generation(prompt: str, params: dict[str, Any], model: str) -> list[str]:
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "size": _size_from_params(params),
    }
    image = _reference_images(params)
    if image:
        body["image"] = image

    request = urllib.request.Request(
        _endpoint(),
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {_api_key()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_text = exc.read().decode("utf-8", errors="replace")
        if exc.code in {402, 429}:
            raise InsufficientCreditsError(error_text) from exc
        raise RuntimeError(f"ChatFire image generation failed HTTP {exc.code}: {error_text}") from exc

    urls = [
        item.get("url")
        for item in payload.get("data", [])
        if isinstance(item, dict) and item.get("url")
    ]
    if not urls:
        raise RuntimeError(f"ChatFire image response missing data[].url: {payload}")
    return urls


def submit_image_task(prompt, params, model_code=DEFAULT_MODEL, max_retries=3, model_group_code=None):
    """Submit an image request and return a local task id.

    ChatFire image generation is synchronous, while existing asset scripts expect a
    submit/poll interface. This adapter stores the returned URLs in memory and
    marks the synthetic task as immediately successful.
    """
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            urls = _post_generation(prompt, params or {}, model_code or DEFAULT_MODEL)
            task_id = f"chatfire-{uuid.uuid4().hex}"
            _TASKS[task_id] = {
                "status": "SUCCESS",
                "result_urls": urls,
                "display_urls": urls,
                "created_at": time.time(),
            }
            print(f"  ✓ ChatFire image generated: {task_id}", flush=True)
            return task_id
        except InsufficientCreditsError:
            raise
        except Exception as exc:
            last_error = exc
            print(f"  ⚠ ChatFire image generation failed ({attempt}/{max_retries}): {exc}", flush=True)
            if attempt < max_retries:
                time.sleep(2)

    print(f"  ❌ ChatFire image generation failed after {max_retries} retries: {last_error}", flush=True)
    return None


def poll_image_task(task_id, timeout=600, label=""):
    task = _TASKS.get(task_id)
    if not task:
        return None
    if task["status"] == "SUCCESS":
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
        "error_msg": task.get("error_msg", ""),
        "queue_num": 0,
    }


def download_image(url, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "AgentOS-TS/asset-gen"})
        with urllib.request.urlopen(request, timeout=120) as response:
            output_path.write_bytes(response.read())
        if output_path.exists() and output_path.stat().st_size > 0:
            print(f"  ✓ downloaded: {output_path.name} ({output_path.stat().st_size // 1024}KB)", flush=True)
            return str(output_path)
    except Exception as exc:
        print(f"  ❌ image download failed: {exc}", flush=True)
    return None
