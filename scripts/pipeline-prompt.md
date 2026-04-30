# AgentOS Pipeline Run Prompt (generic)

You are running the full AgentOS video pipeline for the project rooted at the
current working directory (which is `workspace/<name>/`). All artifacts must
land under this directory; never write outside of it.

## Step 1 — load project context

1. Read `README.md` if it exists (project description, target episodes, hints).
2. Read `source.txt`. If it does not exist, stop immediately and emit a single
   error line — do not invent material.
3. Read `pipeline-state.json` if it exists. Stages whose `status` is already
   `validated` are done — skip them and resume from the first non-validated
   stage. This makes the run safely re-entrant.

## Step 2 — execute the pipeline

Follow the stage order defined in the repo `CLAUDE.md`:

```
SCRIPT → VISUAL → STORYBOARD → VIDEO → EDITING → MUSIC → SUBTITLE
```

Dispatch rules:

- SCRIPT: choose `script-adapt` for long sources (≥3000 chars), `script-writer`
  for short sources. Use the project README's `target_episodes` hint when set.
- VISUAL / STORYBOARD / VIDEO / EDITING / MUSIC / SUBTITLE: invoke the matching
  skill exactly as documented in `CLAUDE.md`.

State management — every stage transition must be persisted:

- Entering a stage: set `current_stage = <stage>`, stage `status = "running"`.
- Stage produced some artifacts but not all: status = `partial`.
- Stage finished writing artifacts: status = `completed`.
- Stage gate-check (the `ls` verification in `CLAUDE.md`) passed: status =
  `validated`. Only then advance.
- Use `bun python3 scripts/pipeline_state.py` (or read its source for the exact
  CLI) — do not hand-edit the JSON when an entry point exists.

## Step 3 — failure handling (no human in the loop)

- Per-clip / per-episode failure: retry once with the same inputs. If it still
  fails, mark that episode's status `failed`, append a short reason to
  `pipeline-state.json.last_error`, and continue with the next episode.
- Per-stage hard failure (skill itself blows up, missing dependency): mark the
  stage `failed`, record `last_error`, and stop the run with a final summary
  line. Do not silently swallow.
- Never ask the user a clarifying question. When ambiguous, pick the
  conservative option and note it in `last_error`.

## Step 4 — execution constraints

- Model inference must go through `aos-cli model` (see
  `.claude/skills/_shared/AOS_CLI_MODEL.md`). Do not call Gemini / OpenAI / Ark
  SDKs directly from skill scripts.
- Package manager: `bun` for JS/TS, `uv` for Python.
- No emojis in any artifact.
- After each stage transition, emit one short status line (≤ 80 chars) to
  stdout so the host log is readable.

## Step 5 — finish

When SUBTITLE has produced final output:

- Set `current_stage = "DONE"` and `next_action = null` in
  `pipeline-state.json`.
- Emit one final summary line listing the path of the per-episode final
  artifacts.
