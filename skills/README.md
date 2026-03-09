# Skills

AgentOS 的 Skill 目录。每个子目录是一个独立的 skill —— 一组指令，教 Claude 如何执行特定工作流。

> 编写参考：`docs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf`

---

## Part I — 编写规范

本节定义在此仓库中创建和维护 skill 的**强制性约定**。

### 1. 渐进式加载

Skill 使用三级加载机制，最小化 token 消耗：

| 层级 | 位置 | 加载时机 | 用途 |
|------|------|---------|------|
| **L1** | YAML frontmatter | 始终（注入 system prompt） | Claude 判断是否激活此 skill |
| **L2** | SKILL.md 正文 | Skill 被 Claude 激活时 | 完整工作流指令 |
| **L3** | `references/`, `resources/`, `assets/` | SKILL.md 中显式要求时 | 详细文档、数据、模板 |

**核心原则**：SKILL.md 是**路由中枢**，不是知识仓库。详细内容移入 L3。

### 2. 文件结构

```
your-skill-name/               # 仅限 kebab-case
├── SKILL.md                    # 必需 — 主指令文件
├── scripts/                    # 可选 — 可执行代码（Python, Bash）
│   ├── auth.py
│   └── submit_task.py
├── references/                 # 可选 — 工作流指引、API 规范（按阶段加载）
│   ├── api.md
│   └── phase1-guide.md
├── resources/                  # 可选 — 共享知识库（加载一次，跨阶段复用）
│   └── writing-rules.md
└── assets/                     # 可选 — 输出模板、静态数据
    └── report-template.md
```

**命名规则：**

| 类型 | 规范 | 正确 | 错误 |
|------|------|------|------|
| Skill 文件夹 | `kebab-case` | `image-create` | `Image_Create` |
| 主文件 | 严格 `SKILL.md` | `SKILL.md` | `skill.md`, `SKILL.MD` |
| 脚本 | `snake_case.py` | `submit_task.py` | `submitTask.py` |
| 参考文档 | `kebab-case.md` | `phase3-extraction.md` | `Phase3Extraction.md` |

**Skill 文件夹内禁止包含：**
- `README.md` — 所有文档放在 SKILL.md 或 references/ 中
- `.env` 文件 — 在 SKILL.md 中记录所需环境变量，实际值放在外部
- `node_modules/`, `__pycache__/` — 已在 `.gitignore` 中

### 3. YAML Frontmatter（必需）

每个 SKILL.md **必须**以 YAML frontmatter 开头。这是 L1 触发机制。

```yaml
---
name: your-skill-name
description: >
  What it does. Use when user says "trigger phrase A" or "trigger phrase B".
  Key capabilities and scope boundaries.
---
```

**字段说明：**

| 字段 | 必需 | 规则 |
|------|------|------|
| `name` | 是 | `kebab-case`，必须与文件夹名一致 |
| `description` | 是 | 1024 字符以内，禁止 XML 标签（`<` 或 `>`），必须包含触发短语 |
| `allowed-tools` | 可选 | 限制可用工具：`["Read", "Write", "mcp__server__tool"]` |
| `model` | 可选 | 覆盖模型：`sonnet`, `opus` |
| `argument-hint` | 可选 | CLI 参数提示：`<video-file-path>` |
| `metadata.version` | 推荐 | SemVer：`1.0.0` |
| `metadata.author` | 推荐 | 作者名 |
| `metadata.mcp-server` | 如适用 | Skill 引用的 MCP server 名称 |

**description 公式：**

```
[做什么] + [何时触发 — 包含用户会说的触发短语] + [核心能力 / 适用范围]
```

```yaml
# 好 — 具体、可操作、有触发词
description: >
  AI short-drama script adaptation pipeline (novel-to-script).
  Use when user says "adapt novel", "novel-to-script", or provides
  source text for drama conversion. Three-phase: design extraction,
  episode writing, structural parsing. Outputs script.json.

# 差 — 模糊，无触发词
description: Helps with script writing.

# 差 — 过度技术化，无用户短语
description: Implements the NTSV2 pipeline with 3-phase extraction.
```

### 4. SKILL.md 正文结构

遵循以下章节顺序。每节篇幅与其复杂度匹配 — 简单的写几行，复杂的写一段。

```markdown
---
name: your-skill-name
description: ...
---

# {Skill 名称}

{一句话说明用途。}

## 前置条件

- 环境变量：`API_KEY`, `SECRET`
- 外部工具：`ffmpeg`, `python3`
- MCP 服务：`mcp-server-name`

## 资源清单

| 文件 | 用途 | 加载策略 |
|------|------|---------|
| `references/api.md` | 完整 API 规范 | 按需 |
| `references/phase1-guide.md` | Phase 1 工作流 | 按需（进入 Phase 1 时） |
| `resources/writing-rules.md` | 写作规范 | 一次（启动时加载） |
| `scripts/auth.py` | Token 管理 | 按需 |

## 工作流

### Step 0: 初始化
{启动前需要检查/设置的内容}

### Step 1: {阶段名}
{清晰的指令，含预期输入与输出}

### Step N: {最终阶段}
{完成标准}

## 硬性规则

1. CRITICAL: {不可违反的约束}
2. MUST: {必须遵守的行为}
3. NEVER: {禁止的操作}

## 错误处理

### {错误类型}
- **原因**：{为何发生}
- **解决**：{如何修复}

## 上下文恢复

会话重启后，检查工作区状态以确定恢复点。
```

