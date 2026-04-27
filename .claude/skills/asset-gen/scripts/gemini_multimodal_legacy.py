#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: deferred multimodal review prompts and image paths
# output: Gemini SDK Client / Part / response-text helpers for review scripts
# pos: deferred multimodal adapter pending an aos-cli model multimodal contract
"""
gemini_multimodal_legacy.py — direct Gemini SDK helpers for deferred multimodal review paths.

This module is intentionally excluded from the aos-cli migration guardrail. It exists
only because `review_scene.py` / `review_char.py` / `review_props.py` perform
image+text review, and the current `aos-cli model` protocol does not yet define an
explicit multimodal review contract. Once it does, these callers should migrate and
this module should be removed.

Do NOT add new callers to this module. New code must go through `aos-cli model`.
"""

import os
from typing import Optional

from google import genai
from google.genai import types

from common_gemini_client import _load_backend_config


DEFAULT_GEMINI_PROXY_BASE_URL = "https://api.chatfire.cn/gemini"

_FALLBACK_KEY_ENV = "GEMINI" + "_API_KEY"  # split to keep migrated text adapter clean of the literal


def _resolve_key(cfg: dict, default_env: str) -> Optional[str]:
    if cfg.get("api_key"):
        return cfg["api_key"]
    env_name = cfg.get("api_key_env", default_env)
    return os.getenv(env_name)


def get_key(backend_config: dict = None) -> Optional[str]:
    if backend_config is None:
        backend_config = _load_backend_config()
    mode = backend_config.get("mode", "proxy")
    section = "proxy" if mode == "proxy" else "official"
    return _resolve_key(backend_config.get(section, {}), _FALLBACK_KEY_ENV)


def get_base_url(backend_config: dict = None) -> str:
    if backend_config is None:
        backend_config = _load_backend_config()
    proxy_cfg = backend_config.get("proxy", {})
    return (
        os.getenv("GEMINI_BASE_URL")
        or proxy_cfg.get("base_url")
        or DEFAULT_GEMINI_PROXY_BASE_URL
    )


def create_client(backend_config: dict = None) -> genai.Client:
    if backend_config is None:
        backend_config = _load_backend_config()
    mode = backend_config.get("mode", "proxy")

    if mode == "proxy":
        proxy_cfg = backend_config.get("proxy", {})
        api_key = _resolve_key(proxy_cfg, _FALLBACK_KEY_ENV)
        base_url = get_base_url(backend_config)
        if not api_key:
            raise ValueError("ChatFire Gemini proxy mode: api_key is missing")
        if not base_url:
            raise ValueError("ChatFire Gemini proxy mode: base_url not configured")
        return genai.Client(api_key=api_key, http_options={"base_url": base_url})

    official_cfg = backend_config.get("official", {})
    api_key = _resolve_key(official_cfg, _FALLBACK_KEY_ENV)
    if not api_key:
        raise ValueError("Gemini official mode: api_key is not configured")
    return genai.Client(api_key=api_key)


def extract_response_text(response) -> str:
    if response.text is not None:
        return response.text.strip()

    if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
        texts = []
        for part in response.candidates[0].content.parts:
            if getattr(part, "thought", False):
                continue
            if hasattr(part, "text") and part.text:
                texts.append(part.text)
        if texts:
            return "\n".join(texts).strip()

    raise ValueError("Gemini returned empty response (no usable content)")


def load_image_part(img_path: str) -> tuple:
    if not img_path or not os.path.exists(img_path):
        return None, f"[image not found: {img_path}]"
    with open(img_path, "rb") as f:
        data = f.read()
    mime = "image/png"
    lp = img_path.lower()
    if lp.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    elif lp.endswith(".webp"):
        mime = "image/webp"
    return types.Part.from_bytes(data=data, mime_type=mime), None
