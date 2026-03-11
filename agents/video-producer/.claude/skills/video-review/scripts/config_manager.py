#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
配置管理器
统一管理项目路径和配置
"""

import json
import os
from pathlib import Path
from typing import Dict, Optional, Any


class ConfigManager:
    """项目配置管理器"""

    def __init__(self, config_file: str = None):
        """
        初始化配置管理器

        Args:
            config_file: 配置文件路径，如果为 None 则自动查找
        """
        if config_file is None:
            config_file = self._find_config_file()

        self.config_file = Path(config_file) if config_file else None
        self.config = self._load_config()
        self.base_dir = self._get_base_dir()

    def _find_config_file(self) -> Optional[str]:
        """自动查找配置文件"""
        # 查找顺序：
        # 1. 当前目录的 config.json
        # 2. .claude/config.json
        # 3. ../config.json
        # 4. ../../03-视频素材/.claude/config.json

        search_paths = [
            "config.json",
            ".claude/config.json",
            "../config.json",
            "../../03-视频素材/.claude/config.json",
        ]

        for path in search_paths:
            if Path(path).exists():
                return path

        return None

    def _load_config(self) -> Dict:
        """加载配置文件"""
        if self.config_file and self.config_file.exists():
            with open(self.config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return self._get_default_config()

    def _get_default_config(self) -> Dict:
        """获取默认配置"""
        return {
            "project": {"name": "video-production", "module": "03-视频素材", "root": "."},
            "paths": {
                "input": {
                    "script": "workspace/input/episodes",
                    "storyboard": "workspace/input/storyboard",
                },
                "assets": {
                    "characters": "workspace/assets/characters",
                    "scenes": "workspace/assets/scenes",
                },
                "output": {
                    "root": "output",
                    "final_selection": "output/final_selection.json",
                },
            },
            "naming": {
                "analysis_suffix": "_analysis.json",
                "review_suffix": "_review.json",
            },
            "defaults": {
                "episode": "01",
                "aspect_ratio": "9:16",
                "duration": 5.0,
                "max_retries": 3,
            },
        }

    def _get_base_dir(self) -> Path:
        """获取基础目录"""
        if self.config_file:
            # 配置文件所在目录的父目录（如果在 .claude/ 下）
            if self.config_file.parent.name == ".claude":
                return self.config_file.parent.parent
            return self.config_file.parent
        return Path.cwd()

    def _resolve_path(self, *path_parts) -> Path:
        """解析路径（支持符号链接）"""
        path = self.base_dir
        for part in path_parts:
            if part:
                path = path / part
        return path.resolve()

    def get(self, *keys, default=None) -> Any:
        """获取配置值"""
        value = self.config
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key)
            else:
                return default
            if value is None:
                return default
        return value

    def get_path(self, *keys) -> str:
        """获取路径配置并解析为绝对路径"""
        path_str = self.get(*keys)
        if not path_str:
            return ""
        return str(self._resolve_path(path_str))

    # ========== 输入路径 ==========

    def get_script_dir(self) -> str:
        """获取剧本目录"""
        return self.get_path("paths", "input", "script")

    def get_storyboard_dir(self) -> str:
        """获取分镜脚本目录"""
        return self.get_path("paths", "input", "storyboard")

    def get_storyboard_file(self, episode: str) -> str:
        """获取指定集数的分镜文件"""
        storyboard_dir = Path(self.get_storyboard_dir())
        # 尝试多种命名模式
        patterns = [
            f"ep{episode}_storyboard.md",
            f"ep{episode}.md",
            f"episode_{episode}.md",
        ]
        for pattern in patterns:
            file_path = storyboard_dir / pattern
            if file_path.exists():
                return str(file_path)
        return ""

    # ========== 资产路径 ==========

    def get_character_asset_dir(self) -> str:
        """获取角色资产目录"""
        return self.get_path("paths", "assets", "characters")

    def get_scene_asset_dir(self) -> str:
        """获取场景资产目录"""
        return self.get_path("paths", "assets", "scenes")

    def get_props_asset_dir(self) -> str:
        """获取道具资产目录"""
        return self.get_path("paths", "assets", "props")

    # ========== 输出路径 ==========

    def get_output_root_dir(self) -> str:
        """获取输出根目录"""
        return self.get_path("paths", "output", "root")

    def get_video_output_dir(
        self, episode: str = None, scene: str = None, shot: str = None
    ) -> str:
        """
        获取视频输出目录

        Args:
            episode: 集数（如 "01"）
            scene: 场次（如 "01"）
            shot: 镜头（如 "01"）

        Returns:
            str: 视频输出目录路径
        """
        base_dir = Path(self.get_output_root_dir())

        if episode and scene and shot:
            return str(base_dir / f"ep{episode}" / f"sc{scene}" / f"l{shot}")
        elif episode and scene:
            return str(base_dir / f"ep{episode}" / f"sc{scene}")
        elif episode:
            return str(base_dir / f"ep{episode}")

        return str(base_dir)

    def get_analysis_file(self, video_path: str) -> str:
        """
        获取分析结果文件路径（与视频文件同目录）

        Args:
            video_path: 视频文件路径

        Returns:
            str: 分析结果文件路径
        """
        video_path_obj = Path(video_path)
        suffix = self.get("naming", "analysis_suffix", default="_analysis.json")
        return str(video_path_obj.parent / f"{video_path_obj.stem}{suffix}")

    def get_review_file(self, video_path: str) -> str:
        """
        获取评审结果文件路径（与视频文件同目录）

        Args:
            video_path: 视频文件路径

        Returns:
            str: 评审结果文件路径
        """
        video_path_obj = Path(video_path)
        suffix = self.get("naming", "review_suffix", default="_review.json")
        return str(video_path_obj.parent / f"{video_path_obj.stem}{suffix}")

    def get_final_selection_file(self) -> str:
        """获取最终选择文件路径"""
        return self.get_path("paths", "output", "final_selection")

    # ========== 默认值 ==========

    def get_default(self, key: str, default=None):
        """获取默认配置值"""
        return self.get("defaults", key, default=default)

    def get_default_episode(self) -> str:
        """获取默认集数"""
        return self.get_default("episode", "01")

    def get_default_aspect_ratio(self) -> str:
        """获取默认画幅"""
        return self.get_default("aspect_ratio", "9:16")

    def get_default_duration(self) -> float:
        """获取默认时长"""
        return self.get_default("duration", 5.0)

    def get_default_max_retries(self) -> int:
        """获取默认最大重试次数"""
        return self.get_default("max_retries", 3)

    # ========== 辅助方法 ==========

    def parse_segment_id(self, segment_id: str) -> Dict[str, str]:
        """
        解析 segment_id

        Args:
            segment_id: 如 "SC01-L02"

        Returns:
            Dict: {"scene": "01", "shot": "02"}
        """
        import re

        match = re.match(r"SC(\d+)-L(\d+)", segment_id, re.IGNORECASE)
        if match:
            return {"scene": match.group(1).zfill(2), "shot": match.group(2).zfill(2)}
        return {}

    def ensure_dir(self, path: str) -> str:
        """确保目录存在"""
        Path(path).mkdir(parents=True, exist_ok=True)
        return path

    def __repr__(self):
        return f"ConfigManager(config_file={self.config_file}, base_dir={self.base_dir})"


# 全局配置实例（单例模式）
_global_config = None


def get_config(config_file: str = None) -> ConfigManager:
    """获取全局配置实例"""
    global _global_config
    if _global_config is None or config_file is not None:
        _global_config = ConfigManager(config_file)
    return _global_config


if __name__ == "__main__":
    # 测试
    config = ConfigManager()
    print(config)
    print(f"角色资产目录: {config.get_character_asset_dir()}")
    print(f"场景资产目录: {config.get_scene_asset_dir()}")
    print(f"视频输出目录: {config.get_video_output_dir('01', '01', '02')}")
    print(f"最终选择文件: {config.get_final_selection_file()}")

    # 测试评审文件路径
    video_path = "output/ep01/sc01/l02/ep01-sc01-l02-01.mp4"
    print(f"\n视频文件: {video_path}")
    print(f"分析文件: {config.get_analysis_file(video_path)}")
    print(f"评审文件: {config.get_review_file(video_path)}")
