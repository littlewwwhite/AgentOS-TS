#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: asset review prompt fragments and local image paths
# output: normalized JSON review data returned by aos-cli vision.review
# pos: model boundary adapter for asset-gen multimodal review

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any


_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_envelope import extract_json, run_envelope


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
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "vision.review",
        "modelPolicy": {"model": model},
        "input": {"content": _contents_to_model_content(contents)},
        "output": {"kind": "json"},
    }
    envelope = run_envelope(
        request,
        cwd=cwd,
        expected_kind="json",
        tmp_prefix="asset-gen-review-aos-cli-",
    )
    data = extract_json(envelope)
    if not isinstance(data, dict):
        raise RuntimeError("aos-cli review output must decode to an object")
    return data


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
