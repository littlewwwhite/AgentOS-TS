#!/usr/bin/env python3
"""
配置管理工具
用于管理评审维度、权重和平台标准
"""

import json
from pathlib import Path
from typing import Dict, Optional


class ConfigManager:
    """配置管理器"""

    DEFAULT_CONFIG = {
        "dimensions": {
            "plot": {"name": "剧情", "weight": 1.0, "max_score": 10},
            "character": {"name": "人物", "weight": 1.0, "max_score": 10},
            "scene": {"name": "场景", "weight": 1.0, "max_score": 10},
            "direction": {"name": "调度", "weight": 1.0, "max_score": 10},
            "duration": {"name": "时长", "weight": 1.0, "max_score": 10},
        },
        "platforms": {
            "douyin": {
                "name": "抖音",
                "duration_range": [15, 60],
                "focus": ["节奏", "视觉冲击"],
            },
            "kuaishou": {
                "name": "快手",
                "duration_range": [30, 180],
                "focus": ["真实感", "情感共鸣"],
            },
            "bilibili": {
                "name": "B站",
                "duration_range": [60, 600],
                "focus": ["内容深度", "创意"],
            },
        },
    }

    def __init__(self, config_path: Optional[str] = None):
        if config_path:
            self.config_path = Path(config_path)
        else:
            self.config_path = Path.home() / ".video_review_config.json"

    def load(self) -> Dict:
        """加载配置"""
        if self.config_path.exists():
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return self.DEFAULT_CONFIG.copy()

    def save(self, config: Dict):
        """保存配置"""
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

    def reset(self):
        """重置为默认配置"""
        self.save(self.DEFAULT_CONFIG)

    def add_dimension(self, key: str, name: str, weight: float = 1.0, max_score: int = 10):
        """添加自定义维度"""
        config = self.load()
        config["dimensions"][key] = {
            "name": name,
            "weight": weight,
            "max_score": max_score,
        }
        self.save(config)

    def remove_dimension(self, key: str):
        """移除维度"""
        config = self.load()
        if key in config["dimensions"]:
            del config["dimensions"][key]
            self.save(config)

    def set_platform(self, platform: str):
        """设置目标平台"""
        config = self.load()
        config["target_platform"] = platform
        self.save(config)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="配置管理工具")
    parser.add_argument("action", choices=["show", "reset", "add-dimension", "set-platform"])
    parser.add_argument("--key", help="维度键名")
    parser.add_argument("--name", help="维度名称")
    parser.add_argument("--weight", type=float, default=1.0, help="权重")
    parser.add_argument("--platform", help="平台名称")

    args = parser.parse_args()

    manager = ConfigManager()

    if args.action == "show":
        config = manager.load()
        print(json.dumps(config, ensure_ascii=False, indent=2))
    elif args.action == "reset":
        manager.reset()
        print("配置已重置为默认值")
    elif args.action == "add-dimension":
        if not args.key or not args.name:
            print("错误: 需要提供 --key 和 --name 参数")
        else:
            manager.add_dimension(args.key, args.name, args.weight)
            print(f"已添加维度: {args.name}")
    elif args.action == "set-platform":
        if not args.platform:
            print("错误: 需要提供 --platform 参数")
        else:
            manager.set_platform(args.platform)
            print(f"已设置目标平台: {args.platform}")
