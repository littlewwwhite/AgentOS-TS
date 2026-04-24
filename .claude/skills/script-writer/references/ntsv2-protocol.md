# NTSV2 交付物标记协议 v1.0

> **NTSV2** = Novel-To-Script V2.0，小说改编微短剧剧本写作流水线。所有阶段的输入输出统一使用此协议标记，确保可追溯、可校验、可衔接。本协议在 SWS 协议基础上增加了扩写模式字段和小说原文引用字段，以支持从小说到剧本的改编工作流。

---

## 元数据标记 `[NTSV2-META]`

每个阶段的输出必须以元数据块开头，标明阶段信息和交付物清单：

```
[NTSV2-META]
stage: S1-原文分析与灵感提取
mode: expansion
version: NTSV2 v1.0
status: 待确认
source: 用户提供的小说原文
novel_source: {小说名称}
novel_word_count: {原文字数}
expansion_ratio: {高扩写/中扩写/低扩写}
first_mover: 情感推动力/剧情推动力
core_style: [风格代号+名称]
total_episodes: -
episode_duration: -
total_scenes: -
mainline_ratio: -
subplot_count: -
items:
  - 原文分析报告
  - 六维度画像
  - IP不动点清单
  - 扩写潜力评估报告
  - 风格方案
  - 创作锚点清单
next: S2-基础设定
[/NTSV2-META]
```

### 字段说明

| 字段 | 说明 | 必填阶段 |
|------|------|---------|
| stage | `S{N}-{阶段名}` | 全部 |
| mode | 扩写模式：`expansion`（小说改编扩写）/ `original`（原创）/ `adaptation`（忠实改编） | 全部 |
| version | 协议版本号，固定为 `NTSV2 v1.0` | 全部 |
| status | `待确认` → `已确认` → `终版` | 全部 |
| source | 上游数据来源 | 全部 |
| novel_source | 原著小说名称/来源 | 全部（改编模式） |
| novel_word_count | 原文总字数 | S1 |
| expansion_ratio | 扩写倍率（高/中/低），根据原文字数自动判定 | S1 起 |
| first_mover | 第一推动力类型 | S1 起 |
| core_style | 核心风格代号+名称 | S1 起 |
| total_episodes | 总集数 | S2 起 |
| episode_duration | 单集时长（秒） | S2 起 |
| total_scenes | 总场景数 | S6 起 |
| mainline_ratio | 主线占比百分比 | S2 起 |
| subplot_count | 支线数量 | S3 起 |
| items | 本阶段交付物列表 | 全部 |
| next | 下游阶段 | S1-S8（S9 为终点，无 next） |

### expansion_ratio 自动判定规则

| 原文字数 | expansion_ratio | 说明 |
|---------|----------------|------|
| 3000-5000字 | 高扩写 | 原文信息密度低，需大量创作性扩展 |
| 5000-8000字 | 中扩写 | 原文信息适中，均衡扩展 |
| 8000-10000字 | 低扩写 | 原文信息丰富，以细化和场景化为主 |

### next 字段参考值

| 当前阶段 | next 值 |
|---------|---------|
| S1-原文分析与灵感提取 | S2-基础设定 |
| S2-基础设定 | S3-故事大纲 |
| S3-故事大纲 | S4-角色开发 |
| S4-角色开发 | S5-进度追踪 |
| S5-进度追踪 | S6-单集细纲 |
| S6-单集细纲 | S7-逐层写作 |
| S7-逐层写作 | S8-润色终审 |
| S8-润色终审 | S9-格式交付 |
| S9-格式交付 | --（流水线终点） |

---

## 交付物项标记 `[NTSV2-ITEM]`

每个交付物用独立标记包裹，便于提取和传递：

```
[NTSV2-ITEM: 原文分析报告]
【原文分析报告】
Logline：...
题材标签：...
原著来源：...
扩写策略概述：...
...
[/NTSV2-ITEM]
```

### 小说原文引用标记

在交付物中引用原文内容时，使用专用引用格式：

```
[NTSV2-ITEM: 原文精华标记清单]
【原文精华标记清单】

[NOVEL-REF: 章节/段落标识]
原文内容摘录...
[/NOVEL-REF]
处理方式：保留并强化 / 改编 / 扩展
对应集数：第X-Y集
强化策略：...

[NOVEL-REF: 章节/段落标识]
原文内容摘录...
[/NOVEL-REF]
处理方式：...
对应集数：...
强化策略：...

[/NTSV2-ITEM]
```

### 5不变锁定清单标记

```
[NTSV2-ITEM: 5不变锁定清单]
【5不变锁定清单】

1. 主线冲突：{描述原文核心矛盾}
   锁定状态：已锁定

2. 角色核心设定：
   - {角色A}：{核心设定描述}
   - {角色B}：{核心设定描述}
   锁定状态：已锁定

3. 结局走向：{HE/BE/OE + 关键结果描述}
   锁定状态：已锁定

4. IP不动点：
   - {标志性元素1}
   - {标志性元素2}
   锁定状态：已锁定

5. 第一推动力：{驱动故事启动的核心事件/动机}
   锁定状态：已锁定

[/NTSV2-ITEM]
```

### 扩写追踪标记

在 S5 进度追踪及后续阶段使用：

