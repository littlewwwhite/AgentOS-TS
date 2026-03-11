---
name: script-adapt
description: "小说直转剧本流水线：将小说或原创概念通过三阶段（分析设计 → 写作 → 结构解析）转化为结构化 AI 漫剧剧本。当用户提到小说转剧本、简单改编、3阶段剧本、Phase 1/2/3 时使用。"
allowed-tools:
  - Read
  - Write
  - mcp__source__prepare_source_project
  - mcp__source__detect_source_structure
  - mcp__script__parse_script
model: sonnet
---

# AI 漫剧剧本创作流水线

创作 AI 漫剧剧本（抖音竖屏微短剧，单集 60 秒），支持两种输入：
- **原创**：从创意概念、灵感文件或用户想法出发，从 0 到 1 创作
- **改编**：将长篇小说改编为短剧剧本

产出可指导 AI 生成画面的结构化剧本。

## 流水线概览

```
Phase 1A 分析推荐 → CP1（用户确认） → Phase 1B 设计生成 → CP2（用户确认） → Phase 2 写作 → Phase 3 结构解析
  (改编分析报告)    (参数确认)    (design.json+catalog.json+connectivity.md) (大纲确认) (ep*.md) (script.json)
```

每个阶段产物写入工作区，CP1/CP2 为用户确认检查点，实现阶段间数据流转与质量追溯。

### 自动执行模式（默认）

除非用户明确要求"分步确认"或"需要确认"，否则跳过 CP1/CP2 检查点，用你的最佳判断自动完成所有阶段。每个 Phase 完成后直接进入下一个 Phase，不要停下来等待用户输入。

---

## Reference Loading

Reference files are in `${CLAUDE_SKILL_DIR}/script-adapt-references/`.
Use `Read` to load the files listed for each phase when entering it.

| Phase | Files to Read | Deliverables |
|-------|--------------|--------------|
| **Phase 1** | `phase1-design.md`, `shared-domain.md`, `style-options.md` | design.json + catalog.json + connectivity.md |
| **Phase 2** | `phase2-writing.md`, `writing-rules.md`, `script-format.md` | episodes/ep\*.md |
| **Phase 3** | `phase3-extraction.md` | script.json |

---

## 工作区管理

### 命名规则

工作区文件夹以小说文件名（去掉扩展名）命名。例如输入 `傻子.txt`，工作区为 `傻子/`。

### 工作区结构

```
{小说名}/                             <- 项目文件夹 = 小说名
├── source.txt                        <- 原文副本
├── draft/                            <- 中间产物（LLM 写入）
│   ├── source-structure.json         <- Phase 1 前置（原文分段与边界检测）
│   ├── design.json                   <- Phase 1（世界观 + 分集大纲 + 视觉风格）
│   ├── catalog.json                  <- Phase 1（资产清单）
│   ├── connectivity.md               <- Phase 1（跨集连贯性地图，下游 Phase 2/其他 agent 共用）
│   └── episodes/
│       └── ep{NN}.md                 <- Phase 2（场记格式）
└── output/                           <- 最终产物（工具写入）
    └── script.json                   <- Phase 3（结构化剧本）
```

### 工作区操作

- **初始化**：收到原文后，以小说名创建工作区文件夹，保存原文至 `source.txt`
- **阶段保存**：每个阶段确认后，自动将交付物写入对应目录
- **检查点更新**：每次阶段流转时更新检查点状态

### 上下文恢复

当用户清理上下文（`/clear`）后继续时，按以下顺序检查工作区文件以恢复流水线状态：

1. 检查 `draft/source-structure.json` → 存在则原文结构检测已完成
2. 检查 `draft/design.json` + `draft/catalog.json` + `draft/connectivity.md` → 全部存在则 Phase 1 完成
3. 检查 `draft/episodes/` 目录（至少一个 ep*.md）→ 存在则 Phase 2 进行中/完成
4. 检查 `output/script.json` → 存在则 Phase 3 完成（NTS 完成）

根据恢复结果，提示用户进入下一阶段。Phase 2 恢复时额外读取 source-structure.json + connectivity.md + 扫描已完成集数，从断点继续。

---

## 阶段间数据流

| 阶段 | 输入 | 输出 | 工作区文件 |
|------|------|------|-----------|
| Phase 1 分析设计 | source.txt | source-structure.json + design.json + catalog.json + connectivity.md | draft/source-structure.json + draft/*.json + draft/connectivity.md |
| Phase 2 写作 | draft/source-structure.json + draft/design.json + draft/catalog.json + draft/connectivity.md | ep\*.md | draft/episodes/\*.md |
| Phase 3 结构解析 | draft/episodes/ep\*.md + draft/catalog.json | script.json | output/script.json |

### 依赖矩阵

| 目标阶段 | 前置文件 |
|---------|---------|
| Phase 1 | source.txt |
| Phase 2 | draft/source-structure.json + draft/design.json + draft/catalog.json + draft/connectivity.md |
| Phase 3 | draft/episodes/（至少 1 个 ep\*.md） |

---

## 编排逻辑

### 启动流程

收到小说原文（长文本）时：

1. 以小说文件名（去掉扩展名）创建工作区文件夹
2. 将原文保存至工作区的 `source.txt`
3. 调用 `mcp__source__detect_source_structure` 生成 `draft/source-structure.json`
4. 展示流水线架构概览
5. Read Phase 1 的 reference 文件，开始分析设计

### 阶段流转

每个阶段完成后：

1. 将交付物保存至对应工作区目录
2. Phase 1 内含两个用户确认检查点（CP1 改编分析报告、CP2 分集大纲预览），等待用户确认后才继续
3. Phase 1 完成后不自动流转，提示用户主动进入 Phase 2
4. Phase 2 完成后提示进入 Phase 3

### 状态查询

收到"状态"指令时：

1. 按上下文恢复逻辑检查各阶段文件是否存在
2. 展示流水线进度面板（Phase 1/2/3 状态 + 当前工作区路径 + 下一步引导）

### 跳转逻辑

收到"跳转阶段 {N}"或"跳转 Phase {N}"指令时：

1. 检查依赖矩阵——前置文件是否存在
2. 依赖缺失：告知需先完成哪些阶段
3. 依赖满足：Read 目标阶段的 reference 文件并开始

---

## 用户输入路由

解析用户输入，判断操作：

1. **长文本（小说）**：初始化工作区 → 保存原文 → 进入 Phase 1A
2. **"状态"**：检查文件 → 展示状态面板
3. **"下一步" / "继续"**：检查进度 → 进入下一阶段
4. **"跳转阶段 {N}"**：检查依赖 → 进入目标阶段
5. **无输入**：检查工作区是否存在 → 存在则展示状态，不存在则提示提供原文
6. **阶段指令**（如"开始 Phase 2"、"进入写作"）：路由至对应阶段
7. **"从第 N 集开始"**（Phase 2 期间）：传递给 Phase 2 执行分段写作
8. **"确认" / "调整 {参数}"**（Phase 1 检查点期间）：处理 CP1/CP2 用户反馈，确认则继续，调整则重新生成对应内容

---

## Parser Compatibility

以下约束为硬性约束，不得破坏：

- `draft/source-structure.json` 仅作为 Phase 1/2 的中间规划输入，**不参与** Phase 3 解析
- `draft/episodes/ep*.md` 必须继续使用现有场记格式，不得添加额外 metadata block
- `output/script.json` 的 schema 不变
- `mcp__script__parse_script` 的调用方式与 Phase 3 行为不变
