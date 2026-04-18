---
name: script-writer
description: "原创/扩写剧本流水线（9阶段）：支持从零原创（SWS）或将短篇小说（≤1万字）扩写为50-60集长剧（NTSV2），通过完整九阶段流程开发角色与剧情，并在改编模式下保持原文对齐与高保真动作表达。仅当用户明确提到扩写、NTSV2、SWS、原创剧本、从零创作时使用。不适用于小说转剧本（请用 script-adapt）。"
---

# 微短剧剧本写作流水线

支持两种创作模式，通过九阶段流程产出可指导 AI 生成画面的抖音竖屏微短剧剧本（单集 60 秒）。在改编扩写模式下，写作阶段必须同时兼顾扩写能力、原文信息对齐与可直接服务后续提示词生成的动作保真度。

## 🔴 Language Rule (applies to ALL stages)

> 完整规则见 `references/shared-language-rules.md`（进入任何写作阶段前 Read 一次）。
> 该文件位于 script-adapt skill 中，路径：`.claude/skills/script-adapt/references/shared-language-rules.md`

## 前置检查

### 步骤 0-A: 环境检查

```bash
python3 -c "
import sys, os, importlib
missing = []
for mod, pkg in {'dotenv': 'python-dotenv'}.items():
    try: importlib.import_module(mod)
    except ImportError: missing.append(pkg)
if not os.getenv('GEMINI_API_KEY'):
    missing.append('GEMINI_API_KEY 环境变量未设置')
if missing:
    print(f'缺少依赖: {\", \".join(missing)}')
    sys.exit(1)
else:
    print('所有依赖已就绪')
"
```

> 若 `GEMINI_API_KEY` 未设置，请在终端执行 `export GEMINI_API_KEY=your-key` 或在项目 `.env` 文件中配置。

### 步骤 0-B: 素材检查

- **原创模式（SWS）**：确认用户已提供创意灵感或概念描述，无需原文文件。
- **改编扩写模式（NTSV2）**：确认短篇小说原文已准备好（≤ 1 万字），支持 `.txt`、`.md` 格式。

---

## 模式选择

启动时必须确定模式，两种模式共享 S2-S9 阶段，仅 S1 和部分策略不同。

| 维度 | 原创模式（SWS） | 改编扩写模式（NTSV2） |
|------|----------------|---------------------|
| 输入源 | 用户创意灵感（六维度） | 短篇小说原文（≤1万字） |
| S1 任务 | 创意构思 → `s1-ideation.md` | 原文分析与灵感提取 → `s1-analysis-extraction.md` |
| S1 交付物模板 | `assets/s1-deliverables-original.md` | `assets/s1-deliverables-expand.md` |
| 原文依赖 | 无 | S1-S4 全程参考 novel.txt |
| 原文结构检测 | 不适用 | S1 前置步骤，生成 `${PROJECT_DIR}/workspace/draft/source-structure.json` |
| 扩写能力 | 无 | 六维度扩写（`references/expansion-rules.md`） |
| 目标集数 | 用户指定 | 由原文体量与扩写策略决定（不设硬性上限） |
| 协议 | SWS v1.0（`references/sws-protocol.md`） | NTSV2 v1.0（`references/ntsv2-protocol.md`） |
| 工作区 | `${PROJECT_DIR}/workspace/` | `${PROJECT_DIR}/workspace/` |

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

## Expansion Mode (adaptation-expansion only)

Supports 6-dimension expansion. See `references/expansion-rules.md`.
User can toggle during S1 confirmation; switchable at runtime.

---

## 阶段路由

进入某阶段时，按需加载对应文件。只加载当前阶段所需，不预加载全部。

**文件位置：**

- **工作流指引**（references/）：`references/` — 用 `Read` 加载
- **共享知识**（references/）：`references/` — 用 `Read` 加载
- **输出模板**（assets/）：`assets/` — 输出交付物时用 `Read` 加载
- **确定性脚本**（scripts/）：`scripts/` — 用 `Bash` 调用

### Bundled Scripts

| Script | Purpose |
|--------|---------|
| `detect_source_structure.py` | NTSV2 模式 S1 前置：检测原文章节边界，写入 `${PROJECT_DIR}/workspace/draft/source-structure.json` |

```bash
python3 ./.claude/skills/script-writer/scripts/detect_source_structure.py --project-path <dir> [--max-chars 8000]
```

**加载策略：**

1. **必加载**（无标记）：进入该阶段时立即读取
2. **按需加载**（标记 `^按需^`）：仅在当前任务确实需要参考时才读取
3. **首次加载**（标记 `首次...读取一次`）：整个流水线生命周期内只读取一次
4. **工作区文件**（`{workspace}/` 前缀）：从用户项目工作区读取

**加载顺序**：工作流指引（references/）→ 共享知识（references/）→ 输出模板（assets/，输出交付物时才读取）

| 阶段 | 工作流指引（references/） | 共享知识（references/） | 输出模板（assets/） |
|------|--------------------------|------------------------|----------------------|
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

> `{workspace}` = `${PROJECT_DIR}/workspace/`（两种模式共用同一工作区）

### NTSV2 写作入口硬约束

以下约束仅对**改编扩写模式（NTSV2）**生效，尤其在 S7 写作与 S8 润色阶段必须执行：

