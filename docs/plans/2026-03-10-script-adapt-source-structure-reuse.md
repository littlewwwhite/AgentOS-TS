# Script Adapt Source Structure Reuse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a deterministic TypeScript source-structure detector to `script-adapt` so chaptered novels can reuse native boundaries safely, while keeping the existing scene-script format and downstream `script.json` parser contract unchanged.

**Architecture:** Split the problem into three layers. A new TypeScript detector reads `source.txt` and emits a stable `draft/source-structure.json` artifact describing reusable source segments and fallback chunking decisions. Phase 1 prompt logic reads that artifact to build `design.json`, `catalog.json`, and continuity constraints; Phase 2 batch writing reads the same artifact but still writes the exact same `ep{NN}.md` scene-script format that the current parser expects.

**Tech Stack:** TypeScript, Bun, Vitest, Zod, SDK MCP tools, Markdown skill prompts

### Task 1: Add A Deterministic Source Structure Detector

**Files:**
- Create: `src/tools/source-structure.ts`
- Modify: `src/tools/source.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/tools/source-structure.test.ts`
- Test: `tests/tools-index.test.ts`
- Reference: `/Users/dingzhijian/lingjing/script2shot/src/task1/main.py`
- Reference: `/Users/dingzhijian/lingjing/script2shot/src/task1/service/episode.py`

**Step 1: Write the failing test**

Add `tests/tools/source-structure.test.ts` covering:
- explicit chapter markers like `第1章 / 第2章`
- numbered titles like `1. 标题`
- standalone numeric lines
- scene markers like `1-1 / 1-2 / 2-1`
- unstructured source fallback chunking
- oversized source segment split while preserving parent segment identity

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/tools/source-structure.test.ts
```

Expected: FAIL because `src/tools/source-structure.ts` and exported detector APIs do not exist yet.

**Step 3: Write minimal implementation**

Implement a deterministic detector in `src/tools/source-structure.ts` with:
- marker priority:
  - explicit chapter / episode markers
  - numbered titles
  - standalone numeric lines
  - scene markers grouped by episode
  - natural chunk fallback
- validation rules:
  - acceptable coverage
  - mostly continuous numbering
  - non-trivial segment length
  - sane segment count ceiling
- fallback policy:
  - fully valid: keep detected segments
  - partially valid: preserve source boundary, sub-split oversized segments
  - invalid: natural chunk fallback

Expose:
- pure helper functions for tests
- one MCP tool callable from the skill flow, recommended name: `detect_source_structure`

The tool should accept a project path or source path and write/read:
- input: `<project>/source.txt`
- output: `<project>/draft/source-structure.json`

**Step 4: Register the detector tool**

Update `src/tools/source.ts` and `src/tools/index.ts` so the existing `source` MCP server exposes both:
- `prepare_source_project`
- `detect_source_structure`

Keep the server name as `source`; do not create a separate server unless there is a hard technical reason.

**Step 5: Run tests to verify detector wiring**

Run:

```bash
bun test tests/tools/source-structure.test.ts tests/tools-index.test.ts
```

Expected: PASS

### Task 2: Define A Stable Source Structure Schema

**Files:**
- Create: `src/schemas/source-structure.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/hooks/schema-validator.test.ts`

**Step 1: Write the failing schema validation test**

Extend `tests/hooks/schema-validator.test.ts` with cases asserting:
- valid `draft/source-structure.json` passes
- malformed segment payload is denied
- unknown top-level shape is denied

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/hooks/schema-validator.test.ts
```

Expected: FAIL because no schema is registered for `source-structure.json`.

**Step 3: Implement the schema**

Create `src/schemas/source-structure.ts` with a Zod schema that models:
- detection mode
- source path metadata
- segmentation strategy
- source segments
- optional parent-child split relationship
- quality signals
- source-to-adaptation placeholders usable by prompts

Register it in `src/schemas/index.ts` under:
- `draft/source-structure.json`

**Step 4: Re-run schema tests**

Run:

```bash
bun test tests/hooks/schema-validator.test.ts
```

Expected: PASS

### Task 3: Wire The Detector Into Screenwriter Skill Routing

**Files:**
- Modify: `agents/screenwriter/.claude/skills/script-adapt.md`

**Step 1: Update allowed tools**

Add the new source detector tool to the skill metadata:
- keep existing storage/script tools
- add `mcp__source__detect_source_structure`

Do not remove existing tools.

**Step 2: Update workspace structure**

Add one new draft artifact:
- `draft/source-structure.json`

Document it as:
- produced before Phase 1A analysis
- consumed in Phase 1A and Phase 2
- ignored by Phase 3 parser

**Step 3: Update stage data flow**

Revise the flow to:
- `source.txt -> source-structure.json -> design.json + catalog.json -> connectivity.md + ep*.md -> script.json`

Explicitly state that parser-facing files remain:
- `draft/design.json`
- `draft/catalog.json`
- `draft/episodes/ep*.md`

`draft/source-structure.json` must be treated as draft-only planning input.

**Step 4: Update context recovery**

Recovery order should mention:
- `draft/source-structure.json`
- `draft/design.json`
- `draft/catalog.json`
- `draft/connectivity.md`
- `draft/episodes/*.md`

### Task 4: Refactor Phase 1 Prompt Around The Detector Output

**Files:**
- Modify: `agents/screenwriter/.claude/skills/script-adapt-references/phase1-design.md`

**Step 1: Replace “全文通读” as the first operation**

Change Phase 1A so it starts with:
1. call `detect_source_structure`
2. inspect `draft/source-structure.json`
3. decide whether source-native boundaries are authoritative or fallback chunks are used
4. analyze source segments one by one
5. globally reduce segment summaries into CP1

