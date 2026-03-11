# SWS 交付物标记协议 v1.0

> **SWS** = Script-Writing-Skill，所有阶段的输入输出统一使用此协议标记，确保可追溯、可校验、可衔接。

## 元数据标记 `[SWS-META]`

每个阶段的输出必须以元数据块开头，标明阶段信息和交付物清单：

```
[SWS-META]
stage: S1-创意构思
mode: -
version: 1.0
status: 待确认
source: 用户创意输入
first_mover: 情感推动力/剧情推动力
core_style: [风格代号+名称]
total_episodes: -
episode_duration: -
total_scenes: -
items:
  - 创意概念报告
  - 创作锚点清单
  - 风格方案
next: S2-基础设定
[/SWS-META]
```

**字段说明：**

| 字段 | 说明 | 必填阶段 |
|------|------|---------|
| stage | `S{N}-{阶段名}` | 全部 |
| mode | 保留字段 | - |
| version | 协议版本号 | 全部 |
| status | `待确认` → `已确认` → `终版` | 全部 |
| source | 上游数据来源 | 全部 |
| first_mover | 第一推动力类型 | S1 起 |
| core_style | 核心风格代号+名称 | S1 起 |
| total_episodes | 总集数 | S2 起 |
| episode_duration | 单集时长（秒） | S2 起 |
| total_scenes | 总场景数 | S2 起 |
| items | 本阶段交付物列表 | 全部 |
| next | 下游阶段 | S1–S8（S9 为终点，无 next） |

**next 字段参考值：**

| 当前阶段 | next 值 |
|---------|---------|
| S1-创意构思 | S2-基础设定 |
| S2-基础设定 | S3-故事大纲 |
| S3-故事大纲 | S4-角色开发 |
| S4-角色开发 | S5-进度追踪 |
| S5-进度追踪 | S6-单集细纲 |
| S6-单集细纲 | S7-逐层写作 |
| S7-逐层写作 | S8-润色终审 |
| S8-润色终审 | S9-格式交付 |
| S9-格式交付 | —（流水线终点） |

## 交付物项标记 `[SWS-ITEM]`

每个交付物用独立标记包裹，便于提取和传递：

```
[SWS-ITEM: 创意概念报告]
【创意概念报告】
Logline：...
题材标签：...
...
[/SWS-ITEM]
```

## 锚点文档标记 `[SWS-ANCHOR]`

跨阶段共享的核心参考文档，在 S4 角色开发完成后组装（因需包含 S4 产出的角色卡），S5-S9 必须加载：

```
[SWS-ANCHOR]
[SWS-ITEM: 创作锚点清单]
...（来自 S1）
[/SWS-ITEM]
[SWS-ITEM: 角色设定卡]
...（来自 S4）
[/SWS-ITEM]
[SWS-ITEM: 配角速写卡]
...（来自 S4）
[/SWS-ITEM]
[SWS-ITEM: 风格DNA卡]
...（来自 S2）
[/SWS-ITEM]
[/SWS-ANCHOR]
```

## 检查点标记 `[SWS-CHECKPOINT]`

阶段间切换上下文时（如 `/clear` 后重新加载），用检查点记录流水线状态：

```
[SWS-CHECKPOINT]
current_stage: S2-基础设定（已确认）
first_mover: 情感推动力
core_style: A.虐心催泪流
style_guide_path: sws-workspace/style-guide.md
anchor_path: sws-workspace/anchor.md
completed:
  - S1-创意构思 → sws-workspace/s1-ideation.md
  - S2-基础设定 → sws-workspace/s2-setting.md
next_stage: S3-故事大纲
notes: 基础设定已完成，进入故事大纲阶段
[/SWS-CHECKPOINT]
```
