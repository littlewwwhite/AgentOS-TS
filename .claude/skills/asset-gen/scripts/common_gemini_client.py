#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: asset-gen prompt/text/JSON requests
# output: aos-cli model envelopes returning normalized text/JSON
# pos: text model boundary adapter for asset-gen scripts
"""
common_gemini_client.py — aos-cli text/JSON adapter for asset-gen.

Despite the legacy module name, this file no longer talks to Gemini directly. It builds
`aos-cli.model/v1` envelopes with `capability=generate` and dispatches them through
`_shared/aos_cli_envelope.py`. Provider routing, key resolution, and proxy selection
are owned by `aos-cli`.

Image+text review paths use `common_vision_review.py` and `vision.review`.
"""

from __future__ import annotations

import logging
import random
import sys
import time
from pathlib import Path
from typing import Any

from common_config import get_config

_SHARED_DIR = Path(__file__).resolve().parents[2] / "_shared"
if str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from aos_cli_envelope import extract_json, extract_text, run_envelope


logger = logging.getLogger(__name__)


def _load_backend_config() -> dict:
    return get_config().get("text_generate", {})


def get_model(backend_config: dict | None = None) -> str:
    if backend_config is None:
        backend_config = _load_backend_config()
    return backend_config.get("model", "gemini-2.0-flash")


def _aos_cli_generate(prompt: str, *, label: str, output_kind: str, model: str | None = None) -> Any:
    request: dict[str, Any] = {
        "apiVersion": "aos-cli.model/v1",
        "task": label,
        "capability": "generate",
        "output": {"kind": output_kind},
        "input": {"content": prompt},
    }
    selected_model = model or get_model()
    if selected_model:
        request["modelPolicy"] = {"model": selected_model}

    envelope = run_envelope(
        request,
        cwd=Path.cwd(),
        expected_kind=output_kind,
        tmp_prefix="asset-gen-aos-cli-",
    )

    if output_kind == "json":
        return extract_json(envelope)
    if output_kind == "text":
        return extract_text(envelope)
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
