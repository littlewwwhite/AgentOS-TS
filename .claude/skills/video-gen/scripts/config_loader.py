#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# input: assets/config.json and local environment variables
# output: normalized skill runtime configuration dictionaries
# pos: central config boundary; gemini section feeds deferred frame-description paths only
"""
config_loader.py — video-gen 统一配置加载器

从 assets/config.json 加载配置，支持环境变量 STORYBOARD_CONFIG 覆盖路径。
找不到文件时返回内置默认值（向后兼容）。

Model boundary note: deferred multimodal — see .claude/skills/_shared/AOS_CLI_MODEL.md
The `gemini` config section exposed by `get_gemini_config()` and
`get_gemini_review_config()` exists solely to support the deferred multimodal
frame description (`frame_extractor.py`) path.
Migrated text/JSON/image/video paths route through aos-cli model and do not
read this section. Do not introduce new consumers of `get_gemini_config`.
"""

import json
import os
import copy
from pathlib import Path
from typing import Any, Dict

SCRIPT_DIR = Path(__file__).parent
DEFAULT_CONFIG_PATH = SCRIPT_DIR / ".." / "assets" / "config.json"
DEFAULT_GEMINI_PROXY_BASE_URL = "https://api.chatfire.cn/gemini"

# 内置默认值（与 assets/config.json 保持一致，用于找不到文件时兜底）
_BUILTIN_DEFAULTS: Dict[str, Any] = {
    "video_model": {
        "provider": "volcengine_ark",
        "active_model": "seedance2",
        "models": {
            "seedance2": {
                "provider": "volcengine_ark",
                "model_code": "ep-20260303234827-tfnzm",
                "model_group_code": "",
                "subject_reference": False,
            },
        },
        "providers": {
            "volcengine_ark": {
                "base_url": "https://ark.cn-beijing.volces.com/api/v3",
                "api_key_env": "ARK_API_KEY",
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
    "gemini": {
        "base_url": DEFAULT_GEMINI_PROXY_BASE_URL,
        "api_key": "",
        "api_key_env": "GEMINI_API_KEY",
        "model": "gemini-3.1-pro-preview",
        "review_model": "gemini-3.1-pro-preview",
        "color_removal_model": "gemini-3.1-pro-preview",
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
    """Apply secret-bearing environment overrides after loading file config."""
    gemini_cfg = data.setdefault("gemini", {})
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    if gemini_api_key:
        gemini_cfg["api_key"] = gemini_api_key
        gemini_cfg["api_key_env"] = "GEMINI_API_KEY"

    base_url = os.environ.get("GEMINI_BASE_URL")
    if base_url:
        gemini_cfg["base_url"] = base_url
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


def get_gemini_review_config() -> Dict[str, Any]:
    """返回 gemini 配置段（兼容旧的 gemini_review 调用）。"""
    return get_config().get("gemini", _BUILTIN_DEFAULTS["gemini"])


def get_gemini_config() -> Dict[str, Any]:
    """返回 gemini 配置段。"""
    return get_config().get("gemini", _BUILTIN_DEFAULTS["gemini"])


def get_prompt_generation_config() -> Dict[str, Any]:
    """返回 prompt_generation 配置段。"""
    return get_config().get("prompt_generation", _BUILTIN_DEFAULTS["prompt_generation"])


def get_continuity_config() -> Dict[str, Any]:
    """返回 continuity 配置段（clip 间连续性）。"""
    return get_config().get("continuity", _BUILTIN_DEFAULTS["continuity"])
