---
name: video-gen
description: '从已批准分镜到视频的生成工具 - 导出 runtime storyboard + 批量生成视频。当用户要求根据 approved storyboard 生成视频、批量生成视频、生成某集连续视频时使用此 skill；分镜创作请先走 storyboard skill。'
argument-hint: "--episode N or approved-storyboard.json --output DIR"
allowed-tools:
  - Bash
  - Read
---

# Video Gen

从已批准分镜到视频的生成工具：把导演批准的 storyboard 导出为运行时 storyboard，然后批量生成视频与 AI 评审。

> **路径约定**：文档内引用 skill 自带文件时，直接使用 `references/`、`assets/`、`scripts/` 等相对路径；命令示例统一使用仓库根相对路径。`${PROJECT_DIR}` 含义保持不变。

## 前置检查（每次执行前按序完成）

### 步骤 0: Ark / ChatFire 环境依赖检查

```bash
python3 - <<'PY'
import os, sys
missing = [k for k in ("ARK_API_KEY", "GEMINI_API_KEY") if not os.environ.get(k)]
if missing:
    print("missing env: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
print("video-gen env ok")
PY
command -v ffmpeg >/dev/null
```

- 缺少 `ARK_API_KEY` → Seedance2 视频生成不可运行
- 缺少 `GEMINI_API_KEY` → 视频评审（ChatFire Gemini 代理）不可运行；该变量值应填写 ChatFire key
- `ffmpeg` 缺失 → 按输出提示安装

前置检查全部通过后，进入 Mode Selection。

---

## Mode Selection (Highest Priority)

进入 mode selection 前，先读取：

- `references/MODE_RULES.md`
- `references/SHOT_VALIDATION_RULES.md`

它们当前是**审计优先**规则：先统一“该怎么判断”和“进视频前应该查什么”，暂不强制接管运行时代码。

| User says | Mode |
|-----------|------|
| "一键生成视频" / "一键生成" / "全自动" / "一键成片"（在本 skill 中按视频生成理解） | **Auto mode** |
| Everything else (default) | **Manual mode** |

### Auto Mode

- Uses `assets/config.json` defaults, **no user confirmation needed**
- Default: `seedance2`, subject_reference=false, 9:16, 720p
- Run: `python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N --parallel`
- 前置条件：`output/storyboard/approved/ep{NNN}_storyboard.json` 已存在
- Add `--no-generate-video` only when user explicitly says "only export runtime storyboard"
- Scope: 本 skill 在自动模式下只完成 `VIDEO` 阶段，不包含后续 `EDITING` / `MUSIC` / `SUBTITLE`
- VIDEO 阶段不再从 `script.json` 隐式生成分镜；分镜创作、修改、批准属于 `storyboard` 阶段。video review: Gemini (from `assets/config.json`)

### Manual Mode (4-Step Confirmation)

| Step | Action | Details |
|------|--------|---------|
| 1 | Model selection | `seedance2` only |
| 2 | Reference mode | Seedance image reference? (default: yes) |
| 3 | Generation params | Ratio (9:16/16:9/1:1), Quality (720p/1080p) |
| 4 | Write config & run | Update `assets/config.json` then execute scripts |

- "Only export" → skip video generation, run with `--no-generate-video`
- Storyboard prompt creation belongs to `storyboard`; this skill only exports approved storyboard and runs video review via Gemini API

## 跨集并行策略

🔴 **处理多集视频生成时必须执行以下判断：**

1. 确定待处理集数列表（从用户指令或 `script.json` 中获取）
2. **若待处理 ≤ 2 集**：在当前 session 中逐集执行 Phase 1 + Phase 2
3. **若待处理 > 2 集**：**必须**使用 Agent subagents 并行处理

**并行执行流程（> 2 集时强制执行）：**

```
确定集数列表 → [ep001, ep002, ..., epN]
按每组 2-3 集分组，上限 5 个并行 Agent
每个 Agent 负责其分组内的 Phase 1（runtime storyboard export）+ Phase 2（视频生成）
并行启动所有 Agent（run_in_background: true）
等待全部完成 → 验证各集 delivery.json 就绪
```

