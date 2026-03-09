# Skills

AgentOS skill directory. Each subdirectory is an independent skill — a set of instructions that teaches Claude how to execute specific workflows.

> Authoring reference: `docs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf`

---

## Part I — Authoring Guide

This section defines the **mandatory conventions** for creating and maintaining skills in this repository.

### 1. Progressive Disclosure

Skills use a three-level loading system to minimize token usage:

| Level | Location | Loaded When | Purpose |
|-------|----------|-------------|---------|
| **L1** | YAML frontmatter | Always (injected into system prompt) | Claude decides whether to activate this skill |
| **L2** | SKILL.md body | Skill activated by Claude | Full workflow instructions |
| **L3** | `references/`, `resources/`, `assets/` | Explicitly requested in SKILL.md | Detailed docs, data, templates |

**Core principle**: SKILL.md is the **routing hub**, not the knowledge dump. Move detail to L3.

### 2. File Structure

```
your-skill-name/               # kebab-case only
├── SKILL.md                    # REQUIRED — main instruction file
├── scripts/                    # Optional — executable code (Python, Bash)
│   ├── auth.py
│   └── submit_task.py
├── references/                 # Optional — workflow guides, API specs (load per-phase)
│   ├── api.md
│   └── phase1-guide.md
├── resources/                  # Optional — shared knowledge base (load once, reuse cross-phase)
│   └── writing-rules.md
└── assets/                     # Optional — output templates, static data
    └── report-template.md
```

**Naming rules:**

| Item | Convention | Good | Bad |
|------|-----------|------|-----|
| Skill folder | `kebab-case` | `image-create` | `Image_Create` |
| Main file | Exactly `SKILL.md` | `SKILL.md` | `skill.md`, `SKILL.MD` |
| Scripts | `snake_case.py` | `submit_task.py` | `submitTask.py` |
| Reference docs | `kebab-case.md` | `phase3-extraction.md` | `Phase3Extraction.md` |

**Forbidden inside skill folders:**
- `README.md` — all documentation goes in SKILL.md or references/
- `.env` files — document required env vars in SKILL.md, actual values live outside
- `node_modules/`, `__pycache__/` — already gitignored

### 3. YAML Frontmatter (REQUIRED)

Every SKILL.md **must** begin with YAML frontmatter. This is the L1 trigger mechanism.

```yaml
---
name: your-skill-name
description: >
  What it does. Use when user says "trigger phrase A" or "trigger phrase B".
  Key capabilities and scope boundaries.
---
```

**Field specification:**

| Field | Required | Rules |
|-------|----------|-------|
| `name` | Yes | `kebab-case`, must match folder name |
| `description` | Yes | Under 1024 chars, no XML tags (`<` or `>`), must include trigger phrases |
| `allowed-tools` | Optional | Restrict available tools: `["Read", "Write", "mcp__server__tool"]` |
| `model` | Optional | Override model: `sonnet`, `opus` |
| `argument-hint` | Optional | CLI argument hint: `<video-file-path>` |
| `metadata.version` | Recommended | SemVer: `1.0.0` |
| `metadata.author` | Recommended | Author name |
| `metadata.mcp-server` | If applicable | MCP server name referenced by skill |

**Description formula:**

```
[What it does] + [When to use — include trigger phrases] + [Key capabilities / scope]
```

```yaml
# GOOD — specific, actionable, with triggers
description: >
  AI short-drama script adaptation pipeline (novel-to-script).
  Use when user says "adapt novel", "novel-to-script", or provides
  source text for drama conversion. Three-phase: design extraction,
  episode writing, structural parsing. Outputs script.json.

# BAD — vague, no triggers
description: Helps with script writing.

# BAD — too technical, no user phrases
description: Implements the NTSV2 pipeline with 3-phase extraction.
```

### 4. SKILL.md Body Structure

Follow this section order. Scale each section to its complexity — a few lines if straightforward, a paragraph if nuanced.

```markdown
---
name: your-skill-name
description: ...
---

# {Skill Name}

{One-line purpose statement.}

## Prerequisites

- Required env vars: `API_KEY`, `SECRET`
- External tools: `ffmpeg`, `python3`
- MCP servers: `mcp-server-name`

## Resources

| File | Purpose | Load Strategy |
|------|---------|--------------|
| `references/api.md` | Full API specification | on-demand |
| `references/phase1-guide.md` | Phase 1 workflow | on-demand (enter Phase 1) |
| `resources/writing-rules.md` | Writing conventions | once (load at start) |
| `scripts/auth.py` | Token management | on-demand |

## Workflow

### Step 0: Initialize
{What to check / set up before starting}

### Step 1: {Phase Name}
{Clear instructions with expected inputs and outputs}

### Step N: {Final Phase}
{Completion criteria}

## Key Rules

1. CRITICAL: {Non-negotiable constraint}
2. MUST: {Required behavior}
3. NEVER: {Forbidden action}

## Error Handling

### {Error Type}
- **Cause**: {Why it happens}
- **Solution**: {How to fix}

## Context Recovery

After session restart, check workspace state to determine resume point.
```

