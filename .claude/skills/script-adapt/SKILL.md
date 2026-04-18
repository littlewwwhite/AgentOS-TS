---
name: script-adapt
description: "长篇小说快速改编流水线（3阶段）：将体量充足的小说原文（≥3000字）通过分析设计→写作→结构解析，快速转化为结构化剧本，保留原文叙事骨架。当用户提供长篇小说原文、提到直转、简单改编、Phase 1/2/3 时使用。不适用于原创或短篇扩写。"
---

# AI 漫剧剧本创作流水线

创作 AI 漫剧剧本（抖音竖屏微短剧，单集 60 秒），支持两种输入：
- **原创**：从创意概念、灵感文件或用户想法出发，从 0 到 1 创作
- **改编**：将长篇小说改编为短剧剧本

产出可指导 AI 生成画面的结构化剧本。

## 流水线概览

```
Phase A: 分析 & 资产抽取
  Phase A1 分析推荐 → CP1（用户确认） → Phase A2 设计生成 → CP2（用户确认）
    (改编分析报告)    (参数确认)    (design.json + catalog.json)  (大纲确认)

  ══════ 用户 CRUD 检查点：可编辑 catalog.json / design.json ══════

Phase B: 剧本生成（可基于修改后的 catalog 反复执行）
  Phase B1 写作 → Phase B2 格式修复 + 解析验证 → Phase B3 结构解析
    (ep*.md)    (normalize + parse --validate)         (script.json)
```

每个阶段产物写入工作区，CP1/CP2 为用户确认检查点。Phase A 和 Phase B 之间有明确切割点，用户可在 Phase A 完成后编辑 catalog.json，然后反复运行 Phase B。

### 自动执行模式（默认）

除非用户明确要求"分步确认"或"需要确认"，否则跳过 CP1/CP2 检查点，用你的最佳判断自动完成所有阶段。每个 Phase 完成后直接进入下一个 Phase，不要停下来等待用户输入。

### 从 Phase B 重入

当用户说"重新生成剧本"、"重跑 Phase B"、"我改了 catalog"时，检查 catalog.json + design.json 存在后直接进入 Phase B，跳过 Phase A。

---

## Bundled Scripts

Deterministic Python scripts in `${CLAUDE_SKILL_DIR}/scripts/`, via `Bash` tool调用，零外部依赖（仅 Python 标准库 + 可选格式库）。

| Script | Purpose | CLI |
|--------|---------|-----|
| `prepare_source_project.py` | 将任意格式文件（txt/md/docx/xlsx/pdf）转为 `workspace/source.txt`。返回 `mode` 字段：`storyboard`（docx 含嵌入 Excel，格式转换）或 `novel`（纯文本，创作改编） | `python3 ${CLAUDE_SKILL_DIR}/scripts/prepare_source_project.py --source-path <file> --workspace-path workspace` |
| `detect_source_structure.py` | 检测原文章节/分集边界，写入 `workspace/draft/source-structure.json` | `python3 ${CLAUDE_SKILL_DIR}/scripts/detect_source_structure.py --project-path workspace [--max-chars 8000]` |
| `parse_script.py` | 解析 ep*.md 为 script.json + 内置验证报告（结构完整性 + catalog 覆盖 + 双语合规）。`--validate` 时退出码反映验证状态 | `python3 ${CLAUDE_SKILL_DIR}/scripts/parse_script.py --project-path workspace --output-path output [--validate]` |
| `plan_phase2_batches.py` | 检查已完成集数，决定 Phase B 是否并行写作。从 `source-structure.json` 读取已检测分段，写入 `draft/source_packs/group_N.md`，返回 `groups[].source_pack_path` | `python3 ${CLAUDE_SKILL_DIR}/scripts/plan_phase2_batches.py --project-path workspace` |
| `normalize_episodes.py` | **Phase B2 格式修复**：自动修正复合名、分隔符、缺失符号。输出统一 JSON 格式 | `python3 ${CLAUDE_SKILL_DIR}/scripts/normalize_episodes.py --project-path workspace` |