每个 Agent subagent 的 prompt **必须包含**：
1. 完整的前置检查步骤（Ark / Gemini 环境依赖）
2. `${PROJECT_DIR}/output/script.json` 中**本组集**的 episodes 数据
3. `${PROJECT_DIR}/output/actors/actors.json` 和 `locations/locations.json`（视觉参考映射）
4. 当前 Mode（Auto/Manual）和生成参数（model、ratio、quality）
5. **约束**：「每集独立输出到 `${PROJECT_DIR}/output/ep{NNN}/`，不修改其他集目录。」

> Phase 2 (`batch_generate.py`) 内部已实现 scene 级并行（clip-serial），无需额外拆分。跨集并行由 Agent subagent 负责。

## Core Commands

### Phase 1: Runtime Storyboard Export

```bash
# Export approved storyboard for episode
python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N

# Re-export by deleting stale runtime copy or using --force with checkpoint logic
python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N --force
```

- `generate_episode_json.py` 只接受 `output/storyboard/approved/ep{NNN}_storyboard.json`
- approved canonical 缺失时直接失败，回到 `storyboard` 阶段生成/批准分镜
- 不再从 `script.json` 重写该集导演产物

### Phase 2: Batch Video Generation

```bash
# Generate videos from storyboard JSON
python3 ./.claude/skills/video-gen/scripts/batch_generate.py \
  ${PROJECT_DIR}/output/storyboard/approved/ep001_storyboard.json \
  --output ${PROJECT_DIR}/output/ep001 --episode 1

# Dry run / specific shot / custom ratio
python3 ./.claude/skills/video-gen/scripts/batch_generate.py storyboard.json --output DIR --dry-run
python3 ./.claude/skills/video-gen/scripts/batch_generate.py storyboard.json --output DIR --shot scn001_clip001
python3 ./.claude/skills/video-gen/scripts/batch_generate.py storyboard.json --output DIR --ratio 9:16
```

### Preflight Validation (audit-first)

真正进入 `batch_generate.py` 前，先按 `references/SHOT_VALIDATION_RULES.md` 做一次轻量校验：

- 若存在 blocking issue，先回到 storyboard/runtime export 修正，不要直接硬跑
- 若只有 warning，允许继续，但要向用户解释风险
- 若 approved canonical 完整而 runtime export 不完整，优先重新导出 runtime storyboard，而不是手工补字段

## I/O Path Conventions

All paths are relative to `${PROJECT_DIR}` (injected at runtime by orchestrator).

```
Input:  ${PROJECT_DIR}/output/storyboard/approved/ep{NNN}_storyboard.json
        ${PROJECT_DIR}/output/script.json             → validation context
        ${PROJECT_DIR}/output/actors/actors.json      → {act_xxx} subject mapping
        ${PROJECT_DIR}/output/locations/locations.json → {loc_xxx} subject mapping

Director canonical: ${PROJECT_DIR}/output/storyboard/approved/ep{NNN}_storyboard.json
VIDEO runtime export: ${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_storyboard.json
Phase 1 output: ${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_storyboard.json
Phase 2 output: ${PROJECT_DIR}/output/ep{NNN}/scn{NNN}/clip{NNN}/*.mp4 + *.json
Delivery:       ${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_delivery.json
Logs:           ${PROJECT_DIR}/draft/logs/ep{NNN}.log (parallel mode)
Frames:         ${PROJECT_DIR}/draft/ep{NNN}/frames/{scene_id}_clip{NNN}_last_shot_first_frame.png
```

- Phase 2 入口必须读取 `output/storyboard/approved/ep{NNN}_storyboard.json`
- 进入 VIDEO 阶段时，先把导演 canonical 同步为 `output/ep{NNN}/ep{NNN}_storyboard.json`
- `lsi`、评审与其它运行时元数据只写回 runtime export，不回写导演 canonical

## Unified State File

`video-gen` is the `VIDEO` stage and must keep `${PROJECT_DIR}/pipeline-state.json` in sync.

Recommended writer surface:

```bash
python3 ./scripts/pipeline_state.py ensure --project-dir "${PROJECT_DIR}"
python3 ./scripts/pipeline_state.py stage --project-dir "${PROJECT_DIR}" --stage VIDEO --status running --next-action "enter VIDEO"
```

