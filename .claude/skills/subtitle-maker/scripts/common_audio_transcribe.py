#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: ASR prompt and local audio/video path
# output: normalized subtitle segments returned by aos-cli audio.transcribe
# pos: model boundary adapter for subtitle-maker transcription

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
    request = _build_request(
        media_path,
        prompt,
        task=task,
        model=model or DEFAULT_MODEL,
        language=language,
        options=options or {},
    )
    working_dir = cwd or Path.cwd()
    with tempfile.TemporaryDirectory(prefix="subtitle-transcribe-aos-cli-") as tmp:
        tmp_dir = Path(tmp)
        request_path = tmp_dir / "request.json"
        response_path = tmp_dir / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=working_dir)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        if not response_path.exists():
            raise RuntimeError("aos-cli did not write an audio transcription response envelope")
        if raw_output_dir is not None:
            _save_raw_response(response_path, raw_output_dir)
        return _read_segments_output(response_path)


def _build_request(
    media_path: str | Path,
    prompt: str,
    *,
    task: str,
    model: str,
    language: str | None,
    options: dict[str, Any],
) -> dict[str, Any]:
    input_payload: dict[str, Any] = {
        "prompt": prompt,
        "audio": _media_uri(media_path),
    }
    if language:
        input_payload["language"] = language
    return {
        "apiVersion": "aos-cli.model/v1",
        "task": task,
        "capability": "audio.transcribe",
        "modelPolicy": {"model": model},
        "input": input_payload,
        "output": {"kind": "json"},
        "options": options,
    }


def _media_uri(media_path: str | Path) -> str:
    path = Path(media_path)
    if not path.exists():
        raise FileNotFoundError(f"Missing audio or video input: {path}")
    return path.resolve().as_uri()


def _save_raw_response(response_path: Path, raw_output_dir: Path) -> None:
    raw_output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%m%d%H%M")
    raw_path = raw_output_dir / f"aos-cli-audio-transcribe-raw-{ts}.json"
    raw_path.write_text(response_path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"OK aos-cli 原始输出已保存: {raw_path}")


def _read_segments_output(response_path: Path) -> list[dict[str, Any]]:
    try:
        response = json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli audio transcription response envelope: {response_path}") from exc

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli audio transcription failed")

    output = response.get("output") or {}
    if output.get("kind") != "json":
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected json, got {output.get('kind')}")

    data: Any
    if "data" in output:
        data = output["data"]
    elif "text" in output:
        data = _parse_json_text(str(output["text"]))
    else:
        raise RuntimeError("aos-cli audio transcription response missing output.data")

    if isinstance(data, list):
        segments = data
    elif isinstance(data, dict) and isinstance(data.get("segments"), list):
        segments = data["segments"]
    else:
        raise RuntimeError("aos-cli audio transcription output must contain a segments list")
    return [_normalize_segment(segment) for segment in segments]


def _parse_json_text(raw: str) -> Any:
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    return json.loads(text)


def _normalize_segment(segment: Any) -> dict[str, Any]:
    if not isinstance(segment, dict):
        raise RuntimeError("aos-cli audio transcription segment must be an object")
    for key in ("start", "end", "text"):
        if key not in segment:
            raise RuntimeError(f"aos-cli audio transcription segment missing {key}")
    normalized = dict(segment)
    normalized.setdefault("speaker", "")
    return normalized
