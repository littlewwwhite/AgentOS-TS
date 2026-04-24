# Architecture Convergence Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不破坏现有 Claude Agent SDK / single orchestrator 骨架的前提下，把 `pipeline-state.json` 从“控制台投影”收敛为“真实可执行真相源”，并保证合法编辑点改完后仍能继续运行。

**Architecture:** 保持现有 `single orchestrator + workspace artifact graph + pipeline-state.json` 主骨架不变。Phase 1 只补三层长期有效能力：`apps/console` 内唯一 workflow domain model、合法编辑点的 artifact validator registry、以及供 skills 显式调用的共享 `pipeline_state.py` 状态写入器。禁止引入数据库、多常驻 agent、workflow engine 或新依赖。

**Tech Stack:** Bun, Bun server, React 19, TypeScript, Python 3, 现有 `pipeline-state.json` 契约、现有 Bun test/tsc 校验链，无新增依赖。

---

## Scope

### In Scope
- 抽取唯一 `workflow model`
- 消除 console 内重复的 stage order / owner / next-stage 定义
- 为合法编辑点增加最小结构校验
- 在 `/api/file` 写回链路中执行 validator
- 提供共享 `pipeline_state.py` CLI 作为 skill 显式状态写入入口
- 把 `script-adapt` / `script-writer` / `storyboard` / `video-gen` 的状态写回从“自然语言要求”升级为“明确命令”

### Out of Scope
- 不改 `apps/console/src/orchestrator.ts`
- 不引入数据库、队列、workflow engine
- 不重写 `server.ts`
- 不做全 skill 深度脚本改造，只先统一显式写回入口
- 不做历史工作区批量迁移

### Done Criteria
- console 中只剩一个 workflow model 真相源
- 编辑 `draft/design.json` / `draft/catalog.json` / `output/script.json` / `output/storyboard/draft/*_storyboard.json` / approved/runtime storyboard 时，保存前会进行结构校验
- 至少一个共享 CLI 能稳定修改 `pipeline-state.json`
- 关键 skill 文档内出现明确的 state writer 命令，不再只写“必须同步维护”
- `cd apps/console && bun test` 与 `cd apps/console && ./node_modules/.bin/tsc -p tsconfig.json --noEmit` 通过

---

### Task 1: Add a single workflow domain model

**Files:**
- Create: `apps/console/src/lib/workflowModel.ts`
- Modify: `apps/console/src/types.ts`
- Test: `apps/console/test/workflowModel.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import {
  STAGE_ORDER,
  STAGE_OWNER,
  MVP_STAGE_ORDER,
  nextStageName,
  isTerminalStageStatus,
} from "../src/lib/workflowModel";

describe("workflowModel", () => {
  test("exposes one canonical stage ordering", () => {
    expect(STAGE_ORDER).toEqual([
      "INSPIRATION",
      "SCRIPT",
      "VISUAL",
      "STORYBOARD",
      "VIDEO",
      "EDITING",
      "MUSIC",
      "SUBTITLE",
    ]);
    expect(MVP_STAGE_ORDER).toEqual([
      "INSPIRATION",
      "SCRIPT",
      "VISUAL",
      "STORYBOARD",
      "VIDEO",
    ]);
  });

  test("answers owner, next stage, and terminal status from the same model", () => {
    expect(STAGE_OWNER.SCRIPT).toBe("writer");
    expect(nextStageName("STORYBOARD")).toBe("VIDEO");
    expect(isTerminalStageStatus("approved")).toBe(true);
    expect(isTerminalStageStatus("running")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/console && bun test test/workflowModel.test.ts`
Expected: FAIL with missing module / export.

**Step 3: Write minimal implementation**

