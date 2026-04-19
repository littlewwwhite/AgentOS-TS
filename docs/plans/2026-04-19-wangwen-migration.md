# Wangwen Skill Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `wangwen` MCP-backed market-research skill from `e2b-claude-agent/templates/0_inspiration/` into `AgentOS-TS-lite`, adding Pipeline Stage 0 (INSPIRATION) **without modifying any existing stage/skill**.

**Architecture:** Pure-additive migration. `wangwen` becomes a new flat skill under `.claude/skills/wangwen/`. Its contract output (`output/inspiration.json`) is declared in a new sibling doc `docs/inspiration-contract.md` (parallel to `docs/pipeline-state-contract.md`), keeping `CLAUDE.md` changes minimal (one table row + one dispatch rule + one role row). An `.mcp.json` at the repo root registers the HTTP MCP server. No existing files are structurally reorganized; stage numbers 1–7 stay fixed.

**Tech Stack:** Claude Code project-level MCP (`.mcp.json`), flat skill directory convention, Markdown contracts. No new runtime/build tooling.

---

## Scope Boundaries (non-invasion guardrails)

Explicit **not-in-scope** — if a task seems to pull in any of these, stop and re-scope:

- Do NOT introduce per-stage subdirectories (no `0_inspiration/` folder at repo root)
- Do NOT introduce `.codex/` / `.gemini/` platform adapters (project only uses `.agents/skills → .claude/skills`)
- Do NOT adopt the `:::stage-suggest` cross-stage jump protocol
- Do NOT renumber or rewrite any existing Pipeline Stage (1 SCRIPT … 7 SUBTITLE stay as-is)
- Do NOT modify any existing skill file under `.claude/skills/{script-adapt,script-writer,asset-gen,storyboard,video-gen,video-editing,music-matcher,subtitle-maker}/`
- Do NOT extract a `_common/` shared library for existing skills in this batch
- Do NOT migrate other templates skills (`poster-gen`, `benchmark-to-script`, `script-router`, etc.) in this batch

## Prerequisites (to surface to user before starting)

- Environment variables `MCP_WANGWEN_URL` and `MCP_WANGWEN_API_KEY` must be obtainable before Task 8 smoke test. If not available at execution time, Tasks 1–7 still complete; Task 8 is deferred with a TODO note on `pipeline-state.json`.

---

## File Structure

**Files to create (all new, 7 files):**

```
.mcp.json                                              # MCP server registration (project root)
.claude/skills/wangwen/SKILL.md                        # Skill metadata + workflow (adapted from templates)
.claude/skills/wangwen/references/playbook.md          # Query intent routing (verbatim copy)
.claude/skills/wangwen/references/pitfalls.md          # Empirical data coverage notes (verbatim copy)
docs/inspiration-contract.md                           # inspiration.json schema + fill rules + anti-patterns
docs/plans/2026-04-19-wangwen-migration.md             # this plan
(memory file under ~/.claude/projects/.../memory/)     # one new wangwen memory entry
```

**Files to modify (5, all additive edits):**

```
CLAUDE.md                                              # +1 table row for Stage 0, +1 dispatch rule, +1 role row
docs/pipeline-state-contract.md                        # +INSPIRATION in Stage Keys + Artifact Mapping
docs/pipeline-state.example.json                       # +INSPIRATION stage example object
.env.example                                           # +2 env vars (MCP_WANGWEN_URL, MCP_WANGWEN_API_KEY)
README.md                                              # +1 line in skills table
```

**Responsibility split:**

- `.mcp.json` — the only place MCP server connection lives; referenced by nothing else structurally
- `SKILL.md` — trigger conditions + workflow only; pushes schema/fill-rule truth to `docs/inspiration-contract.md`
- `docs/inspiration-contract.md` — single source of truth for the `inspiration.json` output contract; wangwen and any future downstream skill (e.g. `idea-to-script` if migrated later) cross-ref this file
- `references/playbook.md` — long-half-life intent→table mapping (structural knowledge)
- `references/pitfalls.md` — short-half-life empirical notes (refresh on drift)
- `CLAUDE.md` — dispatch surface only; does not embed schema
- `docs/pipeline-state-contract.md` — adds INSPIRATION as a legal stage key

