#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video analysis prompt and local video paths
# output: normalized JSON analysis data returned by aos-cli video.analyze
# pos: model boundary adapter for video-editing multimodal analysis

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any


_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


DEFAULT_MODEL = os.environ.get("VIDEO_ANALYZE_MODEL") or "gemini-3.1-pro-preview"


def call_video_analyze(
    video_paths: list[str | Path],
    prompt: str,
    *,
    task: str = "video-editing.phase1.analyze",
    model: str | None = None,
    options: dict[str, Any] | None = None,
    cwd: Path | None = None,
    raw_output_dir: Path | None = None,
) -> dict[str, Any]:
    request = _build_request(video_paths, prompt, task=task, model=model or DEFAULT_MODEL, options=options or {})
    working_dir = cwd or Path.cwd()
    with tempfile.TemporaryDirectory(prefix="video-editing-analyze-aos-cli-") as tmp:
        tmp_dir = Path(tmp)
        request_path = tmp_dir / "request.json"
        response_path = tmp_dir / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=working_dir)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        if not response_path.exists():
            raise RuntimeError("aos-cli did not write a video analysis response envelope")
        if raw_output_dir is not None:
            _save_raw_response(response_path, raw_output_dir)
        return _read_json_output(response_path)


def _build_request(
    video_paths: list[str | Path],
    prompt: str,
    *,
    task: str,
    model: str,
    options: dict[str, Any],
) -> dict[str, Any]:
    return {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "video.analyze",
        "modelPolicy": {"model": model},
        "input": {"content": {"prompt": prompt, "videos": _video_uris(video_paths)}},
        "output": {"kind": "json"},
        "options": options,
    }


def _video_uris(video_paths: list[str | Path]) -> list[str]:
    uris: list[str] = []
    for raw_path in video_paths:
        path = Path(raw_path)
        if not path.exists():
            raise FileNotFoundError(f"Missing video input: {path}")
        uris.append(path.resolve().as_uri())
    return uris


def _save_raw_response(response_path: Path, raw_output_dir: Path) -> None:
    raw_output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    raw_path = raw_output_dir / f"aos-cli-video-analyze-raw-{ts}.json"
    raw_path.write_text(response_path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"  原始输出已保存: {raw_path}")


def _read_json_output(response_path: Path) -> dict[str, Any]:
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli video analysis response envelope: {response_path}") from exc

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli video analysis failed")

    output = response.get("output") or {}
    if output.get("kind") != "json":
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected json, got {output.get('kind')}")
    if "data" in output:
        data = output["data"]
        if not isinstance(data, dict):
            raise RuntimeError("aos-cli video analysis output.data must be an object")
        return data
    if "text" in output:
        return _parse_json_text(str(output["text"]))
    raise RuntimeError("aos-cli video analysis response missing output.data")


def _parse_json_text(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise RuntimeError("aos-cli video analysis JSON text must decode to an object")
    return data
