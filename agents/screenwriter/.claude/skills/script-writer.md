---
name: script-writer
description: "微短剧剧本写作流水线：支持原创（SWS）和改编扩写（NTSV2）两种模式，通过九阶段流程产出可指导 AI 生成画面的结构化剧本。当用户提到原创剧本、剧本写作、SWS、小说改编、小说扩写、NTSV2 时使用。"
---

# 微短剧剧本写作流水线

支持两种创作模式，通过九阶段流程产出可指导 AI 生成画面的抖音竖屏微短剧剧本（单集 60 秒，女频向）。

## 模式选择

启动时必须确定模式，两种模式共享 S2-S9 阶段，仅 S1 和部分策略不同。

| 维度 | 原创模式（SWS） | 改编扩写模式（NTSV2） |
|------|----------------|---------------------|
| 输入源 | 用户创意灵感（六维度） | 短篇小说原文（≤1万字） |
| S1 任务 | 创意构思 → `s1-ideation.md` | 原文分析与灵感提取 → `s1-analysis-extraction.md` |
| S1 交付物模板 | `assets/s1-deliverables-original.md` | `assets/s1-deliverables-expand.md` |
| 原文依赖 | 无 | S1-S4 全程参考 novel.txt |
| 扩写能力 | 无 | 六维度扩写（`resources/expansion-rules.md`） |
| 目标集数 | 用户指定 | 50-60 集 |
| 协议 | SWS v1.0（`resources/sws-protocol.md`） | NTSV2 v1.0（`resources/ntsv2-protocol.md`） |
| 工作区 | `sws-workspace/` | `ntsv2-workspace/` |

### 模式判定规则

- 用户提到"原创"、"创作"、"SWS"、"从零开始" → **原创模式**
- 用户提供小说原文或提到"改编"、"扩写"、"NTSV2"、"小说转剧本" → **改编扩写模式**
- 不确定时主动询问用户

---

## 流水线概览

```
S1 → S2 基础设定 → S3 故事大纲 → S4 角色开发 → S5 进度追踪 → S6 单集细纲 → S7 逐层写作 → S8 润色终审 → S9 格式交付
```

- **S1-S4**：创意/分析阶段（S1 因模式不同，S2-S4 共享）
- **S5-S6**：结构准备阶段（追踪工具 → 节拍表/场景清单）
- **S7-S9**：生产交付阶段（写作 → 审核 → 交付）

每个阶段产出的交付物使用对应协议标记，保存至工作区目录。

---

## 扩写模式（仅改编扩写模式）

改编扩写模式的核心特色，处理短篇小说向 50-60 集微短剧的大规模扩写。

### 六维度扩写

当扩写模式开启时，以下维度在 S3 阶段自动激活：

1. **主线细化**：将原文主线事件拆解为更细致的场景和情绪微循环
2. **支线补写**：基于原文角色和世界观，创造全新支线剧情
3. **角色深化**：为原文中简略的角色补充背景、动机、弧光
4. **世界观补足**：扩展原文中仅做概述的世界设定
5. **情感扩写**：拉长情感节奏，增加暧昧、纠结、误会等情感波动
6. **冲突升级**：在原文冲突基础上增加新的对抗层次

### 模式切换

- **默认**：开启（适用于≤1万字短篇）
- **关闭**：适用于原文体量已经充足、仅需结构改编的情况
- 用户可在 S1 确认时选择，运行中可随时通过指令切换

### 扩写模式对各阶段的影响

| 阶段 | 扩写模式开启 | 扩写模式关闭 |
|------|------------|------------|
| S1 | 输出扩写可行性评估 + 扩写维度推荐 | 仅输出原文分析 |
| S2 | 在原文基础上扩展世界观设定 | 忠实还原原文设定 |
| S3 | 激活六维度扩写规划，生成 50-60 集大纲 | 仅做结构改编，集数由原文体量决定 |
| S4 | 补充原创配角、深化原文角色 | 忠实还原原文角色 |
| S5-S9 | 追踪扩写内容与原文的一致性 | 标准追踪 |

---

## 阶段路由

进入某阶段时，按需加载对应文件。只加载当前阶段所需，不预加载全部。

**加载策略：**

