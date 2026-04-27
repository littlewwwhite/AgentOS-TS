#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: video analysis prompt and local video paths
# output: normalized JSON analysis data returned by aos-cli video.analyze
# pos: model boundary adapter for video-editing multimodal analysis

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_envelope import extract_json, run_envelope


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
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "video.analyze",
        "modelPolicy": {"model": model or DEFAULT_MODEL},
        "input": {"content": {"prompt": prompt, "videos": _video_uris(video_paths)}},
        "output": {"kind": "json"},
        "options": options or {},
    }
    envelope = run_envelope(
        request,
        cwd=cwd or Path.cwd(),
        expected_kind="json",
        tmp_prefix="video-editing-analyze-aos-cli-",
    )
    if raw_output_dir is not None:
        _save_raw_response(envelope, raw_output_dir)
    data = extract_json(envelope)
    if not isinstance(data, dict):
        raise RuntimeError("aos-cli video analysis output must decode to an object")
    return data


def _video_uris(video_paths: list[str | Path]) -> list[str]:
    uris: list[str] = []
    for raw_path in video_paths:
        path = Path(raw_path)
        if not path.exists():
            raise FileNotFoundError(f"Missing video input: {path}")
        uris.append(path.resolve().as_uri())
    return uris


def _save_raw_response(envelope: dict[str, Any], raw_output_dir: Path) -> None:
    import json

    raw_output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    raw_path = raw_output_dir / f"aos-cli-video-analyze-raw-{ts}.json"
    raw_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  原始输出已保存: {raw_path}")