---

## Task 1: Create the `inspiration.json` output contract document

**Why first:** SKILL.md references this file, so it must exist before Task 2 passes its reference-integrity check.

**Files:**
- Create: `docs/inspiration-contract.md`

- [ ] **Step 1: Write the contract document**

Create `docs/inspiration-contract.md` with the following content (distilled verbatim from `templates/0_inspiration/.claude/CLAUDE.md §产物规范`):

```markdown
# Inspiration Contract

本文档定义 Pipeline Stage 0 (INSPIRATION) 的产物 `${OUTPUT}/inspiration.json` 的 schema、字段填充来源、自检清单与反模式。`wangwen` skill 以本文件为单一事实源；下游 SCRIPT 阶段以本文件为消费契约。

## Schema

```json
{
  "core_concept": "核心创意一句话描述",
  "key_elements": ["元素1", "元素2", "元素3"],
  "target_audience": "男频/女频",
  "genre": "主题材",
  "reference_works": [
    {"id": "作品ID", "name": "作品名", "reason": "参考原因"}
  ],
  "market_insights": "市场分析总结",
  "trend_analysis": "当前趋势概述",
  "suggested_setting": "建议的世界观/背景设定",
  "actor_archetypes": ["角色原型1", "角色原型2"]
}
```

## 字段填充来源

每个字段必须明确区分**数据支撑**、**AI 归纳**、**数据+AI 混合**三种来源，**不得混淆**——数据和归纳不能糊成一个模糊陈述。下游 SCRIPT 阶段依据此分类决定是否允许改写。

| 字段 | 类型 | 填充方式 |
|------|------|---------|
| `core_concept` | AI 归纳 | 综合用户输入 + 对标作品 `summary` / `core_tags_analysis` 提炼一句话。禁止"震撼"、"前所未有"等无数据支撑的夸张词 |
| `key_elements` | 数据支撑 | 对标作品 `hook_tags` / `vibe_tags` / `gold_finger_tags` 聚合高频值（至少 3 部对标作品出现过的标签优先） |
| `target_audience` | 数据支撑 | 对标作品 `gender` / `audience` 字段（番茄 `dwd_novel_base_df.gender` 是字符串，红果 `dwd_video_base_df.gender` 是 Bool，不要混） |
| `genre` | 数据支撑 | 番茄用 `category`（如"都市高武"/"穿越"/"东方仙侠"），漫剧用 `genre`（1=短剧/1004=漫剧）或 tag 表 `genre` |
| `reference_works[]` | 数据支撑 | 查询结果的真实 `book_id`/`series_id` + 真实名字；`reason` 字段**必须包含具体数值**（播放/在读/排名/首秀天数等） |
| `market_insights` | 数据+AI | 聚合查询得"事实陈述" + AI 做"判断"；事实与判断分开写 |
| `trend_analysis` | 数据+AI | 近 7 日 vs 近 30 日对比数据 + AI 解读；至少引用一条具体对比数值 |
| `suggested_setting` | AI 归纳 | 基于 `worldview_analysis` JSON 和 `world_tags` Array 归纳；允许 AI 加工但要注明参考源 |
| `actor_archetypes` | 数据+AI | 从对标作品 `character_profile_analysis` JSON + `identity_tags` Array 提取，AI 去重/归类 |

## 写入前自检清单（硬门控）

写 `${OUTPUT}/inspiration.json` 前逐项检查：

- [ ] 每个 `reference_works[].id` / `.name` 来自**真实查询结果**，未编造
- [ ] 每个 `reference_works[].reason` **包含具体字段+数值**（如 "reader_uv_14day=77 万"），不是"很火"这种空话
- [ ] `target_audience` / `genre` 有明确字段依据，而不是 AI 凭经验猜的
- [ ] `market_insights` / `trend_analysis` 的**每个陈述能被至少一条 SQL 复现**
- [ ] 标注为"AI 归纳"的字段没有伪装成数据支撑（避免"数据显示" + 实际无数据）
- [ ] 未使用已知空字段（核对 `.claude/skills/wangwen/references/pitfalls.md`）

任一项不通过 → 回到查询补数据，不得降级为"经验判断"蒙混。

## 反模式（对照避免）

**A. 编造作品**

反例：`{"name": "某爆款短剧", "reason": "据说在抖音很火"}`

正例：`{"id": "7449122883281256234", "name": "男人五十岁", "reason": "抖音漫剧日榜第 1，play_count=1.77 亿，play_inc=1.09 亿（2026-04-17 日榜快照）"}`

**B. 空洞市场判断**

反例：`"market_insights": "市场前景广阔，题材空间大"`

正例：`"market_insights": "2026-04-17 番茄 B端-男频阅读榜-都市高武 TOP15 reader_uv_14day 中位数 ≈70 万，TOP1《我不是戏神》402 万；TOP15 中 9 部已改编（is_related_video=1），TOP3 改编的 3 部全为 AI 漫剧路径（ai_video_num≥1 / playlet_num=0），真人短剧路径在该题材缺席——说明漫剧改编窗口仍活跃且供给侧倾向 AI 漫剧。"`

**C. 数据+归纳混说**

反例：`"trend_analysis": "重生复仇类作品非常受欢迎"`

正例：`"trend_analysis": "hook=重生复仇 在漫剧六维标签中覆盖 165 部独立作品（video_tag_detail 2026-04-17 快照），为 hook 维度第 2 大 cluster；结合番茄同 hook 改编率 X%，判断该方向改编链路通畅。"`

事实 / 依据 / 推断三层分开，不模糊。

## 下游契约

`inspiration.json` 由下游 SCRIPT 阶段（`script-writer` 或未来迁入的 `idea-to-script`）消费为创作起点。"数据支撑"字段不得擅改；"AI 归纳"字段允许下游重写；"数据+AI"字段的事实部分不得擅改、判断部分允许重写。**契约字段以本文件为准**——skill 内部文档（SKILL.md / references）不得重复 schema 定义，避免漂移。
```

