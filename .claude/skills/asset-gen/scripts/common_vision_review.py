#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: asset review prompt fragments and local image paths
# output: normalized JSON review data returned by aos-cli vision.review
# pos: model boundary adapter for asset-gen multimodal review

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


DEFAULT_MODEL = os.environ.get("ASSET_REVIEW_MODEL") or "gemini-3.1-pro-preview"


def load_image_part(img_path: str) -> tuple[dict[str, str] | None, str | None]:
    if not img_path or not Path(img_path).exists():
        return None, f"[image not found: {img_path}]"
    return {"kind": "image", "uri": Path(img_path).resolve().as_uri()}, None


def call_vision_review(
    contents: list[Any],
    *,
    task: str = "asset.review",
    models: list[str] | None = None,
    max_retries: int = 3,
    retry_sleep_seconds: int = 2,
    cwd: Path | None = None,
) -> dict[str, Any] | None:
    models_to_try = models or [DEFAULT_MODEL]
    working_dir = cwd or Path.cwd()

    for model in models_to_try:
        for attempt in range(max_retries):
            try:
                return _run_review_once(contents, task=task, model=model, cwd=working_dir)
            except Exception as exc:
                print(f"{model} review attempt {attempt + 1} failed: {exc}", file=sys.stderr)
                if attempt == 0:
                    time.sleep(retry_sleep_seconds)
    return None


def _run_review_once(contents: list[Any], *, task: str, model: str, cwd: Path) -> dict[str, Any]:
    request = _build_request(contents, task=task, model=model)
    with tempfile.TemporaryDirectory(prefix="asset-gen-review-aos-cli-") as tmp:
        tmp_dir = Path(tmp)
        request_path = tmp_dir / "request.json"
        response_path = tmp_dir / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=cwd)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        if not response_path.exists():
            raise RuntimeError("aos-cli did not write a review response envelope")
        return _read_json_output(response_path)


def _build_request(contents: list[Any], *, task: str, model: str) -> dict[str, Any]:
    content = _contents_to_model_content(contents)
    return {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "vision.review",
        "modelPolicy": {"model": model},
        "input": {"content": content},
        "output": {"kind": "json"},
    }


def _contents_to_model_content(contents: list[Any]) -> dict[str, Any]:
    prompt_parts: list[str] = []
    images: list[str] = []

    for item in contents:
        if isinstance(item, dict) and item.get("kind") == "image" and item.get("uri"):
            images.append(str(item["uri"]))
        elif isinstance(item, str):
            prompt_parts.append(item)
        else:
            prompt_parts.append(json.dumps(item, ensure_ascii=False))

    return {
        "prompt": "\n".join(part for part in prompt_parts if part),
        "images": images,
    }


def _read_json_output(response_path: Path) -> dict[str, Any]:
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli review response envelope: {response_path}") from exc

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli vision review failed")

    output = response.get("output") or {}
    if output.get("kind") != "json":
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected json, got {output.get('kind')}")
    if "data" in output:
        data = output["data"]
        if not isinstance(data, dict):
            raise RuntimeError("aos-cli review output.data must be an object")
        return data
    if "text" in output:
        return _parse_json_text(str(output["text"]))
    raise RuntimeError("aos-cli review response missing output.data")


def _parse_json_text(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise RuntimeError("aos-cli review JSON text must decode to an object")
    return data
