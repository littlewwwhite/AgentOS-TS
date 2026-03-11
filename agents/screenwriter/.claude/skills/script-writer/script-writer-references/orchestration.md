# SWS / NTSV2 编排逻辑

## 工作区管理

### 工作区结构

#### SWS 工作区（原创模式）

在项目根目录下创建 `sws-workspace/` 工作区：

```
{project_root}/sws-workspace/
├── s1-ideation.md             ← S1 交付物（创意概念）
├── style-guide.md             ← 风格指南（S1 确认后生成）
├── s2-setting.md              ← S2 交付物（基础设定）
├── s3-outline.md              ← S3 交付物（故事大纲）
├── s4-character.md            ← S4 交付物（角色开发）
├── anchor.md                  ← 锚点文档（S4 完成后组装）
├── s5-tracking.md             ← S5 交付物（进度追踪）
├── s6-episode-outline.md      ← S6 交付物（节拍表+场景清单）
├── s7-scripts.md              ← S7 交付物（完整剧本）
├── s8-polished.md             ← S8 交付物（终版剧本）
├── memory-banks/              ← 记忆库存储目录（每项目一文件）
│   └── {项目名}_{测试人}.md
└── checkpoint.md              ← 流水线进度检查点
```

#### NTSV2 工作区（改编扩写模式）

在项目根目录下创建 `ntsv2-workspace/` 工作区：

```
{project_root}/ntsv2-workspace/
├── novel.txt                  ← 原文小说
├── draft/                     ← 中间产物
│   └── source-structure.json  ← 原文结构检测结果（S1 第零步生成）
├── s1-analysis.md             ← S1 交付物（原文分析与灵感提取）
├── style-guide.md             ← 风格指南（S1 确认后生成）
├── s2-setting.md              ← S2 交付物（基础设定）
├── s3-outline.md              ← S3 交付物（故事大纲）
├── s4-character.md            ← S4 交付物（角色开发）
├── anchor.md                  ← 锚点文档（S4 完成后组装）
├── s5-tracking.md             ← S5 交付物（进度追踪）
├── s6-episode-outline.md      ← S6 交付物（节拍表+场景清单）
├── s7-scripts.md              ← S7 交付物（完整剧本）
├── s8-polished.md             ← S8 交付物（终版剧本）
├── memory-banks/              ← 记忆库存储目录（每项目一文件）
│   └── {项目名}_{测试人}.md
└── checkpoint.md              ← 流水线进度检查点
```

### 工作区操作

- **初始化**：收到创意输入后，自动创建工作区
- **阶段保存**：每个阶段确认后，自动将交付物写入对应文件
- **风格指南生成**：S1 确认后，基于 style-guide-template.md 生成 style-guide.md
- **检查点更新**：每次阶段流转时更新 `checkpoint.md`
- **锚点组装**：S4 确认后，自动从 S1、S2、S4 交付物中提取锚点文档写入 `anchor.md`
- **进度追踪**：S5 初始化追踪文档，S7 写作期间持续更新
- **记忆库初始化**：创建工作区时，在 `sws-workspace/memory-banks/` 目录下基于 `memory-bank-template.md` 创建 `{项目名}_{测试人}.md`
- **记忆库更新**：检测到用户修改请求时，按 `memory-bank-rules.md` 自动追加记录至 `sws-workspace/memory-banks/{项目名}_{测试人}.md` 并更新统计摘要

### 上下文恢复

当用户清理上下文（`/clear`）后继续时：

#### SWS 模式

1. 读取 `checkpoint.md` 恢复流水线状态
2. 检查各阶段文件是否存在
3. 读取 `style-guide.md` 恢复风格约束
4. 读取 `sws-workspace/memory-banks/` 中对应项目的记忆库文件，恢复修改编号计数器和历史记录
5. 提示用户进入下一阶段

#### NTSV2 模式

1. 读取 `checkpoint.md` 恢复流水线状态
2. 检查各阶段文件是否存在
3. 检查 `draft/source-structure.json` → 存在则原文结构检测已完成，读取分段策略（`source_mode`）供后续阶段使用
4. 读取 `style-guide.md` 恢复风格约束
5. 读取 `ntsv2-workspace/memory-banks/` 中对应项目的记忆库文件，恢复修改编号计数器和历史记录
6. 提示用户进入下一阶段

---

## 启动流程

### SWS 模式（原创）

收到创意输入时：