所有脚本输出统一 JSON 格式，供 LLM 消费：
```json
{
  "passed": true,
  "has_blocking": false,
  "fixes_applied": [...],
  "issues": [{"code": "...", "severity": "error|warning|blocking", "summary": "...", "repair_hint": "..."}],
  "repair_plan": {"steps": [{"action": "...", "detail": "..."}]},
  "stats": {...}
}
```

所有脚本结果输出到 stdout（JSON），warnings 输出到 stderr。

---

## Reference Loading

Reference files are in `${CLAUDE_SKILL_DIR}/references/`.
Use `Read` to load the files listed for each phase when entering it.

| Phase | Files to Read | Deliverables |
|-------|--------------|--------------|
| **Phase A** | `phase1-design.md`, `shared-domain.md`, `style-options.md` | design.json + catalog.json |
| **Phase B** | `phase2-writing.md`, `writing-rules.md`, `script-format.md` | episodes/ep\*.md → script.json |

---

## 工作区管理

### 命名规则

工作区固定为 `workspace/` 目录。所有中间产物写入 `workspace/`，最终产物写入 `output/`。

### 工作区结构

```
workspace/                                <- 固定工作区目录
├── source.txt                        <- 原文副本
├── draft/                            <- 中间产物（LLM 写入）
│   ├── source-structure.json         <- Phase A 前置（原文分段与边界检测）
│   ├── design.json                   <- Phase A（世界观 + 分集大纲 + 视觉风格）
│   ├── catalog.json                  <- Phase A（资产清单，用户 CRUD 锚点）
│   └── episodes/
│       └── ep{NN}.md                 <- Phase B（场记格式）
output/                               <- 最终产物
    └── script.json                   <- Phase B（结构化剧本）
```

### 工作区操作

- **初始化**：收到原文后，创建 `workspace/` 目录，保存原文至 `workspace/source.txt`
- **阶段保存**：每个阶段确认后，自动将交付物写入对应目录
- **检查点更新**：每次阶段流转时更新检查点状态

### 上下文恢复

当用户清理上下文（`/clear`）后继续时，按以下顺序检查工作区文件以恢复流水线状态：

1. 检查 `workspace/draft/source-structure.json` → 存在则原文结构检测已完成
2. 检查 `workspace/draft/design.json` + `workspace/draft/catalog.json` → 全部存在则 **Phase A 完成**（到达 CRUD 检查点）
3. 检查 `workspace/draft/episodes/` 目录（至少一个 ep*.md）→ 存在则 Phase B 进行中/完成
4. 检查 `output/script.json` → 存在则 Phase B 完成

根据恢复结果，提示用户进入下一阶段。Phase B 恢复时额外读取 source-structure.json + 扫描已完成集数，从断点继续。

---

## 阶段间数据流

