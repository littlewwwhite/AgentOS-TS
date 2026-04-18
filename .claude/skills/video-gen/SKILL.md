---
name: video-gen
description: '从剧本到视频的一站式生成工具 - 自动生成分镜提示词 + 批量生成视频。当用户提到视频提示词、生成ep的json文件、剧本转视频、视频分镜、镜头脚本、storyboard、批量生成视频、从剧本生成视频等相关内容时使用此 skill。'
argument-hint: "--episode N or storyboard.json --output DIR"
allowed-tools:
  - Bash
  - Read
---

# Video Gen

从剧本到视频的**一站式生成工具**：分镜提示词生成（Phase 1）+ 批量视频生成与 AI 评审（Phase 2）。

> **路径约定**：文档内引用 skill 自带文件时，直接使用 `references/`、`assets/`、`scripts/` 等相对路径；命令示例统一使用仓库根相对路径。`${PROJECT_DIR}` 含义保持不变。

## 前置检查（每次执行前按序完成）

### 步骤 0: AWB 登录 + 环境依赖检查

```bash
python3 ./.claude/skills/video-gen/scripts/preflight_awb.py \
  --check login,deps \
  --deps google-genai,python-dotenv --cmds ffmpeg --env GEMINI_API_KEY
```

- 登录失败 → 使用相关登录 skill（如 `awb-login`）或等价登录流程引导用户登录，成功后重新执行
- 依赖缺失 → 按输出提示安装

前置检查全部通过后，进入 Mode Selection。

---

## Mode Selection (Highest Priority)

| User says | Mode |
|-----------|------|
| "一键成片" / "一键生成" / "全自动" | **Auto mode** |
| Everything else (default) | **Manual mode** |

### Auto Mode

- Uses `assets/config.json` defaults, **no user confirmation needed**
- Default: `kling_omni`, subject_reference=true, 9:16, 720p
- Run: `python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N --parallel`
- Add `--no-generate-video` only when user explicitly says "only prompts"
- Prompt gen: prompt-generation subagent（当前实现使用 `claude -p`）；video review: Gemini (from `assets/config.json`)

### Manual Mode (4-Step Confirmation)

| Step | Action | Details |
|------|--------|---------|
| 1 | Model selection | `kling_omni` (subject ref, cinematic terms, mm focal) vs `seedance2` (image ref, plain position desc, no mm) |
| 2 | Reference mode | Kling: subject reference? / Seedance: image reference? (default: yes) |
| 3 | Generation params | Ratio (9:16/16:9/1:1), Quality (720p/1080p) |
| 4 | Write config & run | Update `assets/config.json` then execute scripts |

- "Only prompts" → skip Steps 1-3, run with `--no-generate-video`
- Prompt gen: prompt-generation subagent；video review: Gemini API

## 跨集并行策略

🔴 **处理多集视频生成时必须执行以下判断：**

1. 确定待处理集数列表（从用户指令或 `script.json` 中获取）
2. **若待处理 ≤ 2 集**：在当前 session 中逐集执行 Phase 1 + Phase 2
3. **若待处理 > 2 集**：**必须**使用 Agent subagents 并行处理

**并行执行流程（> 2 集时强制执行）：**

```
确定集数列表 → [ep001, ep002, ..., epN]
按每组 2-3 集分组，上限 5 个并行 Agent
每个 Agent 负责其分组内的 Phase 1（prompt 生成）+ Phase 2（视频生成）
并行启动所有 Agent（run_in_background: true）
等待全部完成 → 验证各集 delivery.json 就绪
```

每个 Agent subagent 的 prompt **必须包含**：
1. 完整的前置检查步骤（AWB 登录 + 环境依赖）
2. `${PROJECT_DIR}/output/script.json` 中**本组集**的 episodes 数据
3. `${PROJECT_DIR}/output/actors/actors.json` 和 `locations/locations.json`（subject 映射）
4. 当前 Mode（Auto/Manual）和生成参数（model、ratio、quality）
5. **约束**：「每集独立输出到 `${PROJECT_DIR}/output/ep{NNN}/`，不修改其他集目录。」

> Phase 2 (`batch_generate.py`) 内部已实现 scene 级并行（clip-serial），无需额外拆分。跨集并行由 Agent subagent 负责。

## Core Commands

### Phase 1: Prompt Generation

```bash
# Full prompt generation for episode
python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N

# Skip costume color removal
python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N --no-remove-colors

# Force regenerate
python3 ./.claude/skills/video-gen/scripts/generate_episode_json.py --episode N --force-regenerate
```

### Phase 2: Batch Video Generation

```bash
# Generate videos from storyboard JSON
python3 ./.claude/skills/video-gen/scripts/batch_generate.py \
  ${PROJECT_DIR}/output/ep001/ep001_storyboard.json \
  --output ${PROJECT_DIR}/output/ep001 --episode 1

# Dry run / specific shot / custom ratio
python3 ./.claude/skills/video-gen/scripts/batch_generate.py storyboard.json --output DIR --dry-run
python3 ./.claude/skills/video-gen/scripts/batch_generate.py storyboard.json --output DIR --shot scn001_clip001
python3 ./.claude/skills/video-gen/scripts/batch_generate.py storyboard.json --output DIR --ratio 9:16
```