1. 创建 `sws-workspace/` 工作区，同时在 `sws-workspace/memory-banks/` 目录下基于 `memory-bank-template.md` 初始化记忆库文件（命名：`{项目名}_{测试人}.md`）
2. 展示流水线架构概览
3. 读取 S1 reference 文件，开始创意构思
4. 执行六维度扫描 → 缺失维度引导补全 → 核心元素分析 → 第一推动力判定 → 风格匹配

### NTSV2 模式（改编扩写）

收到小说原文或改编指令时：

1. 创建 `ntsv2-workspace/` 工作区（含 `draft/` 子目录），同时在 `ntsv2-workspace/memory-banks/` 目录下基于 `memory-bank-template.md` 初始化记忆库文件
2. 将原文保存至 `ntsv2-workspace/novel.txt`
3. 展示流水线架构概览
4. 调用 `python3 ${CLAUDE_SKILL_DIR}/scripts/detect_source_structure.py --project-path {project_path}` 执行原文结构检测，生成 `draft/source-structure.json`
5. 读取 S1 reference 文件（`s1-analysis-extraction.md`），开始原文分析与灵感提取

## 阶段流转

每个阶段完成并获得用户确认后：

1. 将交付物保存至工作区文件
2. 更新 `checkpoint.md`
3. 更新 `sws-workspace/memory-banks/` 中对应记忆库文件的统计摘要（按类型/阶段/满意度重新计算，提取高频模式）
4. 特殊操作：
   - S1 完成 → 额外生成 `style-guide.md`
   - S4 完成 → 额外组装 `anchor.md`（从 S1 创作锚点 + S2 风格DNA卡 + S4 角色卡）
   - S5 完成 → 初始化进度追踪文档
5. 提示下一阶段：

```
S{N} {阶段名} 已完成！交付物已保存至 sws-workspace/

当前进度：S{N}/S9 ████░░░░░░ {N*100/9:.0f}%

下一步：进入 S{N+1}
提示：如果上下文较长，可先 /clear 再继续，工作区文件会自动加载。
```

## 状态查询

收到"状态"指令时：

1. 读取 `sws-workspace/checkpoint.md`
2. 检查各阶段文件是否存在
3. 展示流水线进度面板：

```
╔══════════════════════════════════════════════╗
║          SWS 流水线状态面板                    ║
╠══════════════════════════════════════════════╣
║  ── 创意开发 ──                               ║
║  S1 创意构思    [状态]                         ║
║  S2 基础设定    [状态]                         ║
║  S3 故事大纲    [状态]                         ║
║  S4 角色开发    [状态]                         ║
║  ── 结构准备 ──                               ║
║  S5 进度追踪    [状态]                         ║
║  S6 单集细纲    [状态]                         ║
║  ── 生产交付 ──                               ║
║  S7 逐层写作    [状态]                         ║
║  S8 润色终审    [状态]                         ║
║  S9 格式交付    [状态]                         ║
╠══════════════════════════════════════════════╣
║  工作区：sws-workspace/                       ║
║  风格指南：[状态]                              ║
║  锚点文档：[状态]                              ║
║  进度追踪：[状态]                              ║
║  第一推动力：[情感/剧情]                        ║
║  核心风格：[风格代号+名称]                      ║
║  下一步：[引导]                               ║
╚══════════════════════════════════════════════╝
```

## 跳转逻辑

收到"跳转 S{N}"指令时：

1. 检查依赖矩阵——前置文件是否存在
2. 依赖缺失：告知需先完成哪些阶段
3. 依赖满足：读取目标阶段的 reference 文件并开始

---

## 用户输入路由

解析用户输入，判断操作：

1. **创意描述**（含故事想法/灵感/设定）：初始化工作区 → 进入 S1
2. **"状态"**：读取检查点 → 展示状态面板
3. **"下一步" / "继续"**：读取检查点 → 进入下一阶段
4. **"跳转 S{N}"**：检查依赖 → 进入目标阶段
5. **无输入**：检查工作区是否存在 → 存在则展示状态，不存在则提示提供创意
6. **阶段指令**（如"开始S3"、"进入写作"、"角色开发"）：路由至对应阶段
7. **"从第N集开始"**（S7 期间）：传递给 S7 执行分段写作
8. **修改请求**（含修改/调整/重写/不满意等意图）：执行修改 + 按 `memory-bank-rules.md` 触发条件判断是否记录至 `sws-workspace/memory-banks/` 记忆库文件
