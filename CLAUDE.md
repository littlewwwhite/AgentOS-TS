# AgentOS — AI Video Production Pipeline

Respond in Chinese (简体中文). Structural keys and code in English.

## Architecture

Single-session + global MCP + flat skills. No agent isolation.
Use Claude Code Agent subagents for parallel work and context isolation.

Repo reality:

- 主体仍然是 flat skills 仓库（`.claude/skills/` 为事实源）
- `apps/console/` 是当前保留的交互控制台实现，直接依赖 Claude Agent SDK
- 因此项目不是“不要 Claude runtime”，而是“skills 为主，console 为可选交互层”

## Skill Path Convention

SKILL.md 内引用 skill 自带文件时，直接使用 `references/`、`assets/`、`scripts/` 等相对路径；命令示例统一使用仓库根相对路径。`${PROJECT_DIR}` 含义保持不变。

## Model Boundary

- Skills that need model calls should use `aos-cli model` through `.claude/skills/_shared/aos_cli_model.py`; see `.claude/skills/_shared/AOS_CLI_MODEL.md`.
- Direct Gemini, OpenAI-compatible, ChatFire, and Ark SDK/API calls in skill scripts are legacy migration targets, not the pattern for new code.

## Pipeline Stages

```
Novel → SCRIPT → VISUAL → STORYBOARD → VIDEO → EDITING → MUSIC → SUBTITLE → Final
```

| # | Stage | Skill | Input | Output | Gate |
|---|-------|-------|-------|--------|------|
| 1 | SCRIPT | `script-adapt` (long novel ≥3000 chars) or `script-writer` (short source expansion) | complete novel/script/source text | `output/script.json` | script.json exists with episodes[] |
| 2 | VISUAL | `asset-gen` | script.json actors/locations/props | `output/{actors,locations,props}/` images + metadata JSON | required asset JSON files exist with usable image paths/URLs |
| 3 | STORYBOARD | `storyboard` | script.json + visual asset references | `output/storyboard/draft/ep{NNN}_storyboard.json` → `output/storyboard/approved/ep{NNN}_storyboard.json` | approved storyboard exists with scenes[].shots[].prompt |
| 4 | VIDEO | `video-gen` | approved storyboard canonical | `output/ep{NNN}/` runtime storyboard + delivery + videos | delivery JSON and video files exist |
| 5 | EDITING | `video-editing` | raw videos | trimmed/selected videos | edited files exist |
| 6 | MUSIC | `music-matcher` | edited videos | scored videos | music tracks applied |
| 7 | SUBTITLE | `subtitle-maker` | scored videos | final videos with subtitles | final/ directory populated |

The pipeline entry is always a complete script, novel, structured story source, or uploaded source document. There is no separate market-research / inspiration stage.

### Dispatch Rules

- When the user provides a novel, existing script, structured story source, or uploaded source document → invoke `script-adapt` or `script-writer`
- When script.json exists and user says "generate assets/visuals" → invoke `asset-gen`
- When assets exist and user says "storyboard/shots" → invoke `storyboard`; do not modify `output/script.json`
- When approved storyboard exists and user says "generate videos" → invoke `video-gen`; VIDEO must not create or rewrite storyboard prompts from `script.json`
- When user says "full production" / "全量制作" → run stages 1-7 sequentially, verifying gates between stages and updating `pipeline-state.json` after every stage boundary
- For partial tasks ("redo episode 3 video"), invoke the specific skill directly

### Parallel Strategy

For long scripts (Phase 2 of script-adapt, multi-episode writing):
- Use Agent subagents to write episodes in parallel batches
- Each subagent reads shared design.json + connectivity.md, writes its assigned ep*.md files
- Main session stays clean — only receives completion summaries

### Stage Verification

Before advancing to the next stage, check file system:
```bash
# After SCRIPT
ls output/script.json

# After VISUAL
ls output/actors/actors.json output/locations/locations.json output/props/props.json

# After STORYBOARD
ls output/storyboard/approved/ep*_storyboard.json

# After VIDEO
ls output/ep*/ep*_delivery.json
```

### Unified State File

Use `pipeline-state.json` as the single machine-readable pipeline index.

- Initialize it before the first stage starts
- Update it at every stage boundary and after every long-running per-episode step
- Use file existence checks as a recovery fallback, not as the primary state source

Allowed status values:

- `not_started`
- `running`
- `partial`
- `failed`
- `completed`
- `validated`

Minimum structure:

```json
{
  "version": 1,
  "updated_at": "2026-03-25T12:00:00Z",
  "current_stage": "SCRIPT",
  "next_action": "enter VISUAL",
  "last_error": null,
  "stages": {
    "SCRIPT": {
      "status": "completed",
      "artifacts": [
        "output/script.json"
      ]
    },
    "VISUAL": {
      "status": "not_started",
      "artifacts": []
    }
  },
  "episodes": {
    "ep001": {
      "storyboard": {
        "status": "completed",
        "artifact": "output/ep001/ep001_storyboard.json"
      },
      "video": {
        "status": "not_started"
      },
      "editing": {
        "status": "not_started"
      },
      "music": {
        "status": "not_started"
      },
      "subtitle": {
        "status": "not_started"
      }
    }
  }
}
```

State transition rules:

- Entering a stage: set stage status to `running`
- Long-running stage produced some but not all artifacts: set stage or episode status to `partial`
- Final artifacts written successfully: set status to `completed`
- Gate check passed and artifacts confirmed readable: set status to `validated`
- Recovering after `/clear`: read `pipeline-state.json` first, then rebuild missing fields from artifacts if needed

## Role Boundaries (enforced by skills, not isolation)

| Domain | Skills | Responsibilities |
|--------|--------|-----------------|
| Screenwriter | script-adapt, script-writer | Script creation only. Never generate images or videos. |
| Director | asset-gen, storyboard | Visual design + asset gen + shot planning. Never modify existing script text. |
| Producer | video-gen, video-editing, music-matcher, subtitle-maker | Execution only. Zero creative decisions — all text from script.json. |

## Project Layout

每个项目以 `{name}` 命名（通常取源文件名或用户指定），**所有产物都落在 `workspace/{name}/` 单一根目录下**，不再使用顶层 `output/`。

```
<repo-root>/
├── data/                          ← uploaded source materials
├── workspace/{name}/              ← per-project root (single source of truth)
│   ├── pipeline-state.json        ← machine-readable pipeline checkpoint
│   ├── source.txt                 ← source copy
│   ├── draft/                     ← LLM intermediates (design.json, connectivity.md, episodes/, …)
│   └── output/                    ← user-facing artifacts
│       ├── script.json
│       ├── actors/  locations/  props/
│       └── ep{NNN}/               ← per-episode storyboard + scn*/clip*/*.mp4
└── .claude/skills/                ← skill definitions
```

Skills 中的 `${PROJECT_DIR}` 在执行时被设置为当前项目根目录 `workspace/{name}/`，因此 `${PROJECT_DIR}/output/...` 自然落在 `workspace/{name}/output/...`。`${WORKSPACE}` 和 `${OUTPUT}` 宏已废弃 —— skills 一律使用 `${PROJECT_DIR}` 前缀。