### 5. Size Budget

| Component | Target | Hard Limit |
|-----------|--------|------------|
| SKILL.md total | < 500 lines | 800 lines |
| SKILL.md word count | < 3,000 words | 5,000 words |
| Single reference file | < 8,000 words | 15,000 words |
| If reference > 15K words | Split into multiple files | — |

**Rationale**: oversized SKILL.md degrades Claude's instruction-following quality. Move detail to L3.

### 6. Writing Instructions Well

**Be specific and actionable:**

```markdown
# GOOD
Run `python ${CLAUDE_SKILL_DIR}/scripts/auth.py` to obtain a token.
If it returns "token_expired", run `python ${CLAUDE_SKILL_DIR}/scripts/login.py`.

# BAD
Make sure authentication works before proceeding.
```

**Mark hard constraints clearly** — use `CRITICAL:`, `MUST`, `NEVER`:

```markdown
## Key Rules
1. CRITICAL: Model list API is called **once** per session — cache the result
2. User MUST explicitly choose the model; NEVER assume a default
3. NEVER expose raw API error responses to user
```

**Reference bundled resources explicitly:**

```markdown
Before writing queries, consult `references/api-patterns.md` for:
- Rate limiting guidance
- Pagination patterns
- Error codes and handling
```

**Avoid ambiguous language:**

```markdown
# BAD
Validate the data before proceeding.

# GOOD
CRITICAL: Before calling create_project, verify:
- Project name is non-empty
- Episode count is between 1 and 100
- Source text exists at {workspace}/source.txt
```

### 7. Workspace & Path Conventions

For skills that operate on project workspaces:

```markdown
## Workspace Structure

All paths relative to `{workspace}/` (injected at runtime):

{workspace}/
├── draft/              # Working files (input to each phase)
│   ├── design.json
│   ├── catalog.json
│   └── episodes/ep*.md
└── output/             # Final deliverables
    └── script.json
```

- Always use `{workspace}/` placeholder — **never** hardcode absolute paths
- Script paths use `${CLAUDE_SKILL_DIR}/scripts/`
- Token/auth files go to `~/.config/{service}/` — not inside workspace

**Context recovery** (required for multi-phase skills):

```markdown
## Context Recovery

After `/clear` or session restart, check workspace state:
1. `{workspace}/draft/design.json` exists → Phase 1 complete
2. `{workspace}/draft/episodes/ep*.md` exists → Phase 2 complete
3. `{workspace}/output/script.json` exists → Phase 3 complete
Resume from the next incomplete phase.
```

### 8. Script Conventions

```python
# Portable path reference
import sys, os
sys.path.insert(0, os.path.join(os.environ.get('CLAUDE_SKILL_DIR', '.'), 'scripts'))
```

- File names: `snake_case.py`
- Long-running tasks: use `run_in_background: true` for polling scripts
- Auth pattern: token managed by `scripts/auth.py`, persisted in `~/.config/`, auto-refresh on 401
- All scripts must handle errors gracefully and output actionable messages

### 9. MCP Integration

When a skill orchestrates MCP tools:

```markdown
## MCP Tools Used

| Tool | Purpose | Phase |
|------|---------|-------|
| `mcp__script__parse_script` | Parse episodes into script.json | Phase 3 |
```

- Tool names are **case-sensitive** — verify against MCP server docs
- Document expected input/output for each tool call
- Include error handling for connection refused / timeout
- MCP tools can be auto-inferred from `allowed-tools` patterns (`mcp__<server>__<tool>`)

### 10. Language Rules

| Context | Language |
|---------|----------|
| YAML frontmatter (`name`) | English |
| YAML frontmatter (`description`) | English (with Chinese trigger phrases if applicable) |
| SKILL.md body text | Chinese (Simplified) |
| Code, commands, identifiers | English |
| Reference doc body text | Chinese (Simplified) |
| File names | English |

### 11. Quality Checklist

Before merging a new or modified skill:

