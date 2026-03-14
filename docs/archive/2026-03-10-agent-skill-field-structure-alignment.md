# Agent Skill Field Structure Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the field structures produced by different agents and skills so every stage has a stable, versioned, composable contract and downstream stages can connect without prompt-specific assumptions.

**Architecture:** Keep the existing stage payload schemas (`design`, `catalog`, `script`, `assets`, `production`, `timeline`) as the domain IR, but add a unified artifact contract layer above them. Split outputs into two classes: `public handoff artifacts` that downstream stages may depend on, and `workspace/internal artifacts` that remain skill-private but still carry minimal provenance fields. Migrate by adding adapters and validators first, then update agent prompts and skill references to read/write the canonical contracts instead of ad-hoc JSON shapes.

**Tech Stack:** TypeScript, Zod, Vitest, Bun, Claude Agent SDK

---

## Current-State Diagnosis

The repo already has file-level schema validation in [src/schemas/index.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/schemas/index.ts#L1) and [src/hooks/schema-validator.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/hooks/schema-validator.ts#L1), but it validates only a small set of file suffixes and does not define a shared artifact envelope.

The `screenwriter` pipeline is the only stage with a relatively coherent handoff chain: `draft/design.json` + `draft/catalog.json` -> `draft/episodes/*.md` -> `output/script.json`, documented in [agents/screenwriter/.claude/CLAUDE.md](/Users/dingzhijian/lingjing/AgentOS-TS/agents/screenwriter/.claude/CLAUDE.md#L153) and implemented by [src/tools/script-parser.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/tools/script-parser.ts#L132).

The main disconnects are downstream:

- `art-director` consumes `script.json`, but its skill outputs `workspace/style.json`, `{title}_*_gen.json`, and directory-local metadata without any normalized manifest contract; see [agents/art-director/.claude/CLAUDE.md](/Users/dingzhijian/lingjing/AgentOS-TS/agents/art-director/.claude/CLAUDE.md#L15).
- `video-producer` emits review-oriented files such as `*_analysis.json`, `*_review.json`, `*_optimized.json`, and `final_selection.json`, but these are not mapped onto `production/plan.json`; see [agents/video-producer/.claude/CLAUDE.md](/Users/dingzhijian/lingjing/AgentOS-TS/agents/video-producer/.claude/CLAUDE.md#L261) and [agents/video-producer/.claude/skills/video-review-references/configuration.md](/Users/dingzhijian/lingjing/AgentOS-TS/agents/video-producer/.claude/skills/video-review-references/configuration.md#L24).
- The repo defines `AssetManifestSchema`, `ProductionPlanSchema`, and `TimelineSchema`, but today they are mostly “declared contracts”, not consistently produced/consumed stage outputs; see [src/schemas/assets.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/schemas/assets.ts#L1), [src/schemas/production.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/schemas/production.ts#L1), and [src/schemas/timeline.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/schemas/timeline.ts#L1).

This means the system currently has `schema modules`, but not a true `cross-agent contract model`.

---

## Recommended Approach

Use a **two-layer contract model**:

1. **Public handoff artifacts**
   Only these files are allowed to be consumed by downstream stages.
   They must be versioned, validated, and semantically stable.

2. **Internal workspace artifacts**
   These are skill-private files such as prompt-generation JSON, review JSON, optimizer JSON, and scratch outputs.
   They may vary by skill, but they must carry a small common provenance header so they can still be traced and debugged.

Do **not** try to force every intermediate JSON into one giant universal object. The stable thing is the stage boundary, not every scratch file.

### Canonical Public Handoff Set

| Stage | Canonical artifact | Existing file | Consumer |
|------|--------------------|---------------|----------|
| Screenwriter / Phase 1 | `design` | `draft/design.json` | screenwriter Phase 2, parser |
| Screenwriter / Phase 1 | `catalog` | `draft/catalog.json` | screenwriter Phase 2/3 |
| Screenwriter / Phase 3 | `script` | `output/script.json` | art-director, video-producer |
| Art Director | `asset_manifest` | `assets/manifest.json` | video-producer, post-production |
| Video Producer | `production_plan` | `production/plan.json` | post-production |
| Post Production | `timeline` | `output/timeline.json` | final export / UI |

### Shared Top-Level Envelope

Every public handoff artifact should normalize to the same top-level shape:

```ts
type StageArtifact<TPayload> = {
  schema_version: "2026-03-10";
  artifact_type:
    | "design"
    | "catalog"
    | "script"
    | "asset_manifest"
    | "production_plan"
    | "timeline";
  stage:
    | "screenwriter.phase1"
    | "screenwriter.phase3"
    | "art-director.assets"
    | "video-producer.production"
    | "post-production.timeline";
  project: {
    project_id: string;
    title: string;
  };
  producer: {
    agent: string;
    skill: string | null;
    tool: string | null;
  };
  upstream: Array<{
    artifact_type: string;
    path: string;
    content_hash?: string;
  }>;
  payload: TPayload;
};
```

### Internal Artifact Minimum Header

Internal skill-generated JSON should not be fully standardized, but it should at least carry:

```ts
type InternalArtifactHeader = {
  schema_version: "2026-03-10";
  stage: string;
  artifact_type: string;
  project_id: string;
  source_artifact: string | null;
  source_ref: string | null;
};
```

This applies to files like `style.json`, `*_chars_gen.json`, `*_analysis.json`, `*_review.json`, `*_optimized.json`, and `final_selection.json`.

---

## ID and Join-Key Rules

The real cross-stage glue is not file path, but identity.

Use these join-key rules consistently:

- `actor_id`, `location_id`, `prop_id`, `state_id`, `scene_id`, `shot_id` are the only stable entity IDs.
- `assets[*].source_ref` must point to domain IDs from `script.payload`.
- `production_plan.payload.shots[*].scene_id` must reference `script.payload.episodes[*].scenes[*].id`.
- `production_plan.payload.render_jobs[*].shot_id` must reference `shots[*].id`.
- `timeline.payload.clips[*].shot_id` must reference `production_plan.payload.shots[*].id`.
- Review / optimization / final-selection files in `video-producer` must reference `shot_id` and, when necessary, `segment_id`, but `segment_id` must be derivable from a canonical `shot_id`.

Avoid name-based joins outside the parser migration boundary. Name-based matching is acceptable only inside the current `script-parser` legacy adapter because that is already how [src/tools/script-parser.ts](/Users/dingzhijian/lingjing/AgentOS-TS/src/tools/script-parser.ts#L132) bootstraps IDs from `catalog.json`.

---

## Migration Strategy

### Option A: Add only `metadata` fields to existing JSON

Pros:
- Smallest code diff
- Minimal prompt churn

Cons:
- Does not solve boundary ambiguity
- Downstream still has to know per-file bespoke top-level shapes
- Hard to support internal vs public artifacts cleanly

### Option B: Add a unified envelope for public handoffs and keep internal artifacts semi-structured

Pros:
- Clear stage boundaries
- Minimal semantic breakage to existing payload schemas
- Makes validation, observability, replay, and UI inspection much easier

Cons:
- Requires adapters for legacy bare payload reads
- Requires prompt/reference updates in multiple agent skill docs

### Option C: Rewrite every skill JSON into one universal structure

Pros:
- Maximum theoretical consistency

Cons:
- Over-design
- Expensive prompt rewrites
- High risk of making skills less usable locally

**Recommendation:** choose **Option B**.

---

### Task 1: Introduce shared artifact primitives

**Files:**
- Create: `src/schemas/common.ts`
- Create: `src/schemas/artifacts.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/schemas/artifact-envelope.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ArtifactEnvelopeSchema, InternalArtifactHeaderSchema } from "../../src/schemas/index.js";

describe("ArtifactEnvelopeSchema", () => {
  it("validates a public handoff artifact", () => {
    const result = ArtifactEnvelopeSchema.safeParse({
      schema_version: "2026-03-10",
      artifact_type: "script",
      stage: "screenwriter.phase3",
      project: { project_id: "proj_demo", title: "Demo" },
      producer: { agent: "screenwriter", skill: "script-adapt", tool: "parse_script" },
      upstream: [
        { artifact_type: "design", path: "draft/design.json" },
        { artifact_type: "catalog", path: "draft/catalog.json" },
      ],
      payload: { title: "Demo", actors: [], episodes: [] },
    });

    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/schemas/artifact-envelope.test.ts
```

Expected: FAIL because the shared artifact schemas do not exist yet.

**Step 3: Write minimal implementation**

```ts
import { z } from "zod";

export const ArtifactRefSchema = z.object({
  artifact_type: z.string(),
  path: z.string(),
  content_hash: z.string().optional(),
});

export const InternalArtifactHeaderSchema = z.object({
  schema_version: z.literal("2026-03-10"),
  stage: z.string(),
  artifact_type: z.string(),
  project_id: z.string(),
  source_artifact: z.string().nullish(),
  source_ref: z.string().nullish(),
});

export const ArtifactEnvelopeSchema = z.object({
  schema_version: z.literal("2026-03-10"),
  artifact_type: z.string(),
  stage: z.string(),
  project: z.object({
    project_id: z.string(),
    title: z.string(),
  }),
  producer: z.object({
    agent: z.string(),
    skill: z.string().nullish(),
    tool: z.string().nullish(),
  }),
  upstream: z.array(ArtifactRefSchema).default([]),
  payload: z.unknown(),
});
```

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/schemas/artifact-envelope.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/schemas/common.ts src/schemas/artifacts.ts src/schemas/index.ts tests/schemas/artifact-envelope.test.ts
git commit -m "feat(schema): add shared artifact envelope primitives"
```

---

### Task 2: Create a public artifact registry instead of suffix-only validation

**Files:**
- Create: `src/artifacts/registry.ts`
- Create: `src/artifacts/read-artifact.ts`
- Modify: `src/hooks/schema-validator.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/hooks/schema-validator.test.ts`
- Test: `tests/schemas/artifact-registry.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { publicArtifactRegistry } from "../../src/artifacts/registry.js";

describe("publicArtifactRegistry", () => {
  it("registers every canonical handoff artifact", () => {
    expect(Object.keys(publicArtifactRegistry)).toEqual([
      "draft/design.json",
      "draft/catalog.json",
      "output/script.json",
      "assets/manifest.json",
      "production/plan.json",
      "output/timeline.json",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/schemas/artifact-registry.test.ts tests/hooks/schema-validator.test.ts
```

Expected: FAIL because the registry does not exist and the validator still matches only by suffix.

**Step 3: Write minimal implementation**

```ts
export const publicArtifactRegistry = {
  "draft/design.json": { artifact_type: "design", payload: DesignSchema },
  "draft/catalog.json": { artifact_type: "catalog", payload: CatalogSchema },
  "output/script.json": { artifact_type: "script", payload: ScriptSchema },
  "assets/manifest.json": { artifact_type: "asset_manifest", payload: AssetManifestSchema },
  "production/plan.json": { artifact_type: "production_plan", payload: ProductionPlanSchema },
  "output/timeline.json": { artifact_type: "timeline", payload: TimelineSchema },
} as const;
```

Update the validator so it can:

- validate legacy bare payload writes during migration
- later switch to envelope validation without changing every caller at once

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/schemas/artifact-registry.test.ts tests/hooks/schema-validator.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/artifacts/registry.ts src/artifacts/read-artifact.ts src/hooks/schema-validator.ts src/schemas/index.ts tests/schemas/artifact-registry.test.ts tests/hooks/schema-validator.test.ts
git commit -m "feat(artifacts): add public artifact registry and path-aware validation"
```

---

### Task 3: Normalize screenwriter contracts first and keep the parser as the legacy boundary

**Files:**
- Modify: `agents/screenwriter/.claude/CLAUDE.md`
- Modify: `agents/screenwriter/.claude/skills/script-adapt-references/phase1-design.md`
- Modify: `agents/screenwriter/.claude/skills/script-adapt-references/phase3-extraction.md`
- Modify: `src/tools/script-parser.ts`
- Test: `tests/tools/script-parser.test.ts`
- Test: `tests/tools/script-parser.e2e.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- `script.json` preserves stable `actor_id`, `location_id`, `prop_id`, `scene_id`
- parser output exposes enough provenance to build downstream `asset_manifest`
- catalog state names remain string-based in Phase 1 and get converted to typed state objects only in `script.json`

```ts
expect(script.episodes[0].scenes[0].id).toBe("scn_001");
expect(script.episodes[0].scenes[0].cast[0]).toEqual({
  actor_id: "act_100",
  state_id: null,
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/tools/script-parser.test.ts tests/tools/script-parser.e2e.test.ts
```

Expected: FAIL on the newly added provenance / join-key assertions.

**Step 3: Write minimal implementation**

Update the prompt references so `screenwriter` explicitly treats:

- `design.json` and `catalog.json` as public handoff artifacts
- `episodes/*.md` as internal stage material
- `script.json` as the canonical downstream handoff

Keep the current parser behavior, but add explicit provenance metadata inside `script.metadata`, for example:

```ts
metadata: {
  source_design: "draft/design.json",
  source_catalog: "draft/catalog.json",
  source_episode_files: epFiles.map((file) => path.relative(projectPath, file)),
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/tools/script-parser.test.ts tests/tools/script-parser.e2e.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add agents/screenwriter/.claude/CLAUDE.md agents/screenwriter/.claude/skills/script-adapt-references/phase1-design.md agents/screenwriter/.claude/skills/script-adapt-references/phase3-extraction.md src/tools/script-parser.ts tests/tools/script-parser.test.ts tests/tools/script-parser.e2e.test.ts
git commit -m "feat(screenwriter): formalize public handoff contracts for design catalog and script"
```

---

### Task 4: Map art-director scratch outputs onto a canonical asset manifest

**Files:**
- Modify: `agents/art-director/.claude/CLAUDE.md`
- Modify: `agents/art-director/.claude/skills/asset-gen.md`
- Create: `src/artifacts/asset-manifest-builder.ts`
- Test: `tests/schemas/schemas.test.ts`
- Test: `tests/artifacts/asset-manifest-builder.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildAssetManifest } from "../../src/artifacts/asset-manifest-builder.js";

describe("buildAssetManifest", () => {
  it("maps generated character assets back to script ids", () => {
    const manifest = buildAssetManifest({
      project: "demo",
      script: {
        actors: [{ id: "act_001", name: "Hero" }],
        locations: [],
        props: [],
      },
      generated: {
        characters: [{ source_ref: "act_001", file_path: "assets/characters/hero/front.png" }],
        scenes: [],
        props: [],
      },
    });

    expect(manifest.actors[0].source_ref).toBe("act_001");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/artifacts/asset-manifest-builder.test.ts tests/schemas/schemas.test.ts
```

Expected: FAIL because the builder does not exist and the skill does not emit a canonical manifest.

**Step 3: Write minimal implementation**

Keep `style.json` and `*_gen.json` as internal artifacts, but require them to include the internal header.

Require `art-director` to always finish by materializing:

```ts
{
  project: "demo",
  actors: [
    {
      id: "asset_actor_001",
      type: "character",
      source_ref: "act_001",
      file_path: "assets/characters/hero/front.png",
      metadata: {
        state_id: "st_001",
        variant: "front",
      },
    },
  ],
  scenes: [],
  props: [],
}
```

Write it to `assets/manifest.json`.

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/artifacts/asset-manifest-builder.test.ts tests/schemas/schemas.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add agents/art-director/.claude/CLAUDE.md agents/art-director/.claude/skills/asset-gen.md src/artifacts/asset-manifest-builder.ts tests/artifacts/asset-manifest-builder.test.ts tests/schemas/schemas.test.ts
git commit -m "feat(art-director): normalize generated assets into canonical asset manifest"
```

---

### Task 5: Map video-producer review files onto `production/plan.json`

**Files:**
- Modify: `agents/video-producer/.claude/CLAUDE.md`
- Modify: `agents/video-producer/.claude/skills/video-review-references/configuration.md`
- Create: `src/artifacts/production-plan-builder.ts`
- Test: `tests/artifacts/production-plan-builder.test.ts`
- Test: `tests/schemas/schemas.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildProductionPlan } from "../../src/artifacts/production-plan-builder.js";

describe("buildProductionPlan", () => {
  it("creates shots and render jobs from script + asset manifest + review outputs", () => {
    const plan = buildProductionPlan({
      project: "demo",
      script: {
        episodes: [
          {
            episode: 1,
            scenes: [{ id: "scn_001", sequence: 1, actions: [{ sequence: 1, type: "action", content: "Hero runs" }] }],
          },
        ],
      },
      asset_manifest: {
        actors: [{ id: "asset_hero", source_ref: "act_001", file_path: "assets/hero.png", type: "character" }],
        scenes: [],
        props: [],
      },
    });

    expect(plan.shots[0].scene_id).toBe("scn_001");
    expect(plan.render_jobs[0].shot_id).toBe(plan.shots[0].id);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/artifacts/production-plan-builder.test.ts tests/schemas/schemas.test.ts
```

Expected: FAIL because the builder does not exist and the review files are not attached to any canonical plan.

**Step 3: Write minimal implementation**

Define `production/plan.json` as the canonical output of `video-producer`, with review files remaining internal diagnostics. Review and optimization files must reference canonical IDs:

```json
{
  "schema_version": "2026-03-10",
  "stage": "video-producer.production",
  "artifact_type": "review_result",
  "project_id": "proj_demo",
  "source_artifact": "production/plan.json",
  "source_ref": "shot_001"
}
```

Require `final_selection.json` to reference canonical `shot_id`, not only directory-local segment labels.

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/artifacts/production-plan-builder.test.ts tests/schemas/schemas.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add agents/video-producer/.claude/CLAUDE.md agents/video-producer/.claude/skills/video-review-references/configuration.md src/artifacts/production-plan-builder.ts tests/artifacts/production-plan-builder.test.ts tests/schemas/schemas.test.ts
git commit -m "feat(video-producer): canonicalize production plan and review provenance"
```

---

### Task 6: Make post-production consume `production/plan.json` and emit `output/timeline.json`

**Files:**
- Modify: `agents/post-production/.claude/CLAUDE.md`
- Create: `src/artifacts/timeline-builder.ts`
- Test: `tests/artifacts/timeline-builder.test.ts`
- Test: `tests/e2b/pipeline.test.ts`
- Test: `tests/sandbox-orchestrator.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildTimeline } from "../../src/artifacts/timeline-builder.js";

describe("buildTimeline", () => {
  it("maps production jobs into timeline clips keyed by shot_id", () => {
    const timeline = buildTimeline({
      project: "demo",
      production_plan: {
        shots: [{ id: "shot_001", scene_id: "scn_001", episode: 1, sequence: 1, description: "Hero runs", actor_ids: [], asset_refs: [] }],
        render_jobs: [{ shot_id: "shot_001", prompt: "Hero runs", assets: [], status: "done", output_path: "production/shot_001.mp4" }],
      },
    });

    expect(timeline.clips[0].shot_id).toBe("shot_001");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/artifacts/timeline-builder.test.ts tests/e2b/pipeline.test.ts tests/sandbox-orchestrator.test.ts
```

Expected: FAIL because `post-production` is not yet anchored on `production/plan.json`.

**Step 3: Write minimal implementation**

Require `post-production` to:

- read `production/plan.json`
- resolve the selected render outputs per `shot_id`
- emit `output/timeline.json`
- treat music/SFX decisions as internal or sidecar artifacts keyed by `shot_id`

```ts
{
  project: "demo",
  episodes: [1],
  clips: [
    {
      shot_id: "shot_001",
      type: "video",
      file_path: "production/shot_001.mp4",
      start_time: 0,
      duration: 4.2,
      layer: 0,
    },
  ],
  total_duration: 4.2,
  metadata: {
    source_plan: "production/plan.json",
  },
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/artifacts/timeline-builder.test.ts tests/e2b/pipeline.test.ts tests/sandbox-orchestrator.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add agents/post-production/.claude/CLAUDE.md src/artifacts/timeline-builder.ts tests/artifacts/timeline-builder.test.ts tests/e2b/pipeline.test.ts tests/sandbox-orchestrator.test.ts
git commit -m "feat(post-production): emit canonical timeline from production plan"
```

---

### Task 7: Add compatibility and migration coverage

**Files:**
- Create: `tests/contracts/stage-compatibility.test.ts`
- Create: `docs/architecture/agent-artifact-contracts.md`
- Modify: `docs/other-claude-arch.md`
- Modify: `docs/other-claude-readme.md`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { validateStageChain } from "../../src/artifacts/read-artifact.js";

describe("stage compatibility", () => {
  it("connects script -> asset_manifest -> production_plan -> timeline by stable ids", () => {
    const result = validateStageChain("fixtures/demo-project");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test tests/contracts/stage-compatibility.test.ts
```

Expected: FAIL because the compatibility validator and fixtures do not exist yet.

**Step 3: Write minimal implementation**

Implement a compatibility validator that checks:

- every `source_ref` exists upstream
- every `shot_id` has a matching scene / render job / timeline clip
- every public artifact declares upstream provenance
- no downstream stage depends on an internal artifact as a primary input

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test tests/contracts/stage-compatibility.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/contracts/stage-compatibility.test.ts docs/architecture/agent-artifact-contracts.md docs/other-claude-arch.md docs/other-claude-readme.md
git commit -m "docs(contracts): document stage contracts and add compatibility coverage"
```

---

## Key Decisions to Preserve

- Keep `design`, `catalog`, `script`, `asset_manifest`, `production_plan`, and `timeline` as the domain payload vocabulary. They are already the right abstraction level.
- Do not make prompt scratch files downstream-facing contracts.
- Do not replace the deterministic `script-parser` with LLM JSON generation.
- Do not attempt a big-bang migration. Add adapters first, then tighten validation.

## Validation Checklist

- `screenwriter` can still complete `draft/design.json` + `draft/catalog.json` -> `output/script.json`
- `art-director` can generate scratch files, but must always materialize `assets/manifest.json`
- `video-producer` may keep `*_analysis.json` / `*_review.json`, but `production/plan.json` becomes the canonical handoff
- `post-production` must consume `production/plan.json` and emit `output/timeline.json`
- every public artifact is resolvable by path and by semantic `artifact_type`
- every downstream join is ID-based, not name-based

## Rollout Order

1. Shared schema primitives and registry
2. Screenwriter normalization
3. Art-director manifest normalization
4. Video-producer plan normalization
5. Post-production timeline normalization
6. Compatibility tests and docs

This order keeps the existing working pipeline alive while progressively replacing prompt-specific assumptions with typed contracts.