```ts
import type { StageStatus } from "../types";

export const STAGE_ORDER = [
  "INSPIRATION",
  "SCRIPT",
  "VISUAL",
  "STORYBOARD",
  "VIDEO",
  "EDITING",
  "MUSIC",
  "SUBTITLE",
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

export const MVP_STAGE_ORDER: StageName[] = [
  "INSPIRATION",
  "SCRIPT",
  "VISUAL",
  "STORYBOARD",
  "VIDEO",
];

export const STAGE_OWNER: Record<StageName, string> = {
  INSPIRATION: "research",
  SCRIPT: "writer",
  VISUAL: "visual",
  STORYBOARD: "director",
  VIDEO: "production",
  EDITING: "post",
  MUSIC: "post",
  SUBTITLE: "post",
};

const TERMINAL_STAGE_STATUSES: StageStatus[] = [
  "completed",
  "validated",
  "approved",
  "locked",
  "superseded",
];

export function nextStageName(stage: StageName): StageName | null {
  const index = STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
}

export function isTerminalStageStatus(status: StageStatus | undefined): boolean {
  return !!status && TERMINAL_STAGE_STATUSES.includes(status);
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/console && bun test test/workflowModel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/console/src/lib/workflowModel.ts apps/console/src/types.ts apps/console/test/workflowModel.test.ts
git commit -m "feat: add canonical workflow domain model"
```

**Implementation notes:**
- `StageName` 由 `workflowModel.ts` 导出，`PipelineState.current_stage` 改为 `StageName | string` 兼容旧数据，避免一次性破坏历史状态文件。
- 该模块只表达阶段与状态语义，不做 UI 或文件系统逻辑。

---

### Task 2: Refactor console domain logic to depend on the shared workflow model

**Files:**
- Modify: `apps/console/src/lib/projectBootstrap.ts`
- Modify: `apps/console/src/lib/resumePolicy.ts`
- Modify: `apps/console/src/lib/overviewWorkbench.ts`
- Modify: `apps/console/src/lib/artifactActions.ts`
- Modify: `apps/console/src/lib/workflowProgress.ts`
- Modify: `apps/console/src/lib/workflowStatus.ts`
- Test: `apps/console/test/projectBootstrap.test.ts`
- Test: `apps/console/test/resumePolicy.test.ts`
- Test: `apps/console/test/overviewWorkbench.test.ts`
- Test: `apps/console/test/artifactActions.test.ts`
- Test: `apps/console/test/workflowProgress.test.ts`
- Test: `apps/console/test/workflowStatus.test.ts`

**Step 1: Write/extend failing regression tests**

```ts
test("shared model drives next action consistently", () => {
  // artifactActions / resumePolicy should both agree that STORYBOARD → VIDEO
  expect(nextStageName("STORYBOARD")).toBe("VIDEO");
});
```

**Step 2: Run focused regressions before refactor**

Run: `cd apps/console && bun test test/projectBootstrap.test.ts test/resumePolicy.test.ts test/overviewWorkbench.test.ts test/artifactActions.test.ts test/workflowProgress.test.ts test/workflowStatus.test.ts`
Expected: PASS on current branch before edits.

**Step 3: Replace duplicated stage arrays and terminal logic**

```ts
import { STAGE_ORDER, MVP_STAGE_ORDER, STAGE_OWNER, nextStageName, isTerminalStageStatus } from "./workflowModel";

// projectBootstrap.ts
// remove local STAGE_NAMES and STAGE_OWNERS

// resumePolicy.ts
// replace local STAGES and terminal()

// artifactActions.ts
// replace local STAGE_ORDER and nextStageName()

// workflowProgress.ts
// replace local STAGES with MVP_STAGE_ORDER
```

**Step 4: Run focused regressions**

Run: `cd apps/console && bun test test/projectBootstrap.test.ts test/resumePolicy.test.ts test/overviewWorkbench.test.ts test/artifactActions.test.ts test/workflowProgress.test.ts test/workflowStatus.test.ts`
Expected: PASS

**Step 5: Run full console verification**