1. **原文对齐优先**：若 `${PROJECT_DIR}/workspace/draft/source-structure.json` 存在，涉及原文改编的写作与润色必须据此定位原文片段，不得只凭记忆概括。
2. **action 必须高保真**：动作行不得写成“她很痛苦”“两人争执”这类摘要句，必须落到可拍、可演、可切镜的具体行为、反应与状态变化。
3. **压缩不压缩有效信息**：允许压缩重复修辞、低价值过渡与冗长心理铺陈，但不得压缩人物动机、关系变化、关键行为链、关键对白与关键意象。
4. **为后续提示词保留锚点**：凡是会提升后续 `actions[]` / `shots[].prompt` 质量的细节，如手势、视线、站位、停顿、道具状态变化，优先保留到剧本文本里。
5. **以 S7/S8 规则为准**：进入 S7/S8 时，`references/s7-writing.md` 与 `references/writing-rules.md` 是逐层写作与润色的执行真相源，上述约束用于补足入口级提醒，不替代下游细则。

---

## 工作区管理与编排逻辑

详见 `references/orchestration.md`（工作区结构、操作、上下文恢复、启动流程、阶段流转、状态查询、跳转逻辑、用户输入路由）。

---

## S7 执行策略（串行 vs 并行）

🔴 **进入 S7 前必须先执行以下判断：**

1. 读取 `${PROJECT_DIR}/workspace/s6-episode-outline.md` 确定总集数，记为 `total_episodes`
2. **若 total_episodes ≤ 5**：在当前 session 中逐集写作（按 `references/s7-writing.md` 三轨工作流）
3. **若 total_episodes > 5**：**必须**使用 Agent subagents 并行写作（见下方）

**并行写作流程（total_episodes > 5 时强制执行）：**

```
读取 s6-episode-outline.md → total_episodes = N
分组：ceil(N / 3) 个 Agent，上限 10
每个 Agent 输出独立文件 workspace/draft/episodes/ep{NN}.md
并行启动所有 Agent（run_in_background: true）
等待全部完成 → 合并至 s7-scripts.md → S8
```

每个 Agent subagent 的 prompt **必须包含**：
1. `${PROJECT_DIR}/workspace/anchor.md`（锚点文档：创作锚点 + 风格DNA + 角色卡）
2. `${PROJECT_DIR}/workspace/s6-episode-outline.md` 中**本组集**的节拍表与场景清单
3. `${PROJECT_DIR}/workspace/style-guide.md`（风格指南）
4. `${PROJECT_DIR}/workspace/s3-outline.md` 中本组集关联的大纲段落
5. `references/writing-rules.md` + `references/script-format.md` 的格式规范
6. **严格约束声明**：「所有角色名必须与 S4 角色卡一致。跨集衔接必须与 S5 进度追踪一致。输出格式严格遵循 script-format.md。每集写入独立文件 `workspace/draft/episodes/ep{NN}.md`。」
7. NTSV2 模式追加：`source-structure.json` 中本组集关联的原文段落

> 注意：并行写作输出到 `workspace/draft/episodes/ep{NN}.md`（与 script-adapt 格式统一），全部完成后由主 session 合并至 `s7-scripts.md` 供 S8 使用。

---

## 硬编码约束（全流水线共享）

以下参数全流水线锁定：

- **平台**：抖音
- **形态**：竖屏微短剧
- **单集时长**：60 秒
- **目标受众**：由 S1 分析确认（根据输入素材推断，用户可覆盖）
- **对白策略**：默认启用旁白/OS/五类功能标签

以下参数因模式而异：

| 参数 | 原创模式 | 改编扩写模式 |
|------|---------|------------|
| 创作模式 | 原创 | 改编扩写 |
| 目标集数 | 用户指定 | 由原文体量与扩写策略决定（不设硬性上限） |
| 扩写模式 | 不适用 | 可选（默认开启） |
| 协议版本 | SWS v1.0 | NTSV2 v1.0 |
| 工作区 | ${PROJECT_DIR}/workspace/ | ${PROJECT_DIR}/workspace/ |

---

## 结构解析（S8 → S9 之间，必须执行）

S8 润色完成后、进入 S9 格式交付前，**必须**先生成机器可读的 `script.json`，供下游 pipeline 阶段（VISUAL/STORYBOARD/VIDEO 等）使用。

### 执行

S8 完成后，确保 `workspace/draft/episodes/ep*.md` 已更新为终版内容，然后调用：

```bash
python3 ./.claude/skills/script-adapt/scripts/parse_script.py --project-path ${PROJECT_DIR}/workspace --output-path ${PROJECT_DIR}/output
```

工具返回解析统计（场景数、角色数、地点数、集数），确认无误后继续 S9。

### 反降级约束

LLM **严禁**手写或手动拼装 script.json。必须且仅通过 `parse_script.py` 生成。

---

## Unified State File（pipeline-state.json）

状态文件契约遵循 CLAUDE.md §Unified State File，本 skill 的特定行为：

- **初始化**：收到创意/原文时，创建 `pipeline-state.json`，设置 `current_stage=SCRIPT`、`stages.SCRIPT.status=running`
- **S1-S8 期间**：保持 `stages.SCRIPT.status=running`（S7 开始写作后可设为 `partial`）
- **结构解析完成**：产出 `output/script.json` 后，设置 `stages.SCRIPT.status=completed`
- **门控通过**：script.json 验证无误后，设置 `stages.SCRIPT.status=validated`、`next_action=enter VISUAL`
- **S9 交付**：S9 为附加格式化输出，不影响 pipeline 状态流转

> 详细的工作区结构、上下文恢复、启动流程见 `references/orchestration.md`