- [ ] **Frontmatter**: has `name` + `description`; `name` matches folder name
- [ ] **Description**: includes user trigger phrases, under 1024 chars, no XML
- [ ] **Size**: SKILL.md under 800 lines; detail moved to references/
- [ ] **Workflow**: numbered steps with clear inputs/outputs per step
- [ ] **Key Rules**: hard constraints marked with CRITICAL/MUST/NEVER
- [ ] **Resources table**: all files in references/, resources/, scripts/ listed with load strategy
- [ ] **No hardcoded paths**: uses `{workspace}/` or `${CLAUDE_SKILL_DIR}`
- [ ] **Error handling**: common failure modes documented with cause/solution
- [ ] **Scripts**: `snake_case.py`, handle errors, output actionable messages
- [ ] **Tested**: manually verified skill triggers on expected user queries

---

## Part II — Architecture Overview

### Data Pipeline (DAG)

```
Novel / Idea
    │
    ├─► script-writer (SWS original / NTSV2 adaptation)
    │       output: s7-scripts.md (needs conversion)
    │
    ├─► script-adapt (3-phase direct adaptation)
    │       output: script.json + catalog.json + design.json
    │
    └───────────────┬──────────────────────────┐
                    ▼                          ▼
             image-create/edit          kling-video-prompt
             (character/scene/prop       (script → shot prompts)
              asset generation)                │
                    │                   ep{XX}_shots.json
                    │                          │
                    └──────────┬───────────────┘
                               ▼
                          video-create
                          (asset upload + video generation)
                               │
                               ▼
                          video-review
                          (6-tier review + auto-regeneration)
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
               Pass → continue       Fail → optimize prompt
                    │                → video-create regen
                    ▼
               music-matcher
               (video analysis → vector match → compose)
                    │
                    ▼
               Final video delivery
```

Auxiliary:
- `music-finder` → `music-matcher` (music genre query service)
- `skill-creator` (meta skill for creating new skills)

### Core Data Contracts

Pipeline stages communicate via files. These contracts are **non-breaking**:

| Contract File | Upstream | Downstream | Format |
|--------------|----------|------------|--------|
| `script.json` | script-adapt (Phase 3) | kling-video-prompt | JSON (episodes > scenes > actions) |
| `catalog.json` | script-adapt (Phase 1) | Pipeline-wide (actor/location ID map) | JSON |
| `design.json` | script-adapt (Phase 1) | Pipeline-wide (worldview + visual style) | JSON |
| `ep{XX}_shots.json` | kling-video-prompt | video-create, video-review | JSON (segments array) |

### Project Workspace Layout

```
project-workspace/
├── 01-script/output/         # Script deliverables
│   ├── script.json
│   ├── design.json
│   ├── catalog.json
│   └── episodes/ep*.md
├── 02-assets/output/         # Image assets
│   ├── characters/
│   ├── scenes/
│   └── props/
└── 03-video/                 # Video + review
    ├── workspace/input  → symlink → 01-script/output/
    ├── workspace/assets → symlink → 02-assets/output/
    └── output/ep{XX}/ep{XX}_shots.json
```

### Inter-Skill Communication

Skills **do not** communicate directly. Coordination mechanisms:

1. **File contracts** — upstream writes to agreed path, downstream reads from it
2. **Symlink bridging** — `03-video/workspace/` symlinks to upstream outputs
3. **User orchestration** — user invokes skills in pipeline order
4. **Shared auth** — image-create/image-edit/video-create share `~/.animeworkbench_auth.json`

### Shared Resources

Files duplicated across skills that must stay in sync:

| File | Exists In |
|------|-----------|
| `writing-rules.md` | script-writer/resources/, script-adapt/references/ |
| `shared-domain.md` | script-writer/resources/, script-adapt/references/ |
| `style-options.md` | script-writer/resources/, script-adapt/references/ |

---

## Part III — Skill Index

### Script Layer

| Skill | Phases | Input | Output |
|-------|--------|-------|--------|
| `script-writer` | 9 (S1-S9) | User idea or novel | `s7-scripts.md` |
| `script-adapt` | 3 (P1-P3) | source.txt | `script.json` + `catalog.json` + `design.json` |

### Asset Layer

| Skill | Type | API Base |
|-------|------|----------|
| `image-create` | Image generation | `animeworkbench-pre.lingjingai.cn` |
| `image-edit` | Image editing | `animeworkbench-pre.lingjingai.cn` |

### Video Layer

| Skill | Type | Key Feature |
|-------|------|-------------|
| `kling-video-prompt` | Prompt generation | script.json → bilingual shot prompts |
| `video-create` | Video generation | `animeworkbench.lingjingai.cn` |
| `video-review` | Quality review | 6-tier rule system + auto-regen loop |

### Audio Layer

| Skill | Type | Key Feature |
|-------|------|-------------|
| `music-matcher` | Auto scoring | Gemini analysis → vector match → FFmpeg compose |
| `music-finder` | Genre database | 5,947 genres from RateYourMusic |

### Meta

| Skill | Purpose |
|-------|---------|
| `skill-creator` | Guide for creating new skills |
