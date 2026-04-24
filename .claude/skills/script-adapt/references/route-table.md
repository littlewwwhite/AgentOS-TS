# Shadow Route Table for Script Skills

> Status: audit-only  
> Scope: `script-adapt` / `script-writer` entry explanation  
> Non-goal: this file does **not** replace current orchestrator dispatch

## Purpose

这个文档把当前项目里“剧本相关 skill 应该如何选”的判断，从自然语言经验规则，收敛成一份**可解释、可审计、可迁移**的影子路由表。

本表当前只用于：

1. 在进入 `script-adapt` 或 `script-writer` 前解释为什么选它
2. 处理 3000-10000 字重叠区间的歧义
3. 为后续真正的内部路由器提供事实源

本表当前**不用于**：

1. 接管 orchestrator 真实调度
2. 改写现有 skill 的产物路径
3. 引入 templates 的多阶段壳或多 workspace 结构

## Decision Priority

路由优先级必须遵循以下顺序：

1. **creation_goal**
2. **preserve_source_skeleton**
3. **source_kind**
4. **source_span**

也就是说：

- 决定走哪条路的首要因素，不是字数，而是**用户到底要原创、扩写、直转还是格式转换**
- 字数只用于补足判断，不能压过真实创作目标

## Canonical Dimensions

### `source_kind`

- `idea`: 暂停入口。只有创意、概念、命题，没有成文原文
- `inspiration_artifact`: 暂停入口。已有 `output/inspiration.json` 或同类调研/灵感产物
- `novel_text`: 已有小说或剧本文本原文
- `structured_storyboard`: 已有 docx/excel 风格结构化分镜或接近可直转的结构稿

### `source_span`

- `none`: 无成文原文
- `short`: 短篇源文本，通常 ≤ 10000 字
- `long`: 长篇或多章节源文本，通常 > 10000 字，或虽不足 10000 字但用户明确要求“直转/保留原骨架”
- `structured`: 已经是可识别结构化稿件
- `unknown`: 尚未足够判断

### `creation_goal`

- `original`: 从零原创
- `expansion`: 基于短源文本做明显扩写
- `direct_adaptation`: 尽量保留原叙事骨架的改编
- `direct_parse`: 已有结构稿，主要做格式转换/结构提取
- `unknown`: 用户目标表达不足

### `preserve_source_skeleton`

- `true`: 用户要尽量保留原文骨架、节奏、关键关系链
- `false`: 用户接受大幅扩写或再创造
- `null`: 没有足够信息

## Route Matrix

| route_id | source_kind | source_span | creation_goal | preserve_source_skeleton | selected_skill | selected_variant | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `long_novel_direct_adaptation` | `novel_text` | `long` | `direct_adaptation` | `true` | `script-adapt` | `novel` | `valid` |
| `short_source_expansion` | `novel_text` | `short` | `expansion` | `false` | `script-writer` | `NTSV2` | `valid` |
| `original_from_idea` | `idea` | `none` | `original` | `null` | `script-writer` | `SWS` | `paused` |
| `inspiration_to_original` | `inspiration_artifact` | `none` | `original` | `null` | `script-writer` | `SWS` | `paused` |
| `structured_storyboard_transform` | `structured_storyboard` | `structured` | `direct_parse` | `true` | `script-adapt` | `storyboard` | `valid` |
| `ambiguous_short_novel` | `novel_text` | `short` | `unknown` | `null` | `script-writer` | `unknown` | `needs_user_confirmation` |
| `ambiguous_overlap_zone` | `novel_text` | `short` or `long` | `unknown` | `null` | `script-adapt` or `script-writer` | `unknown` | `needs_user_confirmation` |

## Overlap Rule: 3000-10000 字区间

当前项目中，`script-adapt` 与 `script-writer` 在 3000-10000 字区间存在天然重叠。  
这个区间**不能按字数硬切**，必须按创作目标切：

| 条件 | Route |
| --- | --- |
| 用户要“直转 / 简单改编 / 保留原文骨架 / 快速转剧本” | `script-adapt` |
| 用户要“扩写 / 拉长 / 再设计 / 做成 50-60 集长剧” | `script-writer` `NTSV2` |

因此：

- `source_span` 只是辅助维度
- **`creation_goal` + `preserve_source_skeleton` 才是决定性维度**

## Expected Artifacts by Route

### `script-adapt` / `novel`

- `draft/source-structure.json`
- `draft/design.json`
- `draft/catalog.json`
- `draft/episodes/ep*.md`
- `output/script.json`

### `script-adapt` / `storyboard`

- `source.txt`
- `draft/source-structure.json`
- `draft/catalog.json`
- `draft/episodes/ep*.md`
- `output/script.json`

### `script-writer` / `SWS`

- `draft/anchor.md`
- `draft/style-guide.md`
- `draft/s3-outline.md`
- `draft/s6-episode-outline.md`
- `draft/episodes/ep*.md`
- `output/script.json`

### `script-writer` / `NTSV2`

- `draft/source-structure.json`
- `draft/anchor.md`
- `draft/style-guide.md`
- `draft/s3-outline.md`
- `draft/s6-episode-outline.md`
- `draft/episodes/ep*.md`
- `output/script.json`

## Shadow Route Explanation Contract

真正执行前，当前 skill 必须先输出一段**路由解释**。字段语义以 `route-table.schema.json` 为准，最少包含：

- `route_id`
- `status`
- `source_kind`
- `source_span`
- `creation_goal`
- `preserve_source_skeleton`
- `selected_skill`
- `selected_variant`
- `expected_artifacts`
- `why`

推荐呈现格式：

```json
{
  "route_id": "long_novel_direct_adaptation",
  "status": "valid",
  "source_kind": "novel_text",
  "source_span": "long",
  "creation_goal": "direct_adaptation",
  "preserve_source_skeleton": true,
  "selected_skill": "script-adapt",
  "selected_variant": "novel",
  "expected_artifacts": [
    "draft/design.json",
    "draft/catalog.json",
    "output/script.json"
  ],
  "why": [
    "user wants direct adaptation rather than expansion",
    "source should keep original narrative skeleton"
  ]
}
```

## Mismatch Policy

如果影子路由判定“当前 skill 不是最佳入口”，处理原则如下：

1. **先解释，不要静默切换**
2. 明确说明更匹配的 skill / variant
3. 当前 skill 不应强行吞下越界任务
4. 但这个影子路由本身**不改真实 orchestrator 行为**

## Examples

### Example A: 长篇小说直转

- 输入：用户上传长篇原文，并说“快速改成可出图剧本”
- 路由：`long_novel_direct_adaptation`
- skill：`script-adapt`

### Example B: 短篇扩写成长剧

- 输入：用户给 6000 字短篇，并说“扩成 50 集”
- 路由：`short_source_expansion`
- skill：`script-writer` / `NTSV2`

### Example C: 从灵感原创（当前暂停）

- 输入：用户给一句题材命题或 `inspiration.json`
- 路由：`original_from_idea` 或 `inspiration_to_original`，但当前状态为 `paused`
- skill：`script-writer` / `SWS`

### Example D: 已有结构化分镜稿

- 输入：用户上传结构完整的 docx/excel 稿，目标是转标准剧本结构
- 路由：`structured_storyboard_transform`
- skill：`script-adapt`
