# 视频评审维度配置

## 5维度系统（标准系统）

DIMENSIONS = {
    "plot": {
        "name": "剧情",
        "weight": 1.0,
        "max_score": 10,
        "description": "故事逻辑、情节发展",
        "category": "core"
    },
    "character": {
        "name": "人物",
        "weight": 1.0,
        "max_score": 10,
        "description": "角色塑造、表演质量、口型同步、动作合理性、表情自然度",
        "category": "core"
    },
    "scene": {
        "name": "场景",
        "weight": 1.0,
        "max_score": 10,
        "description": "场景设计、美术风格",
        "category": "important"
    },
    "direction": {
        "name": "调度",
        "weight": 1.0,
        "max_score": 10,
        "description": "镜头运用、节奏控制",
        "category": "important"
    },
    "duration": {
        "name": "时长",
        "weight": 1.0,
        "max_score": 10,
        "description": "时长控制、节奏把握",
        "category": "secondary"
    }
}

## 默认阈值配置

DEFAULT_THRESHOLDS = {
    "plot": 6,
    "character": 6,
    "scene": 5,
    "direction": 5,
    "duration": 4,
}

## 总分阈值

MIN_TOTAL_SCORE = 30  # 50分的60%
