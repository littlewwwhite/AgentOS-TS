# Skill Consolidation & Pipeline Optimization

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate 3 redundant skills, merge 2 agents into 1, slim all SKILL.md files by ~75%, and extract shared code — reducing pipeline overhead from 5 agent switches / 10 skills to 4 switches / 7 skills.

**Architecture:** The current 5-agent / 10-skill setup has 3 dead skills (`create-subject`, `kling-video-prompt`, `video-create`) whose functionality is already subsumed by other skills. `video-editor` and `post-production` agents share the video processing domain and can merge into a single `post-processor` agent. All SKILL.md files carry ~75% boilerplate that duplicates info already injected by `session-specs.ts`.

**Tech Stack:** TypeScript (session-specs.ts, agent manifests), Python (shared scripts), Markdown (SKILL.md, CLAUDE.md), YAML (agent manifests)

---

## Phase 1: Delete Redundant Skills (safe, no dependents)

### Task 1: Delete `create-subject` skill

**Context:** `asset-gen` already has `--create-subjects` flag that calls the same logic. Pipeline in `session-specs.ts` no longer references `create-subject`. The skill's `subject_api.py` is still useful as a library — keep it accessible but remove the skill wrapper.

**Files:**
- Delete: `agents/art-director/.claude/skills/create-subject/SKILL.md`
- Delete: `agents/art-director/.claude/skills/create-subject/references/`
- Move: `agents/art-director/.claude/skills/create-subject/scripts/subject_api.py` → `agents/_shared/scripts/subject_api.py`
- Move: `agents/art-director/.claude/skills/create-subject/references/api-spec.md` → `agents/art-director/.claude/skills/asset-gen/references/subject-api-spec.md`
- Modify: `agents/art-director/.claude/skills/asset-gen/SKILL.md` — add note that subject creation is built-in via `--create-subjects`

**Step 1: Verify create-subject is not referenced in pipeline**

Run: `grep -r "create-subject\|create_subject" agents/ src/ --include="*.ts" --include="*.yaml" --include="*.md" -l`

Expected: Only hits in `create-subject/` itself and possibly `asset-gen` references. No hits in `session-specs.ts` or `*.yaml` manifests.