## I/O Path Conventions

All paths are relative to `${PROJECT_DIR}` (injected at runtime by orchestrator).

```
Input:  ${PROJECT_DIR}/output/script.json
        ${PROJECT_DIR}/output/actors/actors.json      → {act_xxx} subject mapping
        ${PROJECT_DIR}/output/locations/locations.json → {loc_xxx} subject mapping

Phase 1 output: ${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_storyboard.json
Phase 2 output: ${PROJECT_DIR}/output/ep{NNN}/scn{NNN}/clip{NNN}/*.mp4 + *.json
Delivery:       ${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_delivery.json
Logs:           ${PROJECT_DIR}/workspace/logs/ep{NNN}.log (parallel mode)
Frames:         ${PROJECT_DIR}/workspace/ep{NNN}/frames/{scene_id}_clip{NNN}_last_shot_first_frame.png
```

## Unified State File

`video-gen` is the `VIDEO` stage and must keep `${PROJECT_DIR}/workspace/pipeline-state.json` in sync.

- On entry: set `current_stage=VIDEO` and `stages.VIDEO.status=running`
- If `ep{NNN}_storyboard.json` exists but `ep{NNN}_delivery.json` is not ready: set `episodes.ep{NNN}.video.status=partial`
- After `ep{NNN}_delivery.json` is written: set `episodes.ep{NNN}.video.status=completed`
- After target episodes pass verification: set `stages.VIDEO.status=validated` and `next_action=enter EDITING`

Recovery order:

1. Read `${PROJECT_DIR}/workspace/pipeline-state.json` first
2. If missing, check `output/ep{NNN}/ep{NNN}_delivery.json`
3. If only `ep{NNN}_storyboard.json` exists, recover as `partial`

## Key Capabilities

**Phase 1** — Script-to-prompt: auto color removal, prompt optimization, ID injection (`【x】` → `{x}`), 9-dimension shot description, 750-char limit with auto-truncation, sensitive word replacement, v1/v2 dual-version prompts

**Phase 2** — Batch video gen + review loop: per-clip generate-review cycle (min 1, max 2 attempts), Gemini 2-role parallel analysis (reference consistency + prompt compliance), subject/image reference modes, last-shot first-frame injection (ffmpeg scene detect → face blur → COS upload → inject into next clip's `lsi` field + `complete_prompt`)

## Supported Models

| Model | Code | Reference Mode | Duration |
|-------|------|---------------|----------|
| Kling 3.0 Omni | `KeLing3_Omni_VideoCreate_tencent` | Subject ref | 3-15s |
| Seedance 2 | `JiMeng_Seedance_2_VideoCreate` | Image ref | 3-15s |

## Scripts

| Module | Function |
|--------|----------|
| `generate_episode_json.py` | Main script: prompt gen + optimization + ID injection (prompt-generation subagent) |
| `batch_generate.py` | Core: batch video gen + review loop; scene-parallel, clip-serial |
| `frame_extractor.py` | Last-shot first-frame extraction + face blur (ffmpeg + PIL) |
| `video_api.py` | AWB video generation API client |
| `video_generator.py` | Single video generation coordinator |
| `analyzer.py` / `evaluator.py` | Gemini 2-role analyzer + 2-dimension scoring |
| `config_loader.py` | Config loader (reads `assets/config.json`) |

## Relationship to Other Skills

```
video-gen
    ├─ Input: ${PROJECT_DIR}/output/script.json
    ├─ Output: ${PROJECT_DIR}/output/ep###/*.mp4
    ├─ Depends: awb-login (video gen auth)
    ├─ Depends: prompt-generation subagent runtime (current implementation uses `claude -p`)
    └─ Built-in: Gemini video review
```

## References

| Document | Content |
|----------|---------|
| `references/FULL_PROMPT_GENERATION_RULES.md` | Full 9-dimension prompt generation rules, model-branch details, quality checklist |
| `references/STORYBOARD_SCHEMA.md` | JSON field specs (Scene/Clip/Shot levels), v1/v2 dual-version mechanism |
| `references/DIALOGUE_AND_LIMITS.md` | Dialogue cut rules, duration calc, word limits, prompt structure by model |
| `references/SENSITIVE_WORDS.md` | Sensitive word replacement table for content moderation |
| `references/AI_CONFIG_AND_DELIVERY.md` | AI config (prompt-generation subagent + Gemini), delivery JSON format, dependencies |
| `references/VISUAL_DESCRIPTION_EXPANSION.md` | Visual description expansion rules |
| `references/prompt-enhancer.md` | Prompt enhancement tool docs |

## Version

**Current**: 2.4.0 | **Updated**: 2026-03-20