- [ ] **Step 2: Verify the file exists and is readable**

Run: `ls -la docs/inspiration-contract.md && head -5 docs/inspiration-contract.md`

Expected: file ~4KB, starts with `# Inspiration Contract`.

- [ ] **Step 3: Commit**

```bash
git add docs/inspiration-contract.md docs/plans/2026-04-19-wangwen-migration.md
git commit -m "docs: add inspiration.json output contract + migration plan"
```

---

## Task 2: Migrate wangwen skill content

**Files:**
- Create: `.claude/skills/wangwen/SKILL.md`
- Create: `.claude/skills/wangwen/references/playbook.md`
- Create: `.claude/skills/wangwen/references/pitfalls.md`

- [ ] **Step 1: Create the skill directory tree**

Run: `mkdir -p .claude/skills/wangwen/references`

Expected: no output, directory exists.

- [ ] **Step 2: Copy `playbook.md` verbatim from source**

Run:
```bash
cp workspace/_templates-analysis/0_inspiration/.claude/skills/wangwen/references/playbook.md \
   .claude/skills/wangwen/references/playbook.md
```

Expected: file present, ~3KB.

- [ ] **Step 3: Copy `pitfalls.md` verbatim from source**

Run:
```bash
cp workspace/_templates-analysis/0_inspiration/.claude/skills/wangwen/references/pitfalls.md \
   .claude/skills/wangwen/references/pitfalls.md
```

Expected: file present, ~5KB.

- [ ] **Step 4: Write the adapted `SKILL.md`**

Create `.claude/skills/wangwen/SKILL.md` with the following content. **Key adaptation:** cross-refs that pointed to `../../CLAUDE.md` (the per-stage CLAUDE.md in the templates architecture) are rewritten to `docs/inspiration-contract.md` (the repo-root contract doc in AgentOS-TS).