1. **必加载**（无标记）：进入该阶段时立即读取
2. **按需加载**（标记 `^按需^`）：仅在当前任务确实需要参考时才读取
3. **首次加载**（标记 `首次...读取一次`）：整个流水线生命周期内只读取一次
4. **工作区文件**（`{workspace}/` 前缀）：从用户项目工作区读取

**加载顺序**：工作流指引（references/）→ 共享知识（resources/）→ 输出模板（assets/，输出交付物时才读取）

| 阶段 | 工作流指引（references/） | 共享知识（resources/） | 输出模板（assets/） |
|------|--------------------------|----------------------|----------------------|
| **S1**（模式分支） | 原创：`s1-ideation.md` / 改编：`s1-analysis-extraction.md` | `shared-domain.md` + `style-options.md` + 改编模式追加：`expansion-rules.md` + `{workspace}/novel.txt` + `genre-database.md`^按需^ + `trope-library.md`^按需^ | 原创：`s1-deliverables-original.md` / 改编：`s1-deliverables-expand.md` |
| **S2** 基础设定 | `s2-setting.md` | `shared-domain.md` + 改编模式追加：`{workspace}/novel.txt` | `s2-deliverables.md` |
| **S3** 故事大纲 | `s3-outline.md` | `shared-domain.md` + 改编模式追加：`expansion-rules.md` + `{workspace}/novel.txt` + `trope-library.md`^按需^ | `s3-deliverables.md` |
| **S4** 角色开发 | `s4-character.md` | `shared-domain.md` + 改编模式追加：`{workspace}/novel.txt` | `s4-deliverables.md` |
| **S5** 进度追踪 | `s5-tracking.md` | — | `s5-deliverables.md` |
| **S6** 单集细纲 | `s6-episode-outline.md` | `writing-rules.md` + `shared-domain.md` | `s6-deliverables.md` |
| **S7** 逐层写作 | `s7-writing.md` | `writing-rules.md` + `shared-domain.md` + 改编模式追加：`expansion-rules.md`^按需^ + `{workspace}/anchor.md` + `{workspace}/style-guide.md` + `{workspace}/s6-episode-outline.md` + `{workspace}/s3-outline.md` + `{workspace}/s5-tracking.md` + `{workspace}/s4-character.md`^按需^ + 改编模式追加：`{workspace}/novel.txt`^按需^ | `s7-deliverables.md` |
| **S8** 润色终审 | `s8-polish.md` | `writing-rules.md` + `{workspace}/style-guide.md` + `{workspace}/anchor.md` + 改编模式追加：`{workspace}/s7-scripts.md` | `s8-deliverables.md` |
| **S9** 格式交付 | `s9-delivery.md` | — | `s9-deliverables.md` |
| 协议格式 | — | 原创：`sws-protocol.md` / 改编：`ntsv2-protocol.md`（首次输出交付物时读取一次） | — |
| 风格指南生成 | — | — | `style-guide-template.md`（S1 确认后生成） |
| 记忆库（全阶段） | — | `memory-bank-rules.md`（首次触发时读取一次） + `{workspace}/memory-banks/{项目名}_{测试人}.md` | `memory-bank-template.md`（首次初始化时读取） |

> `{workspace}` = 原创模式用 `sws-workspace/`，改编模式用 `ntsv2-workspace/`

---

## 工作区管理与编排逻辑

详见 `references/orchestration.md`（工作区结构、操作、上下文恢复、启动流程、阶段流转、状态查询、跳转逻辑、用户输入路由）。

---

## 硬编码约束（全流水线共享）

以下参数全流水线锁定：

- **平台**：抖音
- **形态**：竖屏微短剧
- **单集时长**：60 秒
- **目标受众**：女频
- **对白策略**：默认启用旁白/OS/五类功能标签

以下参数因模式而异：

| 参数 | 原创模式 | 改编扩写模式 |
|------|---------|------------|
| 创作模式 | 原创 | 改编扩写 |
| 目标集数 | 用户指定 | 50-60 集 |
| 扩写模式 | 不适用 | 可选（默认开启） |
| 协议版本 | SWS v1.0 | NTSV2 v1.0 |
| 工作区 | sws-workspace/ | ntsv2-workspace/ |