```
[NTSV2-ITEM: 扩写进度追踪]
【扩写进度追踪】

扩写倍率：中扩写
目标集数：55集
当前进度：S6-单集细纲（第15/55集）

主线细化进度：30%
支线A（{名称}）：已引入，交互点2/5
支线B（{名称}）：已引入，交互点1/4
支线C（{名称}）：未引入（计划第18集引入）
情感线进度：暧昧期（第1轮甜虐循环中）
冲突升级阶段：试探期

红线检查：
  R1-无注水：通过
  R2-因果链：通过
  R3-精华保留：5/8已安排
  R4-元素回收：3个待回收元素
  R5-支线承载：通过

[/NTSV2-ITEM]
```

---

## 锚点文档标记 `[NTSV2-ANCHOR]`

跨阶段共享的核心参考文档，在 S4 角色开发完成后组装（因需包含 S4 产出的角色卡），S5-S9 必须加载：

```
[NTSV2-ANCHOR]
[NTSV2-ITEM: 创作锚点清单]
...（来自 S1）
[/NTSV2-ITEM]
[NTSV2-ITEM: 5不变锁定清单]
...（来自 S1）
[/NTSV2-ITEM]
[NTSV2-ITEM: 原文精华标记清单]
...（来自 S1）
[/NTSV2-ITEM]
[NTSV2-ITEM: 角色设定卡]
...（来自 S4）
[/NTSV2-ITEM]
[NTSV2-ITEM: 配角速写卡]
...（来自 S4）
[/NTSV2-ITEM]
[NTSV2-ITEM: 风格DNA卡]
...（来自 S2）
[/NTSV2-ITEM]
[NTSV2-ITEM: 扩写策略摘要]
...（来自 S2/S3）
[/NTSV2-ITEM]
[/NTSV2-ANCHOR]
```

### 与 SWS-ANCHOR 的差异

NTSV2-ANCHOR 在 SWS-ANCHOR 基础上增加了以下锚点项：

| 新增锚点项 | 来源阶段 | 用途 |
|-----------|---------|------|
| 5不变锁定清单 | S1 | 全流程校验不可更改的核心要素 |
| 原文精华标记清单 | S1 | 确保改编过程中原文精华不被遗漏 |
| 扩写策略摘要 | S2/S3 | 记录扩写倍率、支线规划、比例分配 |

---

## 检查点标记 `[NTSV2-CHECKPOINT]`

阶段间切换上下文时（如 `/clear` 后重新加载），用检查点记录流水线状态：

```
[NTSV2-CHECKPOINT]
current_stage: S2-基础设定（已确认）
mode: expansion
novel_source: {小说名称}
expansion_ratio: 中扩写
first_mover: 情感推动力
core_style: A.虐心催泪流
style_guide_path: ${PROJECT_DIR}/draft/style-guide.md
anchor_path: ${PROJECT_DIR}/draft/anchor.md
five_invariants_locked: true
novel_highlights_count: 8
subplot_plan: 3条支线
completed:
  - S1-原文分析与灵感提取 → ${PROJECT_DIR}/draft/s1-analysis.md
  - S2-基础设定 → ${PROJECT_DIR}/draft/s2-setting.md
next_stage: S3-故事大纲
expansion_notes: 原文5200字，采用中扩写策略，目标55集
notes: 基础设定已完成，进入故事大纲阶段
[/NTSV2-CHECKPOINT]
```

### 与 SWS-CHECKPOINT 的差异

NTSV2-CHECKPOINT 在 SWS-CHECKPOINT 基础上增加了以下字段：

| 新增字段 | 说明 |
|---------|------|
| mode | 扩写模式标识 |
| novel_source | 原著小说来源 |
| expansion_ratio | 当前扩写倍率 |
| five_invariants_locked | 5不变是否已锁定（true/false） |
| novel_highlights_count | 已标记的原文精华数量 |
| subplot_plan | 支线规划摘要 |
| expansion_notes | 扩写相关备注 |

---

## 工作区目录约定

NTSV2 与 SWS 共用 `${PROJECT_DIR}/draft/` 作为工作区根目录：

```
${PROJECT_DIR}/
├── source.txt               # 原文（自动保存于项目根）
└── draft/
    ├── s1-analysis.md           # S1 交付物（原文分析+灵感提取）
    ├── style-guide.md           # 风格指南（S1 确认后生成）
    ├── s2-setting.md            # S2 交付物
    ├── s3-outline.md            # S3 交付物（故事大纲+扩写规划）
    ├── s4-character.md          # S4 交付物
    ├── anchor.md                # 锚点文档（S4 完成后组装）
├── s5-tracking.md           # S5 进度追踪
├── s6-episode-outline.md    # S6 交付物（节拍表+场景清单）
├── s7-scripts.md            # S7 交付物（完整剧本）
├── s8-polished.md           # S8 交付物（终版剧本）
└── checkpoint.md            # 流水线进度检查点
```

---

## 协议版本兼容性

| 协议 | 版本 | 用途 | 兼容性 |
|------|------|------|--------|
| SWS Protocol | v1.0 | 原创剧本写作（script-writing-skill） | NTSV2 向下兼容 SWS |
| NTSV2 Protocol | v1.0 | 小说改编微短剧（novel-to-script-v2.0） | SWS 的超集 |

NTSV2 协议完全兼容 SWS 协议的所有标记。当 `mode` 设为 `original` 时，NTSV2 协议退化为 SWS 协议（扩写相关字段可省略）。