```markdown
---
name: wangwen
description: 基于网文大数据 MCP（query_sql + 4 个 domain schema resource）为漫剧创作做市场调研。当用户需要"看什么题材在涨"、"找对标作品"、"查改编漏斗"、"深度分析某部小说/漫剧"、"判断市场趋势"等数据支撑型灵感问题时触发。产出 Pipeline Stage 0 契约规定的 inspiration.json。
version: "0.2.0"
author: "official"
metadata:
  pattern: mcp-backed-research
  mcp_server: "wangwen (HTTP, 网文大数据 v1.26.0)"
  language_support: "zh"
---

# Wangwen — 网文大数据驱动的灵感调研 skill

本 skill 是 MCP `query_sql` 工具的**使用经验封装层**：把灵感调研的常见问题意图翻译为"读哪个 resource → 跑什么风格的 SQL → 结果如何归纳进 inspiration.json"。

单一事实源原则——skill 不复读上位/同位文档，重复即漂移：

| 需要什么 | 去哪里查 |
|---------|---------|
| `inspiration.json` schema / 填充规则 / 自检清单 / 反模式 | `docs/inspiration-contract.md` |
| 意图 → 业务域 → 表 → 思路 | `references/playbook.md` |
| 实测空字段 / 覆盖率红线 / MCP 后端行为异常 | `references/pitfalls.md` |
| 字段定义 / 官方 SQL 模板 | `resource://table-map` + `resource://domain-*`（每次现读） |

## MCP 真实表面

MCP 服务器注册在仓库根 `.mcp.json`（URL 和 API Key 由 `MCP_WANGWEN_URL` / `MCP_WANGWEN_API_KEY` env 变量注入）。

**网文大数据 MCP Server v1.26.0** 对外暴露：

- **仅 1 个 tool**：`query_sql(sql, limit=100)` — 只读 SQL，服务端自动注入 LIMIT
- **4 个 resource**（schema 文档，使用前必读）：
  - `resource://table-map` — 11 张表的业务域路由总览
  - `resource://domain-anime` — 抖音漫剧 5 张表 + 8 条官方 SQL 模板
  - `resource://domain-novel` — 番茄小说 4 张表 + 7 条官方 SQL 模板
  - `resource://domain-video` — 红果短剧+漫剧 2 张表 + 6 条官方 SQL 模板
- 0 个 prompt

**使用模式**：先读 resource 拿 schema+模板 → 用 `query_sql` 执行。**不要凭记忆拼 SQL**，字段名/分区键/类型细节现读最准。

---

## 工作流（6 步，顺序不可跳）

1. **意图澄清**
   用 **AskUserQuestion** 工具确认用户的灵感方向（题材 / 受众 / 核心钩子 / 期望对标样式）。意图模糊时不得擅自开跑查询。

2. **读 `resource://table-map`**
   按意图定位业务域（抖音漫剧 / 番茄小说 / 红果短剧+漫剧 / 跨域）。

3. **读对应 `resource://domain-*`**
   拿字段定义 + 官方 SQL 模板。不要凭记忆写 SQL。

4. **用 `query_sql` 执行查询**
   - 意图 → 表 → 思路：查 `references/playbook.md`
   - 分区键 / 阈值 / 榜单陷阱 / 字段类型差异：查 `references/pitfalls.md`

5. **校验数据覆盖**
   按 `references/pitfalls.md` 的"空字段"、"样本强约束"两节逐项核。命中低覆盖字段主动告知用户并走 pitfalls 注明的降级路径，不得沉默。

6. **写 `${OUTPUT}/inspiration.json`**
   按 `docs/inspiration-contract.md` 执行字段填充 + 自检清单。**自检任一项未通过不得写入**——回到第 4 步补查询，不得降级为"经验判断"。

---

## 触发词

- "市场调研"、"查榜单"、"找对标作品"、"改编漏斗"、"首秀动能"
- "什么题材在涨"、"爆款参考"、"深度分析某部作品"
- Pipeline Stage 0 (INSPIRATION) 阶段中任何需要数据背书的灵感问题

## 非触发条件

- 纯创意发散、无需数据验证 → 直接由 `script-writer` 的 SWS 模式从零原创
- 用户已有明确对标作品并打算直接改编 → 下游 SCRIPT 阶段（`script-adapt` 或 `script-writer`）
- 用户已提供剧本/小说原文求改编 → 下游 SCRIPT 阶段

## 产物路径

