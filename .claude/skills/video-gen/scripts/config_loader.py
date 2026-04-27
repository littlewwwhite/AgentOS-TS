#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: assets/config.json and local environment variables
# output: normalized skill runtime configuration dictionaries
# pos: central config boundary for video-gen runtime settings
"""
config_loader.py — video-gen 统一配置加载器

从 assets/config.json 加载配置，支持环境变量 STORYBOARD_CONFIG 覆盖路径。
找不到文件时返回内置默认值（向后兼容）。

The `clip_review` config section selects the model used for generated-clip
review (frame description and video analysis) plus the business thresholds
that gate pass/fail. Provider routing and secrets are owned by aos-cli.
"""

import json
import os
import copy
from pathlib import Path
from typing import Any, Dict

SCRIPT_DIR = Path(__file__).parent
DEFAULT_CONFIG_PATH = SCRIPT_DIR / ".." / "assets" / "config.json"
# 内置默认值（与 assets/config.json 保持一致，用于找不到文件时兜底）
_BUILTIN_DEFAULTS: Dict[str, Any] = {
    "video_model": {
        "active_model": "seedance2",
        "models": {
            "seedance2": {
                "model_code": "ep-20260303234827-tfnzm",
            },
        },
    },
    "generation": {
        "min_attempts": 1,
        "max_attempts": 2,
        "default_quality": "720",
        "default_ratio": "16:9",
        "task_timeout": 1800,
        "poll_timeout": 1830,
        "poll_interval": 10,
        "max_consecutive_errors": 10,
    },
    "clip_review": {
        "model": "gemini-3.1-pro-preview",
        "max_workers": 2,
        "thresholds": {
            "reference_consistency_min": 6,
            "prompt_compliance_min": 6,
        },
    },
    "prompt_generation": {},
    "continuity": {
        "enabled": True,
    },
}

_config_cache: Dict[str, Any] = {}


def _apply_env_overrides(data: Dict[str, Any]) -> Dict[str, Any]:
    """Strip provider routing/secret leftovers; aos-cli owns provider routing."""
    video_model_cfg = data.setdefault("video_model", {})
    video_model_cfg.pop("providers", None)
    video_model_cfg.pop("provider", None)
    for model_cfg in video_model_cfg.get("models", {}).values():
        if isinstance(model_cfg, dict):
            for legacy_key in ("provider", "model_group_code", "subject_reference"):
                model_cfg.pop(legacy_key, None)

    clip_review_cfg = data.setdefault("clip_review", {})
    for provider_key in ("api_key", "api_key_env", "api_key_note", "base_url"):
        clip_review_cfg.pop(provider_key, None)
    return data


def get_config() -> Dict[str, Any]:
    """加载并返回完整配置字典。结果会缓存，只加载一次。"""
    if _config_cache:
        return _config_cache

    config_path = os.environ.get("STORYBOARD_CONFIG", str(DEFAULT_CONFIG_PATH.resolve()))

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        import sys
        print(f"[config_loader] 配置文件加载失败 ({e})，使用内置默认值", file=sys.stderr)
        data = copy.deepcopy(_BUILTIN_DEFAULTS)

    _config_cache.update(_apply_env_overrides(data))

    return _config_cache


# ── 分类 getter ──────────────────────────────────────────────

def get_video_model_config() -> Dict[str, Any]:
    """返回 video_model 配置段。"""
    return get_config().get("video_model", _BUILTIN_DEFAULTS["video_model"])


def get_generation_config() -> Dict[str, Any]:
    """返回 generation 配置段。"""
    return get_config().get("generation", _BUILTIN_DEFAULTS["generation"])


def get_clip_review_config() -> Dict[str, Any]:
    """Return the clip_review config section (review model + thresholds)."""
    return get_config().get("clip_review", _BUILTIN_DEFAULTS["clip_review"])


def get_prompt_generation_config() -> Dict[str, Any]:
    """返回 prompt_generation 配置段。"""
    return get_config().get("prompt_generation", _BUILTIN_DEFAULTS["prompt_generation"])


def get_continuity_config() -> Dict[str, Any]:
    """返回 continuity 配置段（clip 间连续性）。"""
    return get_config().get("continuity", _BUILTIN_DEFAULTS["continuity"])