**Step 2: Define segment summary contract for prompts**

Each source segment analysis should extract:
- source segment id
- source title
- major events
- character entries / changes
- open or resolved threads
- prop / evidence movement
- emotional direction
- carry-over obligations

**Step 3: Preserve CP1 and CP2 semantics**

Keep CP1 and CP2 as they are conceptually:
- CP1 confirms strategy parameters
- CP2 confirms adaptation outline

Only their evidence base changes:
- from single-pass full-text analysis
- to detector-backed segment reduce

**Step 4: Keep Phase 1 output contracts unchanged**

Do not change the schema or required fields of:
- `design.json`
- `catalog.json`

Source segments are reasoning inputs only, not downstream public data contracts.

### Task 5: Strengthen Continuity For Batch Writing

**Files:**
- Modify: `agents/screenwriter/.claude/skills/script-adapt-references/phase2-writing.md`

**Step 1: Extend continuity contract**

Promote `connectivity.md` from “cross-episode notes” to “writing contract”.

Add a leading section:
- `Character Identity Cards`

Each important character should define:
- core motivation
- personality baseline
- language signature
- relationship baseline
- prohibited drift points
- allowed evolution checkpoints

**Step 2: Require source-aware batch preparation**

Before every batch, require reading:
- `design.json`
- `catalog.json`
- `source-structure.json`
- `connectivity.md`
- previous batch summary if present

The prompt must explicitly determine:
- which source segments feed this batch
- what unresolved obligations cross into this batch
- which character states are already locked
- which cliffhanger-hook pairs must be honored

**Step 3: Add batch summary obligations**

Each batch summary must record:
- source segments consumed
- partially consumed source segments
- unresolved obligations for next batch
- character state changes
- thread status changes

### Task 6: Preserve Parser Compatibility As A Hard Constraint

**Files:**
- Modify: `agents/screenwriter/.claude/skills/script-adapt.md`
- Modify: `agents/screenwriter/.claude/skills/script-adapt-references/phase2-writing.md`
- Reference: `agents/screenwriter/.claude/skills/script-adapt-references/phase3-extraction.md`
- Reference: `src/tools/script-parser.ts`

**Step 1: Restate the non-negotiable script format**

Document that `ep*.md` must remain exactly parser-compatible:
- episode header: `第{N}集`
- scene header: `{ep}-{scene} 时间 内/外 地点`
- actor line syntax unchanged
- state annotation syntax unchanged
- no metadata headers or side-channel markers inside `ep*.md`

**Step 2: Document non-goals**

This change must not:
- change `output/script.json` schema
- change `phase3-extraction.md` behavior
- require `src/tools/script-parser.ts` changes
- require new parser fields

### Task 7: Manual Verification Plan

**Files:**
- Test by workflow execution plus unit tests

**Step 1: Verify the detector in isolation**

Run:

```bash
bun test tests/tools/source-structure.test.ts
```

Expected:
- chaptered source is segmented by native markers
- invalid markers fall back deterministically
- oversized segments are split predictably

**Step 2: Verify schema and registry**

Run:

```bash
bun test tests/hooks/schema-validator.test.ts tests/tools-index.test.ts
```

Expected:
- `draft/source-structure.json` validates
- source server exposes the detector tool correctly

**Step 3: Verify screenwriter workflow manually with chaptered input**

Expected:
- Phase 1 calls the detector first
- source-native boundaries are reused
- CP1 reflects global reduce instead of raw full-text reading

**Step 4: Verify fallback with unstructured input**

Expected:
- detector falls back to natural chunking
- CP1 still completes coherently

**Step 5: Verify parser compatibility**

After Phase 2 generates `ep*.md`, run the existing parser flow.

Expected:
- parser reads the generated episodes unchanged
- `output/script.json` is produced with the existing schema

### Task 8: Commit Strategy

**Files:**
- Commit only files touched by this feature

**Step 1: Implement the detector and schema**

Target files:
- `src/tools/source-structure.ts`
- `src/tools/source.ts`
- `src/tools/index.ts`
- `src/schemas/source-structure.ts`
- `src/schemas/index.ts`
- `tests/tools/source-structure.test.ts`
- `tests/hooks/schema-validator.test.ts`
- `tests/tools-index.test.ts`

**Step 2: Update the screenwriter prompts**

Target files:
- `agents/screenwriter/.claude/skills/script-adapt.md`
- `agents/screenwriter/.claude/skills/script-adapt-references/phase1-design.md`
- `agents/screenwriter/.claude/skills/script-adapt-references/phase2-writing.md`

**Step 3: Run focused verification**

Run:

```bash
bun test tests/tools/source-structure.test.ts \
  tests/hooks/schema-validator.test.ts \
  tests/tools-index.test.ts
```

Then manually verify:
- chaptered source path
- fallback path
- parser compatibility

**Step 4: Commit**

Suggested commit message:

```bash
git add docs/plans/2026-03-10-script-adapt-source-structure-reuse.md \
  src/tools/source-structure.ts \
  src/tools/source.ts \
  src/tools/index.ts \
  src/schemas/source-structure.ts \
  src/schemas/index.ts \
  tests/tools/source-structure.test.ts \
  tests/hooks/schema-validator.test.ts \
  tests/tools-index.test.ts \
  agents/screenwriter/.claude/skills/script-adapt.md \
  agents/screenwriter/.claude/skills/script-adapt-references/phase1-design.md \
  agents/screenwriter/.claude/skills/script-adapt-references/phase2-writing.md
git commit -m "feat(screenwriter): add source structure detector"
```