| 阶段 | 输入 | 输出 | 工作区文件 |
|------|------|------|-----------|
| Phase A 分析设计 | workspace/source.txt | source-structure.json + design.json + catalog.json | workspace/draft/*.json |
| Phase B 写作 | workspace/draft/source-structure.json + workspace/draft/design.json + workspace/draft/catalog.json | ep\*.md → script.json | workspace/draft/episodes/\*.md + output/script.json |

### 依赖矩阵

| 目标阶段 | 前置文件 |
|---------|---------|
| Phase A | workspace/source.txt |
| Phase B | workspace/draft/design.json + workspace/draft/catalog.json（source-structure.json 可选，用于原文定位） |

---

## 编排逻辑

### 启动流程

收到文件时：

1. 调用 `python3 ${CLAUDE_SKILL_DIR}/scripts/prepare_source_project.py --source-path <file> --workspace-path workspace` 转换为 `workspace/source.txt`
2. 根据返回的 **`mode`** 字段选择处理路径：

| mode | 含义 | Phase 1 | Phase 2 |
|------|------|---------|---------|
| `storyboard` | 已有完整分镜（docx 含嵌入 Excel） | 从已有数据**提取** catalog（角色/地点/道具） | **格式转换**已有分镜为 ep*.md，保留原始内容 |
| `novel` | 纯文本小说/剧本 | **设计**集数结构、**创建** catalog | **创作**对白和画面描述 |

3. 调用 `python3 ${CLAUDE_SKILL_DIR}/scripts/detect_source_structure.py --project-path workspace` 生成 `workspace/draft/source-structure.json`
4. 读取 `workspace/draft/source-structure.json` 的 `planning` 字段，按以下优先级决定分集：
   - `planning.episode_source = detected_boundaries` **且** `planning.boundary_confidence = "high"` → 必须按检测结果分集，`design.json.total_episodes` = `planning.recommended_total_episodes`（仅当检测到真正的 `第N集`/`Episode N` 标记时才为 high）
   - 其余情况（`episode_source = model_required` 或 `boundary_confidence = "low"`）→ 优先遵循用户指定集数；若用户未指定，再由模型根据素材体量决定
5. Read Phase 1 的 reference 文件，按 mode 开始处理

### 阶段流转

每个阶段完成后：

1. 将交付物保存至对应工作区目录
2. **Phase A JSON 校验**：写入 design.json 和 catalog.json 后，立即执行 `python3 -m json.tool workspace/draft/design.json > /dev/null && python3 -m json.tool workspace/draft/catalog.json > /dev/null`。失败则修复 JSON 后重新写入
3. Phase A 内含两个用户确认检查点（CP1 改编分析报告、CP2 分集大纲预览），等待用户确认后才继续
4. **Phase A 完成后暂停，提示 CRUD 检查点**：告知用户可编辑 catalog.json / design.json，确认后进入 Phase B
5. Phase B 完成（parse_script.py 验证通过）后流水线完成

### Phase B 并行写作策略

Phase A 完成后，所有集可并行写作（每集仅依赖共享的 design.json / catalog.json，集间无运行时依赖）。

**触发前置检查**：先执行 `python3 ${CLAUDE_SKILL_DIR}/scripts/plan_phase2_batches.py --project-path workspace`。

- `pending_episodes = []` → 不应触发任何 Agent，说明分集文件已齐或无需补写
- `pending_episodes` 非空且 `should_spawn_agents = false` → 直接单线程补写剩余集
- `pending_episodes` 非空且 `should_spawn_agents = true` → 再按下述规则并行启动多个 Agent

**分组规则**：从 `design.json` 读取 `total_episodes`，按每组 2 集分配，上限 10 个并行 Agent。

**每个 Agent 的 prompt 必须包含**：
1. 完整的 `catalog.json` 内容（角色/地点/道具正名表）
2. 完整的 `design.json` 内容（世界观 + 全部分集大纲，供 Agent 提取跨集连贯信息）
3. `design.json` 中本组集的大纲（episodes 数组对应条目）
4. writing-rules.md + script-format.md 的格式规范
5. 🔴 **场景结构模板（每场必须严格遵循此结构）**：
   ```
   {ep}-{scene} {时间} {内/外} {地点}
   人物：{角色A}、{角色B}
   道具：{道具A}、{道具B}
   状态：{角色A【状态1】}、{角色B【状态2】}
   ▲{动作描述} → {动作描述} → {动作描述}
   角色名（情绪）：台词
   ```
   - 🔴 每场第一行必须是 `人物：`（精确前缀，不是 `登场人物：` 不是 `角色：`）
   - 🔴 状态只允许写在独立的 `状态：` 行，语法固定为 `角色【状态名】`
   - 🔴 禁止在 `人物：` 行写状态，禁止使用 `（状态名）` / `(状态名)`
   - 🔴 动作行用 `→` 衔接动作点，不用句号 `。` 分隔
   - 🔴 动作行禁止人称代词（他/她），必须写角色名
   - 🔴 每条对白上方必须有 `▲` 动作行
   - 🔴 禁止 markdown 标记（`#` `##` `---` `**`）
   - 🔴 集标记用阿拉伯数字 `第1集` 不是 `第一集`
6. 🔴 **严格约束声明**：「所有角色名、地点名、道具名必须与 catalog.json 中的 name 字段完全一致（catalog.json 是角色正名的**唯一权威来源**，aliases 仅用于 Phase 3 解析器容错，Phase 2 写作中禁止使用 aliases），禁止自创或使用别名。所有非默认角色状态必须先在 catalog.json 的 `actors[*].states` 中注册，剧本里只能使用已注册状态。状态标注只允许 `状态：角色【状态名】`，禁止 `人物：角色【状态】`、`角色（状态）`、`角色（身份）（状态）`。场景头禁止使用 markdown 标记（如 `#` `##` `---`），必须为纯文本格式：`{ep}-{scene} {时间} {内/外} {地点}`。`▲` 后紧跟文字，不加空格。每个 `→` 前后的动作点必须是完整的主谓宾结构（主语+动词+宾语/补语），禁止：① 无主语感叹（"月光洒落"）② 纯形容词（"衣衫褴褛"）③ 抽象状态（"空气凝固"）④ 动作指向模糊（"走过去"）⑤ 无施动主语的被动句（"铁门被撞开"，须改为"近卫军将铁门撞开"）⑥ 器物/身体部位独立做主语（"剑锋挑起下巴"，须改为"赛勒斯以剑锋挑起罗莎琳德下巴"）。🔴 动作行（`▲` 行）中**严禁使用人称代词（他/她/它/他们/她们）**——每个 `→` 两侧都必须有独立的角色名作为主语，不得依赖上文推断。」
7. 🔴 **道具标注规则**：每场写完后，扫描该场所有 `▲` 画面行和对白行，如果提及了 catalog.json props[] 中的任何道具，在 `人物：` 行之后添加 `道具：道具名1、道具名2`。未提及则不写道具行。
8. 🔴 **单场最小容量**：每场至少 4 个 action（≈12 秒）。不足 4 个的场合并到相邻场。单集 2-4 场，不超过 6 场。🔴 **单集总量控制**：全集合计 14-18 个 action（≈42-54 秒，对齐 60±5 秒目标），场数和每场 action 数服从此总量。
9. 🔴 **原文段落注入**：`plan_phase2_batches.py` 输出中每组包含 `source_pack_path`（文件路径）。Agent prompt 中只需传递该路径，并指示 Agent「写作前必须 Read 此文件获取本组对应的原文段落」。若 `source_pack_path` 为 `null` 则说明无原文映射，跳过此项
10. 🔴 **原文忠实铁律**：
    - **事件保留**：原文中的每个事件必须完整呈现，禁止跳过、删减、合并不同事件，或添加原文中不存在的情节；叙述性段落用动作行/字幕/旁白演绎，不得改变事件内容或顺序
    - **台词逐字**：原文台词必须逐字使用，禁止改写、润色、意译、合并或删减任何词语；仅允许将超长单句按自然语义断行（不得增删文字）；禁止捏造原文中不存在的台词
    - 🔴 **双语模式**（`design.json.bilingual = true` 时）：双语台词只保留英文，删除全部中文台词。格式：`角色名（情绪）：English dialogue line.`（英文必须写在角色名同行，禁止独立成行）
    - **非双语模式**：保留原文语言原样
11. 🔴 **画面内文字英文**（双语模式下）：评论区留言、弹幕、手机/电脑屏幕文字、海报标题、横幅、新闻标题、热搜词条、短信/聊天内容等画面内可见文字一律英文。旁白也用英文。
12. 🔴 **分场判断逻辑**：必须分场的三个条件——①时间断裂 ②空间不可达 ③戏剧主体切换且不在同一空间。不满足任何一条不得分场。分场后补离场/入场动作。每场 action ≥ 4 否则合并。
13. 🔴 **叙事段落演绎化**：原文中无台词的纯叙述段落不得跳过，必须用动作行+字幕+旁白演绎。写完后逐段比对原文确认无遗漏。

**执行流程**：
```
读取 design.json → total_episodes = N
分组：ceil(N / 3) 个 Agent，上限 10
并行启动所有 Agent（run_in_background）
等待全部完成
↓
Phase B2 格式修复：
  python3 ${CLAUDE_SKILL_DIR}/scripts/normalize_episodes.py --project-path workspace
  → 自动修复格式问题（分隔符、缺失符号等）
  → 输出 fixes_applied 列表
↓
Phase B3 解析 + 内置验证：
  python3 ${CLAUDE_SKILL_DIR}/scripts/parse_script.py --project-path workspace --output-path output --validate
  → 产出 script.json + validation 报告
  → 处理逻辑：
     - validation.has_blocking = true → 输出错误信息，等待人工确认
     - validation.passed = false → 读取 repair_plan.steps → 执行修复 ep*.md → 回到 Phase B2
     - validation.passed = true → 流水线完成
```

**Issue 严重等级**：
| 等级 | 含义 | 处理方式 |
|------|------|----------|
| `blocking` | 逻辑无法继续（如场景缺失地点） | 输出错误，等待人工确认 |
| `error` | 可自动修复的问题 | 输出 repair_plan，LLM 执行修复 |
| `warning` | 建议修复但非必须 | 输出提示，LLM 可选择忽略 |

**常见 Issue Code**：
| Code | 严重等级 | 含义 | 修复提示 |
|------|----------|------|----------|
| `MALFORMED_SCENE_HEADER` | blocking | 场景头格式错误 | 修正为：N-N 时间 内/外 地点名 |
| `EMPTY_LOCATION` | blocking | 场景头缺少地点名 | 添加地点名 |
| `MISSING_CHAR_LINE` | error | 场景缺少人物行 | 添加「人物：角色A、角色B」 |
| `UNREGISTERED_ACTOR` | error | 角色未在 catalog 注册 | 添加到 catalog.json actors[] 或 aliases |
| `UNREGISTERED_LOCATION` | error | 地点未在 catalog 注册 | 添加到 catalog.json locations[] 或 aliases |
| `ACTOR_MISMATCH` | warning | 对白角色不在人物行 | 在人物行添加角色 |
| `CHINESE_RESIDUE` | warning | 双语模式中文残留 | 替换为英文原文 |

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

1. **长文本（小说）**：初始化工作区 → 保存原文 → 进入 Phase A
2. **"状态"**：检查文件 → 展示状态面板
3. **"下一步" / "继续"**：检查进度 → 进入下一阶段
4. **"重新生成剧本" / "重跑 Phase B" / "我改了 catalog"**：检查 catalog.json + design.json 存在 → 直接进入 Phase B（跳过 Phase A）
5. **"跳转阶段 {N}" / "跳转 Phase {X}"**：检查依赖矩阵 → 进入目标阶段
6. **无输入**：检查工作区是否存在 → 存在则展示状态，不存在则提示提供原文
7. **阶段指令**（如"开始 Phase B"、"进入写作"）：路由至对应阶段
8. **"从第 N 集开始"**（Phase B 期间）：传递给 Phase B 执行分段写作
9. **"确认" / "调整 {参数}"**（Phase A 检查点期间）：处理 CP1/CP2 用户反馈，确认则继续，调整则重新生成对应内容

---

## Parser Compatibility

以下约束为硬性约束，不得破坏：

- `draft/source-structure.json` 仅作为 Phase 1/2 的中间规划输入，**不参与** Phase 3 解析
- `draft/episodes/ep*.md` 必须继续使用现有场记格式，不得添加额外 metadata block
- `output/script.json` 的 schema 不变
- Phase 3 通过 `python3 ${CLAUDE_SKILL_DIR}/scripts/parse_script.py --project-path workspace --output-path output` 执行解析
