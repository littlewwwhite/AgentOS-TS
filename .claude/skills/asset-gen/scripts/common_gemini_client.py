#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: asset-gen prompt/text/JSON requests
# output: aos-cli model envelopes returning normalized text/JSON
# pos: text model boundary adapter for asset-gen scripts
"""
common_gemini_client.py — aos-cli text/JSON adapter for asset-gen.

Despite the legacy module name, this file no longer talks to Gemini directly. It builds
`aos-cli.model/v1` envelopes with `capability=generate` and dispatches them through
`.claude/skills/_shared/aos_cli_model.py`. Provider routing, key resolution, and proxy
selection are owned by `aos-cli`.

Image+text review paths use `common_vision_review.py` and `vision.review`.
"""

from __future__ import annotations

import json
import logging
import os
import random
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from common_config import get_config

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_model import aos_cli_model_run


logger = logging.getLogger(__name__)


def _load_backend_config() -> dict:
    return get_config().get("gemini_backend", {})


def get_model(backend_config: dict | None = None) -> str:
    """Return the configured text/JSON model name (read by `_aos_cli_generate`)."""
    if backend_config is None:
        backend_config = _load_backend_config()
    return backend_config.get("model", "gemini-2.0-flash")


def _read_aos_cli_response(response_path: Path) -> dict:
    if not response_path.exists():
        return {}
    try:
        return json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid aos-cli response envelope: {response_path}") from exc


def _parse_json_text(text: str) -> Any:
    raw = (text or "").strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(raw)


def _aos_cli_generate(prompt: str, *, label: str, output_kind: str, model: str | None = None) -> Any:
    request = {
        "apiVersion": "aos-cli.model/v1",
        "task": label,
        "capability": "generate",
        "output": {"kind": output_kind},
        "input": {"content": prompt},
    }
    selected_model = model or get_model()
    if selected_model:
        request["modelPolicy"] = {"model": selected_model}

    with tempfile.TemporaryDirectory(prefix="asset-gen-aos-cli-") as tmp:
        request_path = Path(tmp) / "request.json"
        response_path = Path(tmp) / "response.json"
        request_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
        completed = aos_cli_model_run(request_path, response_path, cwd=Path.cwd())
        response = _read_aos_cli_response(response_path)

    if not response:
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or f"aos-cli failed with exit code {completed.returncode}")
        raise RuntimeError("aos-cli did not write a response envelope")

    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message") or "aos-cli model generation failed")

    output = response.get("output") or {}
    actual_kind = output.get("kind")
    if actual_kind != output_kind:
        raise RuntimeError(f"aos-cli response output.kind mismatch: expected {output_kind}, got {actual_kind}")

    if output_kind == "json":
        if "data" in output and output["data"] is not None:
            return output["data"]
        if isinstance(output.get("text"), str) and output["text"]:
            return _parse_json_text(output["text"])
        raise RuntimeError("aos-cli response missing output.data")
    if output_kind == "text":
        if isinstance(output.get("text"), str) and output["text"]:
            return output["text"].strip()
        raise RuntimeError("aos-cli response missing output.text")
    raise RuntimeError(f"Unsupported aos-cli output kind: {output_kind}")


def generate_text_with_retry(prompt, label="aos-cli text generation", max_retries=3, base_delay=2, model=None):
    for attempt in range(1, max_retries + 1):
        try:
            return _aos_cli_generate(prompt, label=label, output_kind="text", model=model)
        except Exception as exc:
            if attempt < max_retries:
                delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
                logger.warning("%s attempt %d failed: %s, retrying in %.1fs", label, attempt, exc, delay)
                time.sleep(delay)
            else:
                logger.error("%s failed after %d retries: %s", label, max_retries, exc)
                raise


def generate_json_with_retry(prompt, label="aos-cli JSON generation", max_retries=3, base_delay=2, model=None):
    for attempt in range(1, max_retries + 1):
        try:
            return _aos_cli_generate(prompt, label=label, output_kind="json", model=model)
        except Exception as exc:
            if attempt < max_retries:
                delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
                logger.warning("%s attempt %d failed: %s, retrying in %.1fs", label, attempt, exc, delay)
                time.sleep(delay)
            else:
                logger.error("%s failed after %d retries: %s", label, max_retries, exc)
                raise


def rewrite_prompt(prompt_text: str, max_retries: int = 3, base_delay: float = 2) -> str:
    return generate_text_with_retry(
        prompt_text,
        label="rewrite_prompt",
        max_retries=max_retries,
        base_delay=base_delay,
    ).strip("，。, ")


def generate_content_with_retry(prompt, label="aos-cli text generation", max_retries=3, base_delay=2):
    return generate_text_with_retry(
        prompt,
        label=label,
        max_retries=max_retries,
        base_delay=base_delay,
    )
