#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: ASR prompt and local audio/video path
# output: normalized subtitle segments returned by aos-cli audio.transcribe
# pos: model boundary adapter for subtitle-maker transcription

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


DEFAULT_MODEL = os.environ.get("ASR_MODEL") or os.environ.get("GEMINI_MODEL") or "gemini-3.1-pro-preview"


def call_audio_transcribe(
    media_path: str | Path,
    prompt: str,
    *,
    task: str = "subtitle-maker.phase2.transcribe",
    model: str | None = None,
    language: str | None = None,
    options: dict[str, Any] | None = None,
    cwd: Path | None = None,
    raw_output_dir: Path | None = None,
) -> list[dict[str, Any]]:
    input_payload: dict[str, Any] = {"prompt": prompt, "audio": _media_uri(media_path)}
    if language:
        input_payload["language"] = language
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "audio.transcribe",
        "modelPolicy": {"model": model or DEFAULT_MODEL},
        "input": input_payload,
        "output": {"kind": "json"},
        "options": options or {},
    }
    envelope = run_envelope(
        request,
        cwd=cwd or Path.cwd(),
        expected_kind="json",
        tmp_prefix="subtitle-transcribe-aos-cli-",
    )
    if raw_output_dir is not None:
        _save_raw_response(envelope, raw_output_dir)
    data = extract_json(envelope)
    return _coerce_segments(data)


def _media_uri(media_path: str | Path) -> str:
    path = Path(media_path)
    if not path.exists():
        raise FileNotFoundError(f"Missing audio or video input: {path}")
    return path.resolve().as_uri()


def _save_raw_response(envelope: dict[str, Any], raw_output_dir: Path) -> None:
    import json

    raw_output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    raw_path = raw_output_dir / f"aos-cli-audio-transcribe-raw-{ts}.json"
    raw_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK aos-cli 原始输出已保存: {raw_path}")


def _coerce_segments(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        segments = data
    elif isinstance(data, dict) and isinstance(data.get("segments"), list):
        segments = data["segments"]
    else:
        raise RuntimeError("aos-cli audio transcription output must contain a segments list")
    return [_normalize_segment(segment) for segment in segments]


def _normalize_segment(segment: Any) -> dict[str, Any]:
    if not isinstance(segment, dict):
        raise RuntimeError("aos-cli audio transcription segment must be an object")
    for key in ("start", "end", "text"):
        if key not in segment:
            raise RuntimeError(f"aos-cli audio transcription segment missing {key}")
    normalized = dict(segment)
    normalized.setdefault("speaker", "")
    return normalized