Run: `cd apps/console && bun test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all tests PASS, typecheck PASS.

**Step 6: Commit**

```bash
git add apps/console/src/lib/projectBootstrap.ts apps/console/src/lib/resumePolicy.ts apps/console/src/lib/overviewWorkbench.ts apps/console/src/lib/artifactActions.ts apps/console/src/lib/workflowProgress.ts apps/console/src/lib/workflowStatus.ts
git commit -m "refactor: converge console workflow logic on shared model"
```

**Implementation notes:**
- 保持现有状态值与 API 语义不变，本任务只消除重复真相源。
- 如果存在 UI 仅显示 MVP 阶段的需求，一律依赖 `MVP_STAGE_ORDER`，不要在组件或 helper 内重新写数组。

---

### Task 3: Add an artifact validator registry for legal edit points

**Files:**
- Create: `apps/console/src/lib/artifactValidators.ts`
- Modify: `apps/console/server.ts`
- Test: `apps/console/test/artifactValidators.test.ts`
- Test: `apps/console/test/editPolicy.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { validateEditableArtifact } from "../src/lib/artifactValidators";

describe("validateEditableArtifact", () => {
  test("accepts minimal valid catalog.json", () => {
    const result = validateEditableArtifact("draft/catalog.json", {
      actors: [{ id: "act_001", name: "白行风" }],
      locations: [{ id: "loc_001", name: "灵霜寝宫" }],
      props: [{ id: "prp_001", name: "轮椅" }],
    });
    expect(result.ok).toBe(true);
  });

  test("rejects script.json without episode ids", () => {
    const result = validateEditableArtifact("output/script.json", {
      episodes: [{ scenes: [] }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("episode_id");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/console && bun test test/artifactValidators.test.ts`
Expected: FAIL with missing module / export.

**Step 3: Write minimal validator registry**

```ts
export function validateEditableArtifact(path: string, data: unknown): { ok: true } | { ok: false; error: string } {
  if (path === "draft/design.json") return validateDesign(data);
  if (path === "draft/catalog.json") return validateCatalog(data);
  if (path === "output/script.json") return validateScript(data);
  if (/^draft\/storyboard\/ep\d+\.shots\.json$/i.test(path)) return validateDraftStoryboard(data);
  if (/^output\/(?:storyboard\/approved\/)?ep\d+\/?.*_storyboard\.json$/i.test(path)) return validateRuntimeStoryboard(data);
  return { ok: true };
}
```

**Step 4: Implement minimum viable validators**

```ts
// design.json
// required: title:string, total_episodes:number>0, episodes:array

// catalog.json
// required: actors/locations/props arrays; each item has id + name; states if present is string[]

// script.json
// required: episodes[]; episode_id required; scene_id required; action requires type+content; dialogue requires actor_id

// draft storyboard
// required: episode_id:string, scene_id:string, shots:array; each item has prompt:string and source_refs:number[]

// runtime/approved storyboard
// required: episode_id:string, scenes:array; each scene has scene_id and clips[]; each clip has clip_id and shots[]
```

**Step 5: Enforce registry inside `/api/file`**

```ts
const parsed = JSON.parse(text);
const validation = validateEditableArtifact(normalized, parsed);
if (!validation.ok) {
  return Response.json({ error: validation.error }, { status: 409, headers: corsWithMethods });
}
```

**Step 6: Run focused verification**

Run: `cd apps/console && bun test test/artifactValidators.test.ts test/editPolicy.test.ts`
Expected: PASS

**Step 7: Run full console verification**

Run: `cd apps/console && bun test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS

**Step 8: Commit**

```bash
git add apps/console/src/lib/artifactValidators.ts apps/console/server.ts apps/console/test/artifactValidators.test.ts apps/console/test/editPolicy.test.ts
git commit -m "feat: validate legal editable artifacts before save"
```

**Implementation notes:**
- Validators 必须采取“**最小强约束**”策略：只校验后续流程真正依赖的字段，允许额外字段存在，避免一次性打坏历史文件。
- `output/storyboard/draft/*_storyboard.json` 只校验外层 authoring surface，不解析 `prompt` 内嵌 JSON 结构。
- runtime/approved storyboard validator 以 `scenes[].clips[].shots[]` 为 canonical 入口，不再依赖当前 `schemaDetect.ts` 的旧启发式。

---

### Task 4: Add a shared `pipeline_state.py` CLI and test it from the existing Bun harness

**Files:**
- Create: `scripts/pipeline_state.py`
- Create: `scripts/README.md`
- Test: `apps/console/test/pipelineStateCli.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("pipeline_state.py", () => {
  test("creates and updates minimal state deterministically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentos-state-"));
    const statePath = join(dir, "pipeline-state.json");

    const proc = Bun.spawn([
      "python3",
      "../../scripts/pipeline_state.py",
      "stage",
      "--project-dir", dir,
      "--stage", "SCRIPT",
      "--status", "running",
      "--next-action", "review SCRIPT",
    ]);

    expect(await proc.exited).toBe(0);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.current_stage).toBe("SCRIPT");
    expect(state.stages.SCRIPT.status).toBe("running");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/console && bun test test/pipelineStateCli.test.ts`
Expected: FAIL because CLI does not exist.

**Step 3: Implement the smallest stable CLI**

```python
#!/usr/bin/env python3

# subcommands:
#   ensure   -> create minimal pipeline-state if missing
#   stage    -> set current_stage / stage status / next_action
#   artifact -> upsert artifacts[path]
#   episode  -> upsert episodes[ep_id][kind]
```

**Step 4: Keep command surface intentionally small**

```bash
python3 ./scripts/pipeline_state.py ensure --project-dir "$PROJECT_DIR"
python3 ./scripts/pipeline_state.py stage --project-dir "$PROJECT_DIR" --stage SCRIPT --status running --next-action "review SCRIPT"
python3 ./scripts/pipeline_state.py artifact --project-dir "$PROJECT_DIR" --path output/script.json --kind canonical --owner-role writer --status completed
python3 ./scripts/pipeline_state.py episode --project-dir "$PROJECT_DIR" --episode ep001 --kind video --status partial --artifact output/ep001/ep001_delivery.json
```

**Step 5: Run focused verification**

Run: `cd apps/console && bun test test/pipelineStateCli.test.ts`
Expected: PASS

**Step 6: Run static syntax check**

Run: `python3 -m py_compile scripts/pipeline_state.py`
Expected: no output, exit code 0.

**Step 7: Commit**

```bash
git add scripts/pipeline_state.py scripts/README.md apps/console/test/pipelineStateCli.test.ts
git commit -m "feat: add shared pipeline state writer cli"
```

**Implementation notes:**
- CLI 必须遵守 `docs/pipeline-state-contract.md`，并在文件缺失时自动 `ensure` 最小结构。
- 所有命令都必须是幂等的；同一输入重复执行不能破坏状态文件。
- 不要做“通用 JSON patch 引擎”；只保留领域上稳定的 4 个操作。

---

### Task 5: Wire key skills from prose-only state rules to explicit CLI commands

**Files:**
- Modify: `.claude/skills/script-adapt/SKILL.md`
- Modify: `.claude/skills/script-writer/SKILL.md`
- Modify: `.claude/skills/storyboard/SKILL.md`
- Modify: `.claude/skills/video-gen/SKILL.md`
- Modify: `docs/pipeline-state-contract.md`

**Step 1: Replace vague requirements with concrete commands**

```md
Before entering SCRIPT:

```bash
python3 ./scripts/pipeline_state.py ensure --project-dir "${PROJECT_DIR}"
python3 ./scripts/pipeline_state.py stage --project-dir "${PROJECT_DIR}" --stage SCRIPT --status running --next-action "review SCRIPT"
```
```

**Step 2: Add explicit checkpoints per skill**

```md
script-adapt
- after `design.json` + `catalog.json`: keep SCRIPT=running
- after first `ep*.md`: mark SCRIPT=partial
- after `output/script.json`: artifact output/script.json=completed
- after parse gate passes: stage SCRIPT=validated next_action=enter VISUAL

video-gen
- on runtime storyboard export: stage VIDEO=running
- after `ep{NNN}_delivery.json`: episode(epNNN, video)=completed
- while only runtime storyboard exists: episode(epNNN, video)=partial
- after all requested eps verified: stage VIDEO=validated next_action=enter EDITING
```

**Step 3: Keep `script-writer` and `storyboard` on the same interface**

```md
Use the same CLI, even if the skill does not yet have a dedicated Python wrapper script.
The skill-level orchestration instructions remain the integration point for now.
```

**Step 4: Update contract doc to formalize the shared writer**

```md
Add a short section:
- recommended writer surface: `scripts/pipeline_state.py`
- stage/artifact/episode operations are the canonical mutating interface
- file scanning remains fallback only
```

**Step 5: Verify by grep**

Run: `rg -n "pipeline_state.py|stage --project-dir|artifact --project-dir|episode --project-dir" .claude/skills docs/pipeline-state-contract.md`
Expected: each target skill and the contract doc contain concrete CLI usage.

**Step 6: Commit**

```bash
git add .claude/skills/script-adapt/SKILL.md .claude/skills/script-writer/SKILL.md .claude/skills/storyboard/SKILL.md .claude/skills/video-gen/SKILL.md docs/pipeline-state-contract.md
git commit -m "docs: make skill state checkpoints executable"
```

**Implementation notes:**
- 本任务的目标不是把所有低层 Python 脚本都改成状态机，而是先把**真正执行 skill 的 orchestration surface**接到共享 writer。
- 这样既保留现有 skill 逻辑，又能让运行状态从“文字要求”升级为“明确命令”。

---

### Task 6: Final verification and documentation cleanup

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/plans/README.md`

**Step 1: Add plan / contract references to docs indexes**

```md
- `pipeline-state-contract.md`: lifecycle contract
- `plans/2026-04-24-architecture-convergence-phase-1.md`: execution plan for Phase 1
```

**Step 2: Run final repo checks for the changed surface**

Run: `cd apps/console && bun test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS

Run: `python3 -m py_compile scripts/pipeline_state.py`
Expected: PASS

Run: `rg -n "const STAGES = \\[|const STAGE_ORDER = \\[" apps/console/src/lib`
Expected: only `workflowModel.ts` remains as stage-order source of truth.

**Step 3: Manual smoke checklist**

```text
1. 打开 console
2. 选择一个已有项目
3. 编辑 `draft/catalog.json` 并故意删掉 `actors[0].id`
4. 点击保存
5. 预期：保存失败，错误明确指出缺失字段
6. 修复 JSON 后再次保存
7. 预期：保存成功，pipeline-state 正常转入 review / stale 链
```

**Step 4: Commit**

```bash
git add docs/README.md docs/plans/README.md
git commit -m "docs: index architecture convergence phase one"
```

**Implementation notes:**
- 如果 `rg` 仍搜出局部 `STAGES` 常量，但它们只是 UI label 映射，不再参与 order / transition 语义，可以保留并在 code review 中确认。
- 若 final verification 失败，优先修复 workflow model 与 validator 接口，不要额外扩 scope。

---

## Risks

### Risk 1: Validator 过严导致旧项目无法保存

Mitigation:
- validators 只校验最小必需字段
- 允许额外字段
- 对旧格式给出明确错误，而不是静默兼容错误结构

### Risk 2: Shared CLI 被设计成万能补丁工具

Mitigation:
- CLI 只暴露 `ensure` / `stage` / `artifact` / `episode`
- 不做任意 JSON patch

### Risk 3: Skill 文档更新后仍有人绕过 writer

Mitigation:
- 在 `docs/pipeline-state-contract.md` 中把 shared writer 明确定义为推荐写入口
- 后续 phase 再逐步把更多低层 wrapper 接进去

---

## Not To Do

- 不新增数据库
- 不改成多常驻 agent
- 不重写 `apps/console/src/orchestrator.ts`
- 不把 `server.ts` 这轮一起大拆
- 不把 draft storyboard 内嵌 prompt JSON 解析器做成通用 AST 工程

---

## Handoff

这个 Phase 1 的目标不是“做一个更复杂的系统”，而是让你当前已经正确的骨架真正闭环。

完成后，系统应当具备三个新的长期稳定属性：

1. **只有一个 workflow 真相源**
2. **合法编辑点改完仍可继续运行**
3. **skills 对 `pipeline-state.json` 的写回从口头约束变成明确执行动作**
