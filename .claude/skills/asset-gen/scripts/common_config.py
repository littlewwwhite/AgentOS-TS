#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common_config.py - 统一配置加载器

将 assets/ + references/ 重新组装为
与旧 generation_config.json / review_config.json / style_config.json 等价的 dict，
使下游脚本的 _GC[...] / _RC[...] 引用完全不变。

用法:
  from common_config import get_config, get_review_config, get_style_config, load_template
"""

import json
from pathlib import Path
from functools import lru_cache

SKILL_DIR   = Path(__file__).resolve().parent.parent   # asset-gen/
ASSETS_DIR    = SKILL_DIR / "assets"
REFERENCES_DIR = SKILL_DIR / "references"


def get_scripts_path() -> Path:
    """Return the directory containing local helper scripts."""
    return SKILL_DIR / "scripts"


def _read_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_template(category: str, name: str) -> str:
    """读取 assets/{category}/{name}.md 并返回内容。"""
    path = ASSETS_DIR / category / f"{name}.md"
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ═════════════════════════════════════════════════════════════════════════════
# get_config()  →  等价于旧 generation_config.json
# ═════════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def get_config() -> dict:
    """返回与旧 generation_config.json 完全等价的 dict。"""
    style_cfg = _read_json(ASSETS_DIR / "style" / "style_generate.json")
    model_config = _read_json(ASSETS_DIR / "common" / "gemini_backend.json")
    return {
        "num_prompts": style_cfg["num_prompts"],
        "text_generate": model_config["text_generate"],
        "vision_review": model_config["vision_review"],
        "generate_scenes": {
            "ref_prompt_template": load_template("generation", "scene_ref_prompt"),
        },
        "generate_props": {
            "ref_prompt_template": load_template("generation", "prop_ref_prompt"),
        },
        "prompt_templates": {
            "retry_prompt_rewrite": load_template("generation", "retry_prompt_rewrite"),
            "asset_description": {
                "character":  load_template("generation", "asset_description_character"),
                "voice_desc": load_template("generation", "asset_description_voice_desc"),
                "scene":      load_template("generation", "asset_description_scene"),
                "props":      load_template("generation", "asset_description_props"),
            },
            "head_closeup": load_template("generation", "head_closeup_prompt"),
            "asset_prompt": {
                "character_three_view": {
                    "with_style": load_template("generation", "asset_prompt_character_three_view"),
                },
                "scene": {
                    "with_style": load_template("generation", "asset_prompt_scene"),
                },
                "props": {
                    "with_style": load_template("generation", "asset_prompt_props"),
                },
            },
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# get_review_config()  →  等价于旧 review_config.json
# ═════════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def get_review_config() -> dict:
    """返回与旧 review_config.json 完全等价的 dict。"""
    model_config = _read_json(ASSETS_DIR / "common" / "gemini_backend.json")
    review_rounds = _read_json(ASSETS_DIR / "review" / "review_rounds.json")

    review_prompt_keys = [
        "char_three_view_system",
        "char_three_view_gate",
        "char_head_closeup_system",
        "prop_system",
        "prop_ref_system",
        "scene_main_system",
        "scene_ref_system",
        "closing",
    ]

    return {
        "review_rounds": review_rounds,
        "vision_review": model_config["vision_review"],
        "review_prompts": {
            key: load_template("review", key)
            for key in review_prompt_keys
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# get_style_config()  →  等价于旧 style_config.json
# ═════════════════════════════════════════════════════════════════════════════

@lru_cache(maxsize=1)
def get_style_config() -> dict:
    """返回与旧 style_config.json 完全等价的 dict。"""
    style_cfg = _read_json(ASSETS_DIR / "style" / "style_generate.json")

    return {
        "generate_style": {
            **style_cfg,
            "prompt_template": load_template("style", "style_prompt"),
        }
    }