- `${OUTPUT}/inspiration.json` — 最终产物（供下游 SCRIPT 阶段消费）
- 查询过程中的中间笔记可写入 `${WORKSPACE}/inspiration/` 目录（可选）
```

- [ ] **Step 5: Verify skill tree integrity**

Run:
```bash
ls -la .claude/skills/wangwen/ .claude/skills/wangwen/references/ && \
grep -c "^---$" .claude/skills/wangwen/SKILL.md
```

Expected:
- `SKILL.md`, `references/` listed
- `playbook.md`, `pitfalls.md` in references/
- frontmatter delimiter count = 2 (valid frontmatter)

- [ ] **Step 6: Verify all cross-refs in SKILL.md resolve**

Run:
```bash
for ref in docs/inspiration-contract.md .claude/skills/wangwen/references/playbook.md .claude/skills/wangwen/references/pitfalls.md; do
  test -f "$ref" && echo "OK $ref" || echo "MISSING $ref"
done
```

Expected: all three lines print `OK`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/wangwen/
git commit -m "feat(skills): add wangwen market-research skill (Pipeline Stage 0)"
```

---

## Task 3: Register the MCP server

**Files:**
- Create: `.mcp.json`
- Modify: `.env.example`

- [ ] **Step 1: Create `.mcp.json` at repo root**

Create `.mcp.json` with:

```json
{
  "mcpServers": {
    "wangwen": {
      "type": "http",
      "url": "${MCP_WANGWEN_URL}",
      "headers": {
        "X-MCP-API-Key": "${MCP_WANGWEN_API_KEY}"
      }
    }
  }
}
```

- [ ] **Step 2: Read existing `.env.example`**

Run: `cat .env.example`

Expected: current content (to preserve it in the next edit).

- [ ] **Step 3: Append MCP env vars to `.env.example`**

Edit `.env.example` — append the following block to the end of the file (keep all existing content untouched):

```
# Wangwen MCP (Pipeline Stage 0 — market-research skill)
# Obtain from the wangwen MCP server maintainer
MCP_WANGWEN_URL=
MCP_WANGWEN_API_KEY=
```

- [ ] **Step 4: Verify JSON validity**

Run: `python3 -c "import json; json.load(open('.mcp.json'))" && echo "JSON valid"`

Expected: `JSON valid` prints.

- [ ] **Step 5: Commit**

```bash
git add .mcp.json .env.example
git commit -m "feat(mcp): register wangwen HTTP server + document env vars"
```

---

## Task 4: Extend `CLAUDE.md` — Pipeline Stage 0 + dispatch + role

**Files:**
- Modify: `CLAUDE.md:26-34` (Pipeline Stages table — prepend Stage 0 row)
- Modify: `CLAUDE.md:36-42` (Dispatch Rules — add one bullet)
- Modify: `CLAUDE.md:134-140` (Role Boundaries — add one row)

Each edit is additive — no existing text is removed, no Stage 1–7 row is touched.

- [ ] **Step 1: Add Stage 0 row to the Pipeline Stages table**

Edit `CLAUDE.md`. Replace:

```markdown
| # | Stage | Skill | Input | Output | Gate |
|---|-------|-------|-------|--------|------|
| 1 | SCRIPT | `script-adapt` (long novel ≥3000 chars) or `script-writer` (original/short story) | source text | `${OUTPUT}/script.json` | script.json exists with episodes[] |
```

With:

```markdown
| # | Stage | Skill | Input | Output | Gate |
|---|-------|-------|-------|--------|------|
| 0 | INSPIRATION | `wangwen` | user inspiration brief / market-research request | `${OUTPUT}/inspiration.json` | inspiration.json exists and passes self-check in `docs/inspiration-contract.md` |
| 1 | SCRIPT | `script-adapt` (long novel ≥3000 chars) or `script-writer` (original/short story) | source text or `${OUTPUT}/inspiration.json` | `${OUTPUT}/script.json` | script.json exists with episodes[] |
```

(Note: SCRIPT input now also accepts `inspiration.json` — this is the only SCRIPT-row change, purely documentation.)

- [ ] **Step 2: Add dispatch rule for INSPIRATION**

In the `### Dispatch Rules` section, replace:

```markdown
- When the user provides a novel or says "write a script" → invoke `script-adapt` or `script-writer`
```

With:

```markdown
- When the user needs data-backed inspiration / market research / benchmark discovery ("什么题材在涨"、"找对标"、"改编漏斗") → invoke `wangwen`
- When the user provides a novel or says "write a script" → invoke `script-adapt` or `script-writer`
```

- [ ] **Step 3: Add Researcher role boundary**

In the `## Role Boundaries` table, replace:

```markdown
| Domain | Skills | Responsibilities |
|--------|--------|-----------------|
| Screenwriter | script-adapt, script-writer | Script creation only. Never generate images or videos. |
```

With:

```markdown
| Domain | Skills | Responsibilities |
|--------|--------|-----------------|
| Researcher | wangwen | Market-research only (SQL via MCP). Never create script/asset/video content. |
| Screenwriter | script-adapt, script-writer | Script creation only. Never generate images or videos. |
```

- [ ] **Step 4: Verify CLAUDE.md still parses as valid Markdown and all edits applied**

Run:
```bash
grep -c "| 0 | INSPIRATION" CLAUDE.md && \
grep -c "invoke .wangwen." CLAUDE.md && \
grep -c "| Researcher |" CLAUDE.md
```

Expected: each line prints `1`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(pipeline): add Stage 0 INSPIRATION + wangwen dispatch rule + Researcher role"
```

---

## Task 5: Extend pipeline-state contract + example

**Files:**
- Modify: `docs/pipeline-state-contract.md:36-44` (Stage Keys list)
- Modify: `docs/pipeline-state-contract.md:103-109` (Minimum Artifact Mapping)
- Modify: `docs/pipeline-state.example.json` (prepend INSPIRATION stage)

- [ ] **Step 1: Add INSPIRATION to Stage Keys list**

Edit `docs/pipeline-state-contract.md`. Replace:

```markdown
固定 stage 名称：

- `SCRIPT`
- `VISUAL`
```

With:

```markdown
固定 stage 名称：

- `INSPIRATION`
- `SCRIPT`
- `VISUAL`
```

- [ ] **Step 2: Add INSPIRATION to Minimum Artifact Mapping**

In the same file, replace:

```markdown
## Minimum Artifact Mapping

- `SCRIPT` → `output/script.json`
```

With:

```markdown
## Minimum Artifact Mapping