**Step 2: Move reusable scripts to _shared**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
mkdir -p agents/_shared/scripts
git mv agents/art-director/.claude/skills/create-subject/scripts/subject_api.py agents/_shared/scripts/subject_api.py
git mv agents/art-director/.claude/skills/create-subject/references/api-spec.md agents/art-director/.claude/skills/asset-gen/references/subject-api-spec.md
```

**Step 3: Update asset-gen imports that reference subject_api**

Read `agents/art-director/.claude/skills/asset-gen/scripts/common_create_subjects.py` and update any `sys.path` or import that pointed to `create-subject/scripts/`.

**Step 4: Delete the skill directory**

```bash
git rm -r agents/art-director/.claude/skills/create-subject/
```

**Step 5: Verify asset-gen still works**

Run: `python3 -c "import ast; ast.parse(open('agents/art-director/.claude/skills/asset-gen/scripts/common_create_subjects.py').read()); print('OK')"`

**Step 6: Commit**

```bash
git add -A agents/art-director agents/_shared
git commit -m "refactor: remove create-subject skill (absorbed by asset-gen --create-subjects)"
```

---

### Task 2: Delete `kling-video-prompt` skill

**Context:** `storyboard-generate` in footage-producer is the superset — its Phase 1 does exactly what `kling-video-prompt` does, plus Phase 2 adds batch video generation. The `generate_episode_json.py` in footage-producer is 3475 lines (evolved) vs 712 lines (legacy) in art-director. The `--no-generate-video` flag on storyboard-generate already covers the "only generate prompts" use case.

**Files:**
- Delete: `agents/art-director/.claude/skills/kling-video-prompt/` (entire directory)
- Modify: `agents/art-director.yaml` — remove `kling-video-prompt` from skills list

**Step 1: Verify no pipeline dependency**

Run: `grep -r "kling-video-prompt\|kling_video_prompt" src/ agents/*.yaml --include="*.ts" --include="*.yaml" -l`

Expected: Only `agents/art-director.yaml`. Not in `session-specs.ts`.

**Step 2: Remove from agent manifest**

Edit `agents/art-director.yaml`:

```yaml
# Before
skills:
  asset-gen:
  kling-video-prompt:

# After
skills:
  asset-gen:
```

**Step 3: Delete the skill directory**

```bash
git rm -r agents/art-director/.claude/skills/kling-video-prompt/
```

**Step 4: Commit**

```bash
git add agents/art-director.yaml agents/art-director/.claude/skills/
git commit -m "refactor: remove kling-video-prompt skill (superseded by storyboard-generate)"
```

---

### Task 3: Retire `video-create` as standalone skill (keep as utility)

**Context:** `video-create` is the single-video ad-hoc tool. It's NOT used in the full pipeline (storyboard-generate handles batch generation). However, users may want to generate a single video interactively. Decision: keep it in the manifest but mark it as an ad-hoc utility, not a pipeline stage.

**Files:**
- Modify: `agents/footage-producer/.claude/skills/video-create/SKILL.md` — add header note "Ad-hoc single video generation. NOT part of the full pipeline — use storyboard-generate for batch production."

**Step 1: Add utility label to SKILL.md**

Edit `agents/footage-producer/.claude/skills/video-create/SKILL.md` line 9:

```markdown
# Video Create Skill

> **Note:** This is an ad-hoc utility for single video generation. For full pipeline batch production, use `storyboard-generate` which handles prompt generation + batch video creation + AI review automatically.

通过 anime-material-workbench 提交单条视频生成任务并管理异步轮询。
```

**Step 2: Commit**

```bash
git add agents/footage-producer/.claude/skills/video-create/SKILL.md
git commit -m "docs: mark video-create as ad-hoc utility (pipeline uses storyboard-generate)"
```

---

## Phase 2: Merge video-editor + post-production → post-processor

### Task 4: Create post-processor agent manifest

**Files:**
- Create: `agents/post-processor.yaml`
- Create: `agents/post-processor/` directory structure
- Delete (later): `agents/video-editor.yaml`, `agents/post-production.yaml`

**Step 1: Create merged manifest**

Create `agents/post-processor.yaml`:

```yaml
name: post-processor
description: "后期制作：视频剪辑（多变体选优、AI 循环剪辑、Premiere XML）、智能配乐、ASR 字幕生成。"
mcpServers:
  - video
  - audio
  - awb
  - viking
skills:
  video-editing:
  music-matcher:
  subtitle-maker:
```

**Step 2: Create directory structure**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/agents
mkdir -p post-processor/.claude/skills
```

**Step 3: Move skills from both agents**

```bash
# Move video-editing from video-editor
git mv video-editor/.claude/skills/video-editing post-processor/.claude/skills/video-editing

# Move music-matcher and subtitle-maker from post-production
git mv post-production/.claude/skills/music-matcher post-processor/.claude/skills/music-matcher
git mv post-production/.claude/skills/subtitle-maker post-processor/.claude/skills/subtitle-maker
```

**Step 4: Create merged CLAUDE.md**

Create `agents/post-processor/.claude/CLAUDE.md`:

```markdown
# Role: post-processor

You are a specialized agent in a video production pipeline.
Stay in character — only perform tasks within your domain.
Respond in Chinese (简体中文), use English for structural keys and code.

## AWB Authentication Strategy

- refreshToken is permanent — never require SMS login again
- On token expiry or API 701 error: call `awb_get_auth(force_refresh: true)` to refresh
- NEVER call `awb_login` unless `awb_get_auth` returns "AWB config not found"

## Pipeline

All paths use `${PROJECT_DIR}` which is injected at runtime by the orchestrator.

### Phase A: Video Editing
- Input: `${PROJECT_DIR}/output/ep{NNN}/scn{NNN}/clip{NNN}/*.mp4`
- Output: `${PROJECT_DIR}/output/editing/ep{NNN}/ep{NNN}.mp4` + `ep{NNN}.xml`
- Skill: video-editing (3-phase: scene analysis → loop editing → EP merge)

### Phase B: Music Matching
- Input: edited video from Phase A
- Output: `${PROJECT_DIR}/output/ep{NNN}/ep{NNN}_with_music.mp4`
- Skill: music-matcher (Gemini analysis → MCP vector match → FFmpeg compose)

### Phase C: Subtitle Generation
- Input: video from Phase B + `${PROJECT_DIR}/output/script.json`
- Output: `${PROJECT_DIR}/output/final/ep{NNN}.mp4` + `.srt` + `.xml`
- Skill: subtitle-maker (glossary → ASR → SRT → burn → XML)
```

**Step 5: Copy settings.json from video-editor (merge deny rules)**

Read both `video-editor/.claude/settings.json` and `post-production/.claude/settings.json`, merge their deny rules into a new `post-processor/.claude/settings.json`.

**Step 6: Delete old agent directories**

```bash
git rm -r video-editor/.claude/
git rm video-editor.yaml
git rm -r post-production/.claude/
git rm post-production.yaml
```

**Step 7: Update session-specs.ts pipeline**

Edit `src/session-specs.ts` — replace stages 5+6 with single `post-processor` stage:

```
5. **POST-PROCESSING** → post-processor (video-editing → music-matcher → subtitle-maker)
   - Input: video clips from step 3
   - Output: \${PROJECT_DIR}/output/final/
   - Note: three sequential sub-skills: editing → music → subtitles
```

**Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/session-specs.ts 2>&1 | grep -v node_modules`

**Step 9: Commit**

```bash
git add -A agents/ src/session-specs.ts
git commit -m "refactor: merge video-editor + post-production → post-processor agent"
```

---

## Phase 3: Extract Shared Code

### Task 5: Deduplicate detect_source_structure.py

**Context:** Identical 487-line file exists in both `script-adapt/scripts/` and `script-writer/scripts/`.

**Files:**
- Move: `agents/screenwriter/.claude/skills/script-adapt/scripts/detect_source_structure.py` → `agents/_shared/scripts/detect_source_structure.py`
- Delete: `agents/screenwriter/.claude/skills/script-writer/scripts/detect_source_structure.py`
- Modify: Both SKILL.md files to reference `agents/_shared/scripts/detect_source_structure.py`

**Step 1: Move to shared**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git mv agents/screenwriter/.claude/skills/script-adapt/scripts/detect_source_structure.py agents/_shared/scripts/detect_source_structure.py
git rm agents/screenwriter/.claude/skills/script-writer/scripts/detect_source_structure.py
```

**Step 2: Update SKILL.md references**

In both `script-adapt/SKILL.md` and `script-writer/SKILL.md`, update the script path from `${CLAUDE_SKILL_DIR}/scripts/detect_source_structure.py` to `${PROJECT_DIR}/../agents/_shared/scripts/detect_source_structure.py`.

Actually, since agent CWD = `agents/screenwriter/`, the relative path would be `../../_shared/scripts/detect_source_structure.py` from CWD. But we should use an absolute approach:

```bash
python3 $(dirname $(dirname ${CLAUDE_SKILL_DIR}))/../_shared/scripts/detect_source_structure.py --project-dir ${PROJECT_DIR}
```

Better: use a `AGENTS_DIR` env var or just hardcode relative to CWD which is `agents/screenwriter/`:

```bash
python3 ../../_shared/scripts/detect_source_structure.py --project-dir ${PROJECT_DIR}
```

Note: `../../` from `agents/screenwriter/` → `agents/_shared/scripts/`.

Wait — CWD is `agents/screenwriter/`, so `../../_shared/scripts/` = `_shared/scripts/` relative to `agents/`. Let me recalculate:
- CWD: `agents/screenwriter/`
- Target: `agents/_shared/scripts/detect_source_structure.py`
- Relative: `../_shared/scripts/detect_source_structure.py`

**Step 3: Verify syntax**

Run: `python3 -c "import ast; ast.parse(open('agents/_shared/scripts/detect_source_structure.py').read()); print('OK')"`

**Step 4: Commit**

```bash
git add -A agents/
git commit -m "refactor: deduplicate detect_source_structure.py → _shared/scripts/"
```

---

### Task 6: Extract shared AWB preflight check

**Context:** 4 skills repeat near-identical AWB login + dependency checks in their SKILL.md. Extract to a shared script.

**Files:**
- Create: `agents/_shared/scripts/preflight_awb.py`
- Modify: `asset-gen/SKILL.md`, `storyboard-generate/SKILL.md`, `video-create/SKILL.md`, `music-matcher/SKILL.md` — replace inline checks with script call

**Step 1: Create shared preflight script**

Create `agents/_shared/scripts/preflight_awb.py`:

```python
#!/usr/bin/env python3
"""Shared AWB preflight check: dependencies + auth status."""
import sys
import os
import importlib
import shutil
import json

def check_dependencies(extra_modules=None):
    """Check Python modules and system tools."""
    missing = []
    base_modules = {"requests": "requests", "dotenv": "python-dotenv"}
    if extra_modules:
        base_modules.update(extra_modules)
    for mod, pkg in base_modules.items():
        try:
            importlib.import_module(mod)
        except ImportError:
            missing.append(pkg)
    for cmd in ["ffmpeg", "ffprobe"]:
        if not shutil.which(cmd):
            missing.append(f"{cmd} (system tool)")
    if not os.getenv("GEMINI_API_KEY"):
        missing.append("GEMINI_API_KEY env var not set")
    return missing

def check_awb_auth():
    """Check if AWB auth config exists."""
    auth_path = os.path.expanduser("~/.animeworkbench_auth.json")
    if not os.path.exists(auth_path):
        return False, "AWB config not found"
    with open(auth_path) as f:
        data = json.load(f)
    if not data.get("refreshToken"):
        return False, "No refreshToken in config"
    return True, "OK"

if __name__ == "__main__":
    extra = {}
    if "--gemini" in sys.argv:
        extra["google.genai"] = "google-genai"

    missing = check_dependencies(extra)
    if missing:
        print(f"Missing dependencies: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    ok, msg = check_awb_auth()
    if not ok:
        print(f"AWB auth: {msg}", file=sys.stderr)
        sys.exit(2)

    print("All preflight checks passed")
```

**Step 2: Replace inline checks in each SKILL.md**

In each SKILL.md that has an inline dependency check, replace the multi-line `python3 -c "..."` block with:

```bash
python3 ../_shared/scripts/preflight_awb.py --gemini
```

(adjust `../_shared` path based on agent CWD)

**Step 3: Commit**

```bash
git add agents/_shared/scripts/preflight_awb.py agents/*/
git commit -m "refactor: extract shared AWB preflight check to _shared/scripts/"
```

---

## Phase 4: Slim SKILL.md Files

### Task 7: Slim all SKILL.md files (~75% reduction)

**Principle:** SKILL.md should contain ONLY:
1. Frontmatter (name, description, allowed-tools)
2. Mode selection / entry point
3. Core commands with exact invocations
4. Hardcoded constraints that Claude MUST follow
5. One-line references to `references/` for details

**Remove from all SKILL.md:**
- Redundant workspace structure (already in session-specs.ts `PROJECT_DIR` injection)
- Redundant preflight checks (now in shared script)
- Inline reference file listings (replace with "see references/")
- Repeated I/O path conventions (already in CLAUDE.md pipeline section)
- Version numbers and changelog (not needed at runtime)

**Files to modify (7 skills):**
- `agents/screenwriter/.claude/skills/script-adapt/SKILL.md`
- `agents/screenwriter/.claude/skills/script-writer/SKILL.md`
- `agents/art-director/.claude/skills/asset-gen/SKILL.md`
- `agents/footage-producer/.claude/skills/storyboard-generate/SKILL.md`
- `agents/footage-producer/.claude/skills/video-create/SKILL.md`
- `agents/post-processor/.claude/skills/music-matcher/SKILL.md`
- `agents/post-processor/.claude/skills/subtitle-maker/SKILL.md`

**Step 1: For each skill, rewrite SKILL.md**

Target: ~50 lines per skill. Keep frontmatter + core workflow + commands + constraints.
Move all other content to `references/workflow-details.md` if not already in references.

**Step 2: Verify skill discovery still works**

```bash
grep -l "^---" agents/*/\.claude/skills/*/SKILL.md | wc -l
```

Expected: 7 (all skills still have valid frontmatter)

**Step 3: Commit**

```bash
git add agents/
git commit -m "refactor: slim all SKILL.md files (~75% reduction, details moved to references/)"
```

---

## Phase 5: Update Orchestrator

### Task 8: Update session-specs.ts for 4-agent pipeline

**Files:**
- Modify: `src/session-specs.ts`

**Step 1: Update pipeline description**

The pipeline in `buildMainSessionSpec` should reflect the new 4-agent structure:

```
1. SCRIPT → screenwriter (script-adapt or script-writer)
2. ASSETS → art-director (asset-gen with --create-subjects)
3. VIDEO  → footage-producer (storyboard-generate)
4. POST   → post-processor (video-editing → music-matcher → subtitle-maker)
```

**Step 2: Verify TypeScript**

Run: `npx tsc --noEmit src/session-specs.ts 2>&1 | grep -v node_modules`

**Step 3: Commit**

```bash
git add src/session-specs.ts
git commit -m "refactor: update pipeline for 4-agent architecture"
```

---

## Verification

### Task 9: Final verification

**Step 1: No orphaned references**

```bash
# Check no remaining references to deleted skills
grep -r "create-subject\|kling-video-prompt" agents/ src/ --include="*.ts" --include="*.yaml" --include="*.md" -l | grep -v "_shared/path-conventions"
```

Expected: No matches (or only in path-conventions.md deprecated section).

**Step 2: Agent manifests valid**

```bash
for f in agents/*.yaml; do echo "=== $f ==="; cat "$f"; echo; done
```

Expected: 4 agent yamls (screenwriter, art-director, footage-producer, post-processor) + skill-creator.yaml

**Step 3: All SKILL.md have valid frontmatter**

```bash
for f in agents/*/.claude/skills/*/SKILL.md; do
  name=$(grep "^name:" "$f" | head -1)
  desc=$(grep "^description:" "$f" | head -1)
  echo "$f: $name | ${desc:0:60}..."
done
```

Expected: 7 skills with valid name + description.

**Step 4: All Python scripts parse**

```bash
find agents/ -name "*.py" -exec python3 -c "import ast; ast.parse(open('{}').read())" \; 2>&1 | grep -v "^$"
```

Expected: No errors.

**Step 5: Line count comparison**

```bash
echo "=== SKILL.md total lines ==="
find agents/ -name "SKILL.md" -exec wc -l {} + | tail -1
echo "=== Agent count ==="
ls agents/*.yaml | wc -l
echo "=== Skill count ==="
find agents/ -name "SKILL.md" | wc -l
```

Expected: ~350 total SKILL.md lines (down from ~1500), 5 agents (4 + skill-creator), 7 skills.

---

## Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Agents | 5 (+skill-creator) | 4 (+skill-creator) | -1 |
| Skills | 10 | 7 | -3 |
| SKILL.md total lines | ~1500 | ~350 | -77% |
| Agent switches (full pipeline) | 5 | 4 | -20% |
| Duplicated Python code | ~1500 lines | 0 | -100% |
| Redundant skills | 3 | 0 | eliminated |