- On entry: require approved storyboard canonical and export it to VIDEO runtime storyboard
- On entry: set `current_stage=VIDEO` and `stages.VIDEO.status=running`
- If `ep{NNN}_storyboard.json` exists but `ep{NNN}_delivery.json` is not ready: set `episodes.ep{NNN}.video.status=partial`
- After `ep{NNN}_delivery.json` is written: set `episodes.ep{NNN}.video.status=completed`
- After target episodes pass verification: set `stages.VIDEO.status=validated` and `next_action=enter EDITING`

Recommended checkpoint commands:

```bash
python3 ./scripts/pipeline_state.py episode --project-dir "${PROJECT_DIR}" --episode "ep${NNN}" --kind video --status partial --artifact "output/ep${NNN}/ep${NNN}_storyboard.json"
python3 ./scripts/pipeline_state.py episode --project-dir "${PROJECT_DIR}" --episode "ep${NNN}" --kind video --status completed --artifact "output/ep${NNN}/ep${NNN}_delivery.json"
python3 ./scripts/pipeline_state.py stage --project-dir "${PROJECT_DIR}" --stage VIDEO --status validated --next-action "enter EDITING"
```

Recovery order:

1. Read `${PROJECT_DIR}/pipeline-state.json` first
2. If missing, check `output/ep{NNN}/ep{NNN}_delivery.json`
3. If only `ep{NNN}_storyboard.json` exists, recover as `partial`

## Key Capabilities

**Phase 1** — Runtime export only: copy approved storyboard canonical to `output/ep{NNN}/ep{NNN}_storyboard.json` and normalize it for validation. It must not generate storyboard prompts from `script.json`.

**Phase 2** — Batch video gen + review loop: per-clip generate-review cycle (min 1, max 2 attempts), Gemini 2-role parallel analysis (reference consistency + prompt compliance), subject/image reference modes, last-shot first-frame injection (ffmpeg scene detect → face blur → COS upload → inject into next clip's `lsi` field + `complete_prompt`)。这些运行时回写只发生在 `output/ep{NNN}/ep{NNN}_storyboard.json`

## Supported Models

| Model | Code | Reference Mode | Duration |
|-------|------|---------------|----------|
| Seedance 2 | `ep-20260303234827-tfnzm` | Image ref | 3-15s |

## Scripts

| Module | Function |
|--------|----------|
| `generate_episode_json.py` | Export approved storyboard canonical to VIDEO runtime storyboard |
| `batch_generate.py` | Core: batch video gen + review loop; scene-parallel, clip-serial |
| `frame_extractor.py` | Last-shot first-frame extraction + face blur (ffmpeg + PIL) |
| `video_api.py` | Provider adapter for Volcengine Ark Seedance 2 |
| `analyzer.py` / `evaluator.py` | Gemini 2-role analyzer + 2-dimension scoring |
| `config_loader.py` | Config loader (reads `assets/config.json`) |

## Relationship to Other Skills

```
video-gen
    ├─ Input: ${PROJECT_DIR}/output/storyboard/approved/ep###_storyboard.json
    ├─ Output: ${PROJECT_DIR}/output/ep###/*.mp4
    ├─ Depends: ARK_API_KEY (default video gen auth)
    └─ Built-in: Gemini video review
```

## References

| Document | Content |
|----------|---------|
| `references/MODE_RULES.md` | Mode selection, resume, prompt-only/video-only precedence |
| `references/SHOT_VALIDATION_RULES.md` | Lightweight preflight validation rules before expensive generation |
| `references/STORYBOARD_SCHEMA.md` | STORYBOARD 层与 VIDEO 导出层的双层 JSON 契约说明（含 `shots[]` / `clips[]` 兼容关系） |
| `references/SENSITIVE_WORDS.md` | Sensitive word replacement table for content moderation |
| `references/AI_CONFIG_AND_DELIVERY.md` | Provider config, storyboard draft text endpoint, Gemini review, delivery JSON format |

## Version

**Current**: 2.4.0 | **Updated**: 2026-03-20