- `INSPIRATION` → `output/inspiration.json`
- `SCRIPT` → `output/script.json`
```

- [ ] **Step 3: Prepend INSPIRATION to the example JSON**

Edit `docs/pipeline-state.example.json`. Replace:

```json
  "current_stage": "SCRIPT",
  "next_action": "enter VISUAL",
  "last_error": null,
  "stages": {
    "SCRIPT": {
      "status": "validated",
      "updated_at": "2026-03-25T12:00:00Z",
      "artifacts": [
        "output/script.json"
      ],
      "notes": "script.json exists with episodes[]"
    },
```

With:

```json
  "current_stage": "SCRIPT",
  "next_action": "enter VISUAL",
  "last_error": null,
  "stages": {
    "INSPIRATION": {
      "status": "validated",
      "updated_at": "2026-04-19T09:00:00Z",
      "artifacts": [
        "output/inspiration.json"
      ],
      "notes": "data-backed inspiration brief passed self-check"
    },
    "SCRIPT": {
      "status": "validated",
      "updated_at": "2026-03-25T12:00:00Z",
      "artifacts": [
        "output/script.json"
      ],
      "notes": "script.json exists with episodes[]"
    },
```

- [ ] **Step 4: Verify contract + example JSON**

Run:
```bash
grep -c "^- .INSPIRATION." docs/pipeline-state-contract.md && \
grep -c "INSPIRATION.*inspiration.json" docs/pipeline-state-contract.md && \
python3 -c "import json; d=json.load(open('docs/pipeline-state.example.json')); assert 'INSPIRATION' in d['stages'], 'missing INSPIRATION'; print('OK')"
```

Expected:
- first grep: `1` (stage key listed)
- second grep: `1` (artifact mapping)
- python: `OK`

- [ ] **Step 5: Commit**

```bash
git add docs/pipeline-state-contract.md docs/pipeline-state.example.json
git commit -m "docs(state): add INSPIRATION stage to pipeline-state contract + example"
```

---

## Task 6: Update README skills list

**Files:**
- Modify: `README.md:27-36` (skills list)

- [ ] **Step 1: Read current README skills section**

Run: `grep -n "wangwen\|当前 Skills\|script-adapt" README.md | head -10`

Expected: locate `## 当前 Skills` section (around line 26) and verify `wangwen` is not already listed.

- [ ] **Step 2: Prepend `wangwen` to the skills list**

Edit `README.md`. Replace:

```markdown
## 当前 Skills

- `script-adapt`
- `script-writer`
```

With:

```markdown
## 当前 Skills

- `wangwen` — 数据支撑型灵感调研（Stage 0）
- `script-adapt`
- `script-writer`
```

- [ ] **Step 3: Verify edit**

Run: `grep -c "wangwen" README.md`

Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): add wangwen to skill list"
```

---

## Task 7: Update auto-memory

**Files:**
- Create: `~/.claude/projects/-Users-dingzhijian-lingjing-AgentOS-TS/memory/wangwen_migration.md`
- Modify: `~/.claude/projects/-Users-dingzhijian-lingjing-AgentOS-TS/memory/MEMORY.md`

Memory is outside the repo — these are not git-tracked, no git commit for this task.

- [ ] **Step 1: Write the memory file**

Create `/Users/dingzhijian/.claude/projects/-Users-dingzhijian-lingjing-AgentOS-TS/memory/wangwen_migration.md`:

```markdown
---
name: wangwen skill migrated from templates
description: Pipeline Stage 0 (INSPIRATION) added via wangwen MCP-backed research skill migrated from e2b-claude-agent/templates/0_inspiration on 2026-04-19
type: project
---

Pipeline Stage 0 (INSPIRATION) exists as of 2026-04-19. Skill: `wangwen` at `.claude/skills/wangwen/`. Output contract: `docs/inspiration-contract.md`. MCP server registered at `.mcp.json` (requires env vars `MCP_WANGWEN_URL` and `MCP_WANGWEN_API_KEY`).

**Why:** AgentOS-TS-lite previously started Pipeline at Stage 1 (SCRIPT). Templates repo had a fuller Stage 0 providing data-backed inspiration via MCP SQL queries against network-novel/short-drama big-data tables. Missing this stage meant inspiration fields were AI-guessed rather than market-validated.

**How to apply:** When the user asks for market research, benchmark discovery, or data-backed topic suggestions before scripting, dispatch `wangwen`. Downstream SCRIPT skills (`script-adapt`, `script-writer`) may consume `output/inspiration.json` as alternative input to raw source text.
```

- [ ] **Step 2: Add index entry to MEMORY.md**

Edit `/Users/dingzhijian/.claude/projects/-Users-dingzhijian-lingjing-AgentOS-TS/memory/MEMORY.md` — append under the Skills section (or create one if absent) a new line:

```markdown
- [Wangwen migration](wangwen_migration.md) — Stage 0 INSPIRATION added 2026-04-19; MCP-backed market research at .claude/skills/wangwen/
```

- [ ] **Step 3: Verify memory files readable**

Run:
```bash
ls -la ~/.claude/projects/-Users-dingzhijian-lingjing-AgentOS-TS/memory/wangwen_migration.md && \
grep -c "wangwen_migration" ~/.claude/projects/-Users-dingzhijian-lingjing-AgentOS-TS/memory/MEMORY.md
```

Expected: file present; grep prints `1`.

---

## Task 8: Smoke validation

**Files:** no file changes; this is a runtime validation pass.

This task **requires** `MCP_WANGWEN_URL` and `MCP_WANGWEN_API_KEY` to be set in the current shell environment. If unavailable at execution time, mark the three MCP sub-steps as `deferred` in `pipeline-state.json` and only complete steps 1, 5, 6.

- [ ] **Step 1: Verify skill discovery (Claude Code sees wangwen)**

Run: `ls .claude/skills/ | grep wangwen`

Expected: `wangwen` prints.

- [ ] **Step 2: Verify MCP config loads without syntax error**

Run: `python3 -c "import json, os, re; c=json.load(open('.mcp.json')); s=c['mcpServers']['wangwen']; print('type:', s['type'], '| url pattern:', s['url']); assert s['type']=='http' and 'WANGWEN_URL' in s['url']"`

Expected: prints `type: http | url pattern: ${MCP_WANGWEN_URL}`.

- [ ] **Step 3: Verify env vars are set (MCP prerequisite)**

Run: `test -n "$MCP_WANGWEN_URL" && test -n "$MCP_WANGWEN_API_KEY" && echo "env OK" || echo "env MISSING — skip steps 4-5, ask user to set env vars"`

Expected: `env OK`. If `env MISSING`, stop here and hand back to user.

- [ ] **Step 4: Verify MCP server connectivity via Claude Code CLI**

Run: `claude mcp list 2>&1 | head -20`

Expected: output includes a line mentioning `wangwen` with status `connected` / `✓` (exact format depends on Claude Code version; any non-error line naming wangwen is acceptable).

- [ ] **Step 5: Probe one read-only MCP resource**

Open a Claude Code session in this repo and instruct:
> "Read `resource://table-map` from the wangwen MCP server and list the 11 business tables."

Expected: response lists 11 tables across 3 business domains (douyin-anime / novel / video).

- [ ] **Step 6: Verify SKILL.md trigger condition surfaces wangwen when invoked**

In a fresh Claude Code session, type: "我想查一下最近什么漫剧题材在涨".

Expected: Claude proposes `wangwen` skill (or auto-invokes it if allowed by settings). If Claude instead routes to `script-writer` or asks for a novel, the description/trigger words in `SKILL.md` need tightening — file a follow-up task.

- [ ] **Step 7: Verify all introduced files stage clean**

Run: `git status --short`

Expected: empty (everything committed in Tasks 1–6) OR only the new plan doc if not yet committed.

---

## Task 9: Clean up scratch analysis directory (optional cleanup)

**Files:**
- Delete: `workspace/_templates-analysis/` (gitignored, local-only)

This is scratch space from the analysis phase; deleting reclaims ~4MB.

- [ ] **Step 1: Confirm directory is gitignored**

Run: `git check-ignore workspace/_templates-analysis && echo ignored`

Expected: `workspace/_templates-analysis` and `ignored` print.

- [ ] **Step 2: Remove it**

Run: `rm -rf workspace/_templates-analysis`

Expected: no output.

- [ ] **Step 3: Verify removal**

Run: `ls workspace/ 2>&1 | grep _templates-analysis && echo STILL_THERE || echo REMOVED`

Expected: `REMOVED`.

---

## Task 10: Push and announce

- [ ] **Step 1: Verify clean working tree and log**

Run:
```bash
git status && git log --oneline -10
```

Expected: working tree clean; 6 new commits on `lite` branch (one per Task 1–6 if done serially).

- [ ] **Step 2: Push to GitHub**

Run: `git push origin lite`

Expected: push succeeds, `origin/lite` updated.

- [ ] **Step 3: Verify on remote**

Run: `gh browse --no-browser -b lite -- .claude/skills/wangwen/SKILL.md 2>&1 | head -3`

Expected: prints a GitHub URL pointing to the wangwen SKILL.md on the `lite` branch.

---

## Self-Review Checklist (run after plan executed)

- [ ] Pipeline Stage 0 (INSPIRATION) documented in `CLAUDE.md` — yes/no
- [ ] `wangwen` skill loads without error in Claude Code — yes/no
- [ ] `docs/inspiration-contract.md` schema matches the source `templates/0_inspiration/.claude/CLAUDE.md §产物规范` — yes/no (diff check)
- [ ] No existing skill file under `.claude/skills/{script-adapt,script-writer,asset-gen,storyboard,video-gen,video-editing,music-matcher,subtitle-maker}/` was modified — yes/no (`git diff master..HEAD -- .claude/skills/` should show only `wangwen/` additions)
- [ ] No new subdirectory like `0_inspiration/` exists at repo root — yes/no
- [ ] All references in `.claude/skills/wangwen/SKILL.md` resolve to existing files — yes/no
- [ ] `MCP_WANGWEN_URL` + `MCP_WANGWEN_API_KEY` documented in `.env.example` — yes/no

Any `no` → open a follow-up task before declaring the migration complete.