### 5. 体积预算

| 组件 | 目标 | 硬限制 |
|------|------|--------|
| SKILL.md 总行数 | < 500 行 | 800 行 |
| SKILL.md 字数 | < 3,000 词 | 5,000 词 |
| 单个 reference 文件 | < 8,000 词 | 15,000 词 |
| 如 reference 超 15K 词 | 拆分为多个文件 | — |

**原因**：过大的 SKILL.md 会降低 Claude 的指令遵循质量。详细内容移入 L3。

### 6. 指令编写要领

**具体可执行，不模糊：**

```markdown
# 好
Run `python ${CLAUDE_SKILL_DIR}/scripts/auth.py` to obtain a token.
If it returns "token_expired", run `python ${CLAUDE_SKILL_DIR}/scripts/login.py`.

# 差
Make sure authentication works before proceeding.
```

**硬性约束用 `CRITICAL:`、`MUST`、`NEVER` 标记：**

```markdown
## 硬性规则
1. CRITICAL: 模型列表接口全程只调用**一次** — 缓存结果
2. 用户 MUST 显式选择模型；NEVER 假设默认值
3. NEVER 将原始 API 错误直接暴露给用户
```

**显式引用 L3 资源：**

```markdown
Before writing queries, consult `references/api-patterns.md` for:
- Rate limiting guidance
- Pagination patterns
- Error codes and handling
```

**避免含糊措辞：**

```markdown
# 差
Validate the data before proceeding.

# 好
CRITICAL: Before calling create_project, verify:
- Project name is non-empty
- Episode count is between 1 and 100
- Source text exists at {workspace}/source.txt
```

### 7. 工作区与路径约定

对操作项目工作区的 skill：

```markdown
## 工作区结构

所有路径相对于 `{workspace}/`（运行时注入）：

{workspace}/
├── draft/              # 工作文件（各阶段的输入）
│   ├── design.json
│   ├── catalog.json
│   └── episodes/ep*.md
└── output/             # 最终交付物
    └── script.json
```

- 始终使用 `{workspace}/` 占位符 — **禁止**硬编码绝对路径
- 脚本路径使用 `${CLAUDE_SKILL_DIR}/scripts/`
- Token/认证文件放到 `~/.config/{service}/` — 不放在工作区内

**上下文恢复**（多阶段 skill 必需）：

```markdown
## 上下文恢复

`/clear` 或会话重启后，检查工作区状态：
1. `{workspace}/draft/design.json` 存在 → Phase 1 已完成
2. `{workspace}/draft/episodes/ep*.md` 存在 → Phase 2 已完成
3. `{workspace}/output/script.json` 存在 → Phase 3 已完成
从下一个未完成的阶段继续。
```

### 8. 脚本约定

```python
# 可移植路径引用
import sys, os
sys.path.insert(0, os.path.join(os.environ.get('CLAUDE_SKILL_DIR', '.'), 'scripts'))
```

- 文件名：`snake_case.py`
- 长时间任务：轮询脚本使用 `run_in_background: true`
- 认证模式：由 `scripts/auth.py` 管理 token，持久化到 `~/.config/`，401 时自动刷新
- 所有脚本必须优雅处理错误，输出可操作的提示信息

### 9. MCP 集成

当 skill 编排 MCP 工具时：

```markdown
## 使用的 MCP 工具

| 工具 | 用途 | 阶段 |
|------|------|------|
| `mcp__script__parse_script` | 将 episodes 解析为 script.json | Phase 3 |
```

- 工具名**大小写敏感** — 须与 MCP server 文档核对
- 为每个工具调用记录预期输入/输出
- 包含连接拒绝 / 超时的错误处理
- MCP 工具可从 `allowed-tools` 模式自动推断（`mcp__<server>__<tool>`）

### 10. 语言规则

| 上下文 | 语言 |
|--------|------|
| YAML frontmatter (`name`) | English |
| YAML frontmatter (`description`) | English（如需可包含中文触发短语） |
| SKILL.md 正文 | 简体中文 |
| 代码、命令、标识符 | English |
| Reference 文档正文 | 简体中文 |
| 文件名 | English |

### 11. 质量检查清单

合入新增或修改的 skill 前逐项确认：

