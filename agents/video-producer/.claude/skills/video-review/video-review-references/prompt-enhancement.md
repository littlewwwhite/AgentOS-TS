# 视频提示词优化系统

## 概述

基于评审结果自动优化视频生成提示词，提升视频质量。

## 目录结构

```
scripts/optimizer.py               ← Python 优化器接口
references/prompt-rules/
├── content_rules.xml              ← 内容规则（核心）
├── style_rules.xml                ← 风格规则
├── lighting_rules.xml             ← 光照规则
├── music_rules.xml                ← 音乐规则
├── sfx_rules.xml                  ← 音效规则
├── task.xml                       ← 任务类型定义
├── inputs.xml                     ← 输入格式
├── output_format.xml              ← 输出格式
├── final_rule.xml                 ← 最终规则
└── system_prompt.xml              ← 系统提示词
```

## 核心功能

### 1. 五维度优化策略

| 维度 | 优化重点 | 关键规则文件 |
|------|---------|-------------|
| 剧情 (plot) | 逻辑连贯、起承转合、时间顺序 | content_rules.xml |
| 人物 (character) | 口型同步、动作合理、表情自然 | content_rules.xml |
| 场景 (scene) | 环境细节、光照氛围、美术风格 | lighting_rules.xml, style_rules.xml |
| 调度 (direction) | 运镜指令、画面构图、节奏控制 | content_rules.xml |
| 时长 (duration) | 时长控制、信息密度、节奏把握 | content_rules.xml |

### 2. 任务类型支持

- **首帧**：基于首帧图片生成视频
- **尾帧**：基于尾帧图片生成视频
- **首尾帧**：基于首尾帧图片生成视频
- **多图参考**：基于多张参考图生成视频
- **首图切掉**：多角色设定图 + 文案生成分镜

## 使用方法

### Python 接口

```python
from scripts.optimizer import PromptOptimizer

# 初始化优化器
optimizer = PromptOptimizer()

# 单维度优化
original_prompt = "女生站在窗边，男生走过来"
review_result = {
    "score": 4,
    "evaluation": "逻辑跳跃，缺少转折"
}

optimized = optimizer.optimize_for_dimension(
    original_prompt=original_prompt,
    failed_dimension="plot",
    review_result=review_result,
    task_type="首帧"
)

# 多维度优化
failed_dimensions = ["plot", "character"]
review_results = {
    "plot": {"score": 4, "evaluation": "逻辑跳跃"},
    "character": {"score": 5, "evaluation": "口型不对"}
}

optimized = optimizer.optimize_multi_dimensions(
    original_prompt=original_prompt,
    failed_dimensions=failed_dimensions,
    review_results=review_results,
    task_type="首帧"
)
```

### 命令行使用

```bash
# 优化单个提示词
python3 scripts/optimizer.py \
    --prompt "女生站在窗边" \
    --dimension plot \
    --score 4 \
    --task-type 首帧

# 从评审结果自动优化
python3 scripts/auto_regenerate.py video.mp4 --auto-optimize
```

## 核心规则说明

### content_rules.xml

**核心原则：**
1. 按时间顺序描述，指代清楚每个主体
2. 用 `**加粗**` 标记核心动作
3. 用 `[[选项1|选项2]]` 提供可选细节
4. 运镜用方括号：`[推近] [拉远] [跟随]`
5. 说话规则：台词 + 情绪 + 语气 + 口型幅度

**动作描述要素：**
- 哪个主体（女生/男生/小孩/店员）
- 做了什么动作（站起、后退、奔跑、挥手）
- 大致方向（向左/向右/向前/向后）
- 动作幅度和速度（小幅度/大幅度、缓慢/迅速）

### 优化策略映射

#### 剧情维度不达标 → 强化逻辑连贯性

```
问题：逻辑断裂
优化：确保前后逻辑连贯，动作顺序清晰

问题：情节跳跃
优化：补充关键转折，避免情节跳跃

问题：节奏拖沓
优化：紧凑节奏，60秒内完成起承转合
```

#### 人物维度不达标 → 强化表演细节

```
问题：口型不对
优化：说话时明确标注：台词 + 情绪 + 语气/语速 + 口型幅度

问题：动作不合理
优化：动作描述要具体：主体 + 动作 + 方向 + 幅度 + 速度

问题：表情不自然
优化：情绪用可见表演体现：表情、眼神、姿态
```

#### 场景维度不达标 → 强化环境细节

```
问题：环境单调
优化：详细描述环境：地点 + 氛围 + 光线 + 背景元素

问题：美术风格不统一
优化：强化美术风格：色调 + 质感 + 细节装饰
```

#### 调度维度不达标 → 强化运镜指令

```
问题：镜头单调
优化：明确运镜：[推近] [拉远] [跟随] [晃动] [固定]

问题：构图不佳
优化：优化构图：景别 + 角度（俯拍/仰拍/平视）

问题：节奏控制差
优化：控制节奏：动作速度 + 镜头切换时机
```

#### 时长维度不达标 → 调整信息密度

```
问题：时长过长/过短
优化：严格控制时长在 55-65 秒，删除无效镜头
```

## 集成到评审流程

### 自动化工作流

```
评审视频 → 判定不合格 → 识别问题维度 → 调用优化器 → 生成优化提示词 → 重新生成视频
```

### 在 auto_regenerate.py 中集成

```python
from scripts.optimizer import PromptOptimizer

# 初始化优化器
optimizer = PromptOptimizer()

# 评审结果
review_results = review_video(video_path)

# 识别不达标维度
failed_dimensions = [
    dim for dim, result in review_results.items()
    if result["score"] < threshold
]

# 优化提示词
original_prompt = get_original_prompt(video_path)
optimized_prompt = optimizer.optimize_multi_dimensions(
    original_prompt,
    failed_dimensions,
    review_results
)

# 重新生成视频
regenerate_video(optimized_prompt)
```

## 最佳实践

1. **优先使用 content_rules.xml 的核心规则**
2. **根据具体问题选择性添加优化提示**
3. **避免过度优化，保持提示词简洁**
4. **测试优化效果，迭代改进策略**

## 版本信息

- **版本**: 1.0.0
- **更新日期**: 2026-03-05
- **来源**: 基于专业图生视频提示词优化系统整合
