# AgentOS — AI Video Production Pipeline

Respond in Chinese (简体中文). Structural keys and code in English.

## Architecture

Single-session + global MCP + flat skills. No agent isolation.
Use Claude Code Agent subagents for parallel work and context isolation.

## Skill Path Convention

SKILL.md 内引用 skill 自带文件时，直接使用 `references/`、`assets/`、`scripts/` 等相对路径；命令示例统一使用仓库根相对路径。`${PROJECT_DIR}` 含义保持不变。

## AWB Authentication Strategy

- refreshToken is permanent — never require SMS login again
- On token expiry or API 701 error: call `awb_get_auth(force_refresh: true)` to refresh
- NEVER call `awb_login` unless `awb_get_auth` returns "AWB config not found"

## Pipeline Stages

```
Novel → SCRIPT → VISUAL → STORYBOARD → VIDEO → EDITING → MUSIC → SUBTITLE → Final
```

| # | Stage | Skill | Input | Output | Gate |
|---|-------|-------|-------|--------|------|
| 1 | SCRIPT | `script-adapt` (long novel ≥3000 chars) or `script-writer` (original/short story) | source text | `${OUTPUT}/script.json` | script.json exists with episodes[] |
| 2 | VISUAL | `asset-gen` | script.json actors/locations/props | `${OUTPUT}/{actors,locations,props}/` images + element_id | actors have visual + element_id |
| 3 | STORYBOARD | `storyboard` | script.json + real asset images | script.json with scenes[].shots[].prompt | shots contain prompt field |
| 4 | VIDEO | `video-gen` | script.json with shots + element_id | `${OUTPUT}/ep{NNN}/` videos | video files exist |
| 5 | EDITING | `video-editing` | raw videos | trimmed/selected videos | edited files exist |
| 6 | MUSIC | `music-matcher` | edited videos | scored videos | music tracks applied |
| 7 | SUBTITLE | `subtitle-maker` | scored videos | final videos with subtitles | final/ directory populated |

### Dispatch Rules

- When the user provides a novel or says "write a script" → invoke `script-adapt` or `script-writer`
- When script.json exists and user says "generate assets/visuals" → invoke `asset-gen`
- When assets exist and user says "storyboard/shots" → invoke `storyboard`
- When user says "full production" / "全量制作" → run stages 1-7 sequentially, verifying gates between stages and updating `${WORKSPACE}/pipeline-state.json` after every stage boundary
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
ls ${OUTPUT}/script.json

# After VISUAL
ls ${OUTPUT}/actors/ ${OUTPUT}/locations/

# After STORYBOARD
python3 -c "import json; d=json.load(open('${OUTPUT}/script.json')); print(any('shots' in s for ep in d.get('episodes',[]) for s in ep.get('scenes',[])))"
```

### Unified State File

Use `${WORKSPACE}/pipeline-state.json` as the single machine-readable pipeline index.

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

每个项目以 `{name}` 命名（通常取源文件名或用户指定），workspace 和 output 按项目名隔离。`${PROJECT_DIR}` 为仓库根目录。

```
${PROJECT_DIR}/
├── data/                    ← uploaded source materials
├── workspace/{name}/        ← per-project intermediate artifacts
│   ├── pipeline-state.json  ← machine-readable pipeline checkpoint
│   ├── source.txt           ← source copy
│   ├── draft/               ← LLM-generated intermediates
│   │   ├── design.json
│   │   ├── catalog.json
│   │   ├── connectivity.md
│   │   └── episodes/
│   └── ...
├── output/{name}/           ← per-project final deliverables
│   ├── script.json          ← structured script
│   ├── actors/              ← character images
│   ├── locations/           ← scene images
│   ├── props/               ← prop images
│   └── ep{NNN}/             ← per-episode video + audio
└── .claude/skills/          ← skill definitions
```

Skills 中引用路径时使用 `${WORKSPACE}` 和 `${OUTPUT}` 简写：
- `${WORKSPACE}` = `${PROJECT_DIR}/workspace/{name}`
- `${OUTPUT}` = `${OUTPUT}/{name}`
