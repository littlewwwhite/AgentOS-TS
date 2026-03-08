# AI 漫剧剧本创作流水线

创作 AI 漫剧剧本（抖音竖屏微短剧，单集 60 秒），支持两种输入：
- **原创**：从创意概念、灵感文件或用户想法出发，从 0 到 1 创作
- **改编**：将长篇小说改编为短剧剧本

产出可指导 AI 生成画面的结构化剧本。

## 流水线概览

```
Phase 1 分析设计  →  Phase 2 写作  →  Phase 3 结构解析
  (design.json+catalog.json)  (ep*.md)  (script.json)
```

每个阶段产物写入工作区，实现阶段间数据流转与质量追溯。

---

## 阶段路由

所有 reference 文件已通过 loader 预加载，在 prompt 的 `## Reference Documents` 节中以 `## {filename}` 标题形式提供。进入某阶段时，直接参考对应节的内容，无需运行时读取文件。

| 阶段 | 参考预加载的 Reference Documents 中对应节 | 产物 |
|------|------------------------------------------|------|
| **Phase 1** 分析设计 | `## phase1-design.md` + `## shared-domain.md` + `## style-options.md` | draft/design.json + draft/catalog.json |
| **Phase 2** 写作 | `## phase2-writing.md` + `## writing-rules.md` + `## script-format.md` | draft/episodes/ep\*.md |
| **Phase 3** 结构解析 | `## phase3-extraction.md` | output/script.json |

---

## 工作区管理

### 命名规则

工作区文件夹以小说文件名（去掉扩展名）命名。例如输入 `傻子.txt`，工作区为 `傻子/`。

### 工作区结构

```
{小说名}/                             <- 项目文件夹 = 小说名
├── source.txt                        <- 原文副本
├── draft/
│   ├── design.json                   <- Phase 1（世界观 + 分集大纲 + 视觉风格）
│   ├── catalog.json                  <- Phase 1（资产清单）
│   └── episodes/
│       └── ep{NN}.md                 <- Phase 2（场记格式）
└── output/
    └── script.json                   <- Phase 3（结构化剧本）
```

### 工作区操作

- **初始化**：收到原文后，以小说名创建工作区文件夹，保存原文至 `source.txt`
- **阶段保存**：每个阶段确认后，自动将交付物写入对应目录
- **检查点更新**：每次阶段流转时更新检查点状态

### 上下文恢复

当用户清理上下文（`/clear`）后继续时，按以下顺序检查工作区文件以恢复流水线状态：

1. 检查 `draft/design.json` + `draft/catalog.json` → 存在则 Phase 1 完成
2. 检查 `draft/episodes/` 目录（至少一个 ep*.md）→ 存在则 Phase 2 完成
3. 检查 `output/script.json` → 存在则 Phase 3 完成（NTS 完成）

根据恢复结果，提示用户进入下一阶段。

---

## 阶段间数据流

| 阶段 | 输入 | 输出 | 工作区文件 |
|------|------|------|-----------|
| Phase 1 分析设计 | source.txt | design.json + catalog.json | draft/*.json |
| Phase 2 写作 | draft/design.json + draft/catalog.json | ep\*.md | draft/episodes/\*.md |
| Phase 3 结构解析 | draft/episodes/ep\*.md + draft/catalog.json | script.json | output/script.json |

### 依赖矩阵

| 目标阶段 | 前置文件 |
|---------|---------|
| Phase 1 | source.txt |
| Phase 2 | draft/design.json + draft/catalog.json |
| Phase 3 | draft/episodes/（至少 1 个 ep\*.md） |

---

## 编排逻辑

### 启动流程

收到小说原文（长文本）时：

1. 以小说文件名（去掉扩展名）创建工作区文件夹
2. 将原文保存至工作区的 `source.txt`
3. 展示流水线架构概览
4. 参考 Phase 1 对应的预加载 Reference Documents，开始分析设计

### 阶段流转

每个阶段完成后：

1. 将交付物保存至对应工作区目录
2. 提示下一阶段

### 状态查询

收到"状态"指令时：

1. 按上下文恢复逻辑检查各阶段文件是否存在
2. 展示流水线进度面板（Phase 1/2/3 状态 + 当前工作区路径 + 下一步引导）

### 跳转逻辑

收到"跳转阶段 {N}"或"跳转 Phase {N}"指令时：

1. 检查依赖矩阵——前置文件是否存在
2. 依赖缺失：告知需先完成哪些阶段
3. 依赖满足：参考目标阶段对应的预加载 Reference Documents 并开始

---

## 用户输入路由

解析用户输入，判断操作：

1. **长文本（小说）**：初始化工作区 → 保存原文 → 进入 Phase 1
2. **"状态"**：检查文件 → 展示状态面板
3. **"下一步" / "继续"**：检查进度 → 进入下一阶段
4. **"跳转阶段 {N}"**：检查依赖 → 进入目标阶段
5. **无输入**：检查工作区是否存在 → 存在则展示状态，不存在则提示提供原文
6. **阶段指令**（如"开始 Phase 2"、"进入写作"）：路由至对应阶段
7. **"从第 N 集开始"**（Phase 2 期间）：传递给 Phase 2 执行分段写作