- [ ] **Frontmatter**：有 `name` + `description`；`name` 与文件夹名一致
- [ ] **Description**：包含用户触发短语，1024 字符以内，无 XML
- [ ] **体积**：SKILL.md 800 行以内；详细内容已移入 references/
- [ ] **工作流**：带编号的步骤，每步有清晰的输入/输出
- [ ] **硬性规则**：硬约束以 CRITICAL/MUST/NEVER 标记
- [ ] **资源清单**：references/、resources/、scripts/ 中的所有文件均已列出，含加载策略
- [ ] **无硬编码路径**：使用 `{workspace}/` 或 `${CLAUDE_SKILL_DIR}`
- [ ] **错误处理**：常见失败场景已记录原因/解决方案
- [ ] **脚本**：`snake_case.py`，错误优雅处理，输出可操作信息
- [ ] **测试**：已手动验证 skill 能被预期的用户查询触发

---

## Part II — 架构概览

### 数据管线（DAG）

```
小说 / 创意
    │
    ├─► script-writer（SWS 原创 / NTSV2 改编）
    │       产出: s7-scripts.md（需转换）
    │
    ├─► script-adapt（3 阶段直转）
    │       产出: script.json + catalog.json + design.json
    │
    └───────────────┬──────────────────────────┐
                    ▼                          ▼
             image-create/edit          kling-video-prompt
             (角色/场景/道具              (剧本 → 镜头提示词)
              资产图生成)                      │
                    │                   ep{XX}_shots.json
                    │                          │
                    └──────────┬───────────────┘
                               ▼
                          video-create
                          (资产上传 + 视频生成)
                               │
                               ▼
                          video-review
                          (六级评审 + 自动重生成)
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
               合格 → 继续          不合格 → 优化提示词
                    │                → video-create 重生成
                    ▼
               music-matcher
               (视频分析 → 向量匹配 → 配乐合成)
                    │
                    ▼
               最终视频交付
```

辅助链路：
- `music-finder` → `music-matcher`（音乐风格查询服务）
- `skill-creator`（元 skill，用于创建新 skill）

### 核心数据合约

管线各阶段通过文件通信。以下合约**不可破坏**：

| 合约文件 | 上游 | 下游 | 格式 |
|----------|------|------|------|
| `script.json` | script-adapt (Phase 3) | kling-video-prompt | JSON (episodes > scenes > actions) |
| `catalog.json` | script-adapt (Phase 1) | 全管线（角色/地点 ID 映射） | JSON |
| `design.json` | script-adapt (Phase 1) | 全管线（世界观 + 视觉风格） | JSON |
| `ep{XX}_shots.json` | kling-video-prompt | video-create, video-review | JSON (segments 数组) |

### 项目工作区目录

```
project-workspace/
├── 01-script/output/         # 剧本产物
│   ├── script.json
│   ├── design.json
│   ├── catalog.json
│   └── episodes/ep*.md
├── 02-assets/output/         # 图片资产
│   ├── characters/
│   ├── scenes/
│   └── props/
└── 03-video/                 # 视频 + 评审
    ├── workspace/input  → symlink → 01-script/output/
    ├── workspace/assets → symlink → 02-assets/output/
    └── output/ep{XX}/ep{XX}_shots.json
```

### Skill 间通信

Skill 之间**不直接通信**，协作机制如下：

1. **文件合约** — 上游写入约定路径，下游从该路径读取
2. **Symlink 桥接** — `03-video/workspace/` 通过 symlink 指向上游输出
3. **用户编排** — 用户按管线顺序逐个调用 skill
4. **共享认证** — image-create/image-edit/video-create 共享 `~/.animeworkbench_auth.json`

### 共享资源

以下文件在多个 skill 中存在副本，修改时需同步：

| 文件 | 存在于 |
|------|--------|
| `writing-rules.md` | script-writer/resources/, script-adapt/references/ |
| `shared-domain.md` | script-writer/resources/, script-adapt/references/ |
| `style-options.md` | script-writer/resources/, script-adapt/references/ |

---

## Part III — Skill 索引

### 剧本层

| Skill | 阶段数 | 输入 | 输出 |
|-------|--------|------|------|
| `script-writer` | 9 (S1-S9) | 用户创意或小说 | `s7-scripts.md` |
| `script-adapt` | 3 (P1-P3) | source.txt | `script.json` + `catalog.json` + `design.json` |

### 资产层

| Skill | 类型 | API 地址 |
|-------|------|----------|
| `image-create` | 图片生成 | `animeworkbench-pre.lingjingai.cn` |
| `image-edit` | 图片编辑 | `animeworkbench-pre.lingjingai.cn` |

### 视频层

| Skill | 类型 | 核心特性 |
|-------|------|---------|
| `kling-video-prompt` | 提示词生成 | script.json → 双语镜头提示词 |
| `video-create` | 视频生成 | `animeworkbench.lingjingai.cn` |
| `video-review` | 质量评审 | 六级规则体系 + 自动重生成闭环 |

### 音频层

| Skill | 类型 | 核心特性 |
|-------|------|---------|
| `music-matcher` | 智能配乐 | Gemini 分析 → 向量匹配 → FFmpeg 合成 |
| `music-finder` | 风格数据库 | RateYourMusic 5,947 种风格 |

### 元工具

| Skill | 用途 |
|-------|------|
| `skill-creator` | 创建新 skill 的指南 |
