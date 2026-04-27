# Sidebar Hybrid Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the console Navigator sidebar from a flat by-stage list into a hybrid layout where SCRIPT/VISUAL stay as cross-episode top-level nodes and STORYBOARD/VIDEO collapse into per-episode nodes that expand to show their sub-stages.

**Architecture:** Extend `buildNavigatorSections` to tag each section with a `group` discriminator (`cross_episode | per_episode`). Add a visual rule between the two groups in `Navigator.tsx`. Replace the leaf `EpisodeNode` with an expandable variant that renders one row per active sub-stage (driven by `MVP_STAGE_ORDER`), each row reuses the same `openPath` semantics that the current STORYBOARD/VIDEO nodes use today.

**Tech Stack:** React 18 + TypeScript, bun:test, Tailwind utility classes, existing `StageNode` / `StatusBadge` primitives.

---

## File Structure

**Modified:**
- `apps/console/src/lib/navigatorSections.ts` — add `group` field to `NavigatorSection`
- `apps/console/src/components/Navigator/EpisodeNode.tsx` — expandable, renders per-sub-stage child rows
- `apps/console/src/components/Navigator/Navigator.tsx` — render divider between groups, drop the now-redundant `StoryboardNode` from the cross-episode flow
- `apps/console/test/navigatorSections.test.ts` — assert new group field
- `apps/console/test/navigatorStoryboards.test.tsx` — update or replace expectations against new node tree

**Deleted (after migration):**
- `apps/console/src/components/Navigator/StoryboardNode.tsx` — superseded by per-episode storyboard sub-rows. Only delete after Task 4 verifies no remaining references.

**New (only if needed):**
- `apps/console/src/lib/episodeSubStages.ts` — pure helper that maps an `EpisodeState` to an ordered list of `{ stage, status, path, title }` rows for the active MVP. Created in Task 3 to keep the component dumb and unit-testable.

---

## Scope Notes

- **MVP-aware:** Per-episode group only renders sub-stages in `MVP_STAGE_ORDER` (currently `STORYBOARD`, `VIDEO`). EDITING / MUSIC / SUBTITLE remain hidden until the team flips them on, matching the existing assertion in `navigatorSections.test.ts:59-72`.
- **Out of scope:** Toolbar toggle for "按集 / 按阶段" alternate view. Defer to a follow-up plan if the hybrid default proves insufficient.
- **Out of scope:** Changing how artifacts are opened (`openPath`, `resolveView`) — reuse existing semantics verbatim.

---

## Task 1: Extend NavigatorSection with group discriminator (TDD)

**Files:**
- Modify: `apps/console/src/lib/navigatorSections.ts`
- Test: `apps/console/test/navigatorSections.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/console/test/navigatorSections.test.ts` inside the existing `describe` block:

```typescript
test("tags each section with cross_episode or per_episode group", () => {
  const sections = buildNavigatorSections({
    hasSource: true,
    hasCatalog: true,
    hasScript: true,
    hasAssets: true,
    hasStoryboard: true,
    episodeIds: ["ep001"],
  });

  const groups = Object.fromEntries(
    sections.map((section) => [section.key, section.group]),
  );
  expect(groups).toEqual({
    overview: "cross_episode",
    inputs: "cross_episode",
    catalog: "cross_episode",
    script: "cross_episode",
    assets: "cross_episode",
    storyboard: "per_episode",
    episodes: "per_episode",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/console && bun test test/navigatorSections.test.ts`
Expected: FAIL with `groups[...].group` undefined / property does not exist on `NavigatorSection`.

- [ ] **Step 3: Add `group` field to interface and implementation**

Edit `apps/console/src/lib/navigatorSections.ts` to:

```typescript
// input: project production progress flags
// output: stable director/producer navigation sections
// pos: keeps the sidebar centered on production structure instead of raw workspace folders

export type NavigatorGroup = "cross_episode" | "per_episode";

export interface NavigatorSection {
  key: "overview" | "inputs" | "catalog" | "script" | "assets" | "storyboard" | "episodes";
  label: string;
  available: boolean;
  group: NavigatorGroup;
}

export function buildNavigatorSections(input: {
  hasSource: boolean;
  hasCatalog: boolean;
  hasScript: boolean;
  hasAssets: boolean;
  hasStoryboard: boolean;
  episodeIds: string[];
}): NavigatorSection[] {
  return [
    { key: "overview", label: "总览", available: true, group: "cross_episode" },
    { key: "inputs", label: "输入源", available: input.hasSource, group: "cross_episode" },
    { key: "catalog", label: "视觉设定", available: input.hasCatalog, group: "cross_episode" },
    { key: "script", label: "剧本开发", available: input.hasScript, group: "cross_episode" },
    { key: "assets", label: "素材", available: input.hasAssets, group: "cross_episode" },
    { key: "storyboard", label: "故事板", available: input.hasStoryboard, group: "per_episode" },
    { key: "episodes", label: "分集视频", available: input.episodeIds.length > 0, group: "per_episode" },
  ];
}
```

- [ ] **Step 4: Run all navigatorSections tests to verify they pass**

Run: `cd apps/console && bun test test/navigatorSections.test.ts`
Expected: PASS — all four tests (existing three + new one).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/navigatorSections.ts apps/console/test/navigatorSections.test.ts
git commit -m "feat(navigator): tag sections with cross_episode/per_episode group"
```

---

## Task 2: Episode sub-stage helper (TDD)

**Files:**
- Create: `apps/console/src/lib/episodeSubStages.ts`
- Test: `apps/console/test/episodeSubStages.test.ts`

This pure helper isolates the rule "given an episode and the MVP stage list, what sub-stage rows do we render?". Keeps the component a thin renderer in Task 3.

- [ ] **Step 1: Write the failing test**

Create `apps/console/test/episodeSubStages.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildEpisodeSubStages } from "../src/lib/episodeSubStages";
import type { EpisodeState } from "../src/types";

describe("buildEpisodeSubStages", () => {
  test("returns one row per MVP per-episode stage with status and path", () => {
    const ep: EpisodeState = {
      storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
      video: { status: "running" },
    };

    const rows = buildEpisodeSubStages("ep001", ep);

    expect(rows).toEqual([
      {
        stage: "STORYBOARD",
        label: "故事板",
        status: "completed",
        path: "output/storyboard/approved/ep001_storyboard.json",
        title: "ep001/故事板",
      },
      {
        stage: "VIDEO",
        label: "视频",
        status: "running",
        path: "output/ep001",
        title: "ep001/视频",
      },
    ]);
  });

  test("falls back to not_started when episode has no per-stage entry", () => {
    const rows = buildEpisodeSubStages("ep002", undefined);
    expect(rows.map((row) => row.status)).toEqual(["not_started", "not_started"]);
    expect(rows.map((row) => row.stage)).toEqual(["STORYBOARD", "VIDEO"]);
  });

  test("uses default storyboard path when artifact missing", () => {
    const ep: EpisodeState = { storyboard: { status: "not_started" } };
    const rows = buildEpisodeSubStages("ep003", ep);
    const sb = rows.find((row) => row.stage === "STORYBOARD")!;
    expect(sb.path).toBe("output/storyboard/draft/ep003_storyboard.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/console && bun test test/episodeSubStages.test.ts`
Expected: FAIL — module `../src/lib/episodeSubStages` not found.

- [ ] **Step 3: Implement the helper**

Create `apps/console/src/lib/episodeSubStages.ts`:

```typescript
// input: episode id + EpisodeState slice
// output: ordered rows describing each per-episode sub-stage in MVP scope
// pos: pure mapper used by EpisodeNode to render its expanded children

import type { EpisodeState, StageStatus } from "../types";

export interface EpisodeSubStageRow {
  stage: "STORYBOARD" | "VIDEO";
  label: string;
  status: StageStatus;
  path: string;
  title: string;
}

const PER_EPISODE_MVP_STAGES = ["STORYBOARD", "VIDEO"] as const;

export function buildEpisodeSubStages(
  epId: string,
  ep: EpisodeState | undefined,
): EpisodeSubStageRow[] {
  return PER_EPISODE_MVP_STAGES.map((stage) => {
    if (stage === "STORYBOARD") {
      return {
        stage,
        label: "故事板",
        status: ep?.storyboard?.status ?? "not_started",
        path: ep?.storyboard?.artifact ?? `output/storyboard/draft/${epId}_storyboard.json`,
        title: `${epId}/故事板`,
      };
    }
    return {
      stage: "VIDEO",
      label: "视频",
      status: ep?.video?.status ?? "not_started",
      path: `output/${epId}`,
      title: `${epId}/视频`,
    };
  });
}
```

- [ ] **Step 4: Run test to verify all three cases pass**

Run: `cd apps/console && bun test test/episodeSubStages.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/episodeSubStages.ts apps/console/test/episodeSubStages.test.ts
git commit -m "feat(navigator): pure helper mapping episode to sub-stage rows"
```

---

## Task 3: Refactor EpisodeNode to expandable with sub-stage children (TDD)

**Files:**
- Modify: `apps/console/src/components/Navigator/EpisodeNode.tsx`
- Test: `apps/console/test/episodeNode.test.tsx` (create)

- [ ] **Step 1: Write the failing render test**

Create `apps/console/test/episodeNode.test.tsx`:

```typescript
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EpisodeNode } from "../src/components/Navigator/EpisodeNode";
import { TabsProvider } from "../src/contexts/TabsContext";
import type { EpisodeState } from "../src/types";

function render(ui: React.ReactElement) {
  return renderToStaticMarkup(<TabsProvider>{ui}</TabsProvider>);
}

describe("EpisodeNode", () => {
  test("renders ep id with rolled-up status and sub-stage rows when expanded", () => {
    const ep: EpisodeState = {
      storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
      video: { status: "running" },
    };

    const html = render(
      <EpisodeNode
        epId="ep001"
        ep={ep}
        unread={new Map()}
        defaultOpen
      />,
    );

    expect(html).toContain("ep001");
    expect(html).toContain("故事板");
    expect(html).toContain("视频");
  });

  test("collapsed by default does not render sub-stage labels", () => {
    const html = render(
      <EpisodeNode
        epId="ep002"
        ep={undefined}
        unread={new Map()}
      />,
    );
    expect(html).toContain("ep002");
    expect(html).not.toContain("故事板");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/console && bun test test/episodeNode.test.tsx`
Expected: FAIL — `EpisodeNode` does not accept `defaultOpen`, does not render sub-stage children.

- [ ] **Step 3: Rewrite `EpisodeNode` as expandable**

Replace `apps/console/src/components/Navigator/EpisodeNode.tsx` contents with:

```typescript
// input: episode id + EpisodeState slice + unread map
// output: expandable navigator row that lists this episode's sub-stage artifacts
// pos: per-episode cluster node in the sidebar's per_episode group

import { useState } from "react";
import type { EpisodeState } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { rollupEpisodeStatus } from "../../lib/episodeStatus";
import { buildEpisodeSubStages } from "../../lib/episodeSubStages";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
  markSeen?: (path: string) => void;
  defaultOpen?: boolean;
}

export function EpisodeNode({ epId, ep, unread, markSeen, defaultOpen = false }: Props) {
  const { openPath } = useTabs();
  const [open, setOpen] = useState(defaultOpen);
  const worstStatus = rollupEpisodeStatus(ep);
  const rows = buildEpisodeSubStages(epId, ep);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="font-medium">{epId}</span>
        <StatusBadge status={worstStatus} />
        <span
          className="ml-auto font-mono text-[10px] text-[var(--color-ink-faint)] select-none w-3 text-right"
          aria-hidden
        >
          {open ? "−" : "+"}
        </span>
      </div>
      {open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">
          {rows.map((row) => (
            <div
              key={row.stage}
              className="pl-6 pr-4 py-1 text-[12px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors flex items-center gap-2"
              onClick={() => {
                openPath(row.path, resolveView(row.path), row.title, { pinned: true });
                markSeen?.(row.path);
              }}
            >
              <span>{row.label}</span>
              <StatusBadge status={row.status} unread={unread.get(row.path)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/console && bun test test/episodeNode.test.tsx`
Expected: PASS — both render cases.

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `cd apps/console && bun test`
Expected: PASS. If `navigatorStoryboards.test.tsx` fails, that's expected — it's repaired in Task 4.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/Navigator/EpisodeNode.tsx apps/console/test/episodeNode.test.tsx
git commit -m "feat(navigator): make EpisodeNode expandable with sub-stage rows"
```

---

## Task 4: Wire the hybrid layout in Navigator.tsx and remove StoryboardNode

**Files:**
- Modify: `apps/console/src/components/Navigator/Navigator.tsx`
- Modify: `apps/console/test/navigatorStoryboards.test.tsx`
- Delete: `apps/console/src/components/Navigator/StoryboardNode.tsx`

- [ ] **Step 1: Read existing storyboard navigator test to understand assertions**

Run: `cat apps/console/test/navigatorStoryboards.test.tsx`
Take note of which DOM strings or behaviors it asserts so we can decide what to keep vs. rewrite.

- [ ] **Step 2: Update the storyboard navigator test for the new tree**

Rewrite `apps/console/test/navigatorStoryboards.test.tsx` so it asserts the new structure:

- The standalone `故事板` cross-episode node is gone.
- Each `epXXX` node, when expanded, exposes a `故事板` row pointing at the approved/draft artifact path.
- A test that previously asserted the old standalone node should now assert the per-episode row.

Concretely, the new assertion shape should look like:

```typescript
test("approved storyboard surfaces under its episode node", () => {
  const html = renderNavigator({
    tree: [{ type: "file", path: "output/storyboard/approved/ep001_storyboard.json" }],
    state: {
      stages: { STORYBOARD: { status: "completed" } },
      episodes: {
        ep001: {
          storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
          video: { status: "not_started" },
        },
      },
    },
    defaultOpen: true,
  });
  expect(html).toContain("ep001");
  expect(html).toContain("故事板");
  expect(html).toContain("output/storyboard/approved/ep001_storyboard.json");
});
```

Match the exact `renderNavigator` signature already used in the file; preserve its harness, replace only the assertions.

- [ ] **Step 3: Run the rewritten test to verify it fails**

Run: `cd apps/console && bun test test/navigatorStoryboards.test.tsx`
Expected: FAIL — `Navigator.tsx` still renders the old `StoryboardNode` and the per-episode rows aren't in scope yet.

- [ ] **Step 4: Refactor Navigator.tsx to render groups with a divider and drop StoryboardNode**

Edit `apps/console/src/components/Navigator/Navigator.tsx`:

1. Remove the `import { StoryboardNode }` line.
2. Remove the `storyboardPaths` block (lines 40-43) — episode storyboard paths are now sourced from `state.episodes[*].storyboard.artifact` via the helper from Task 2.
3. Remove the entire `if (section.key === "storyboard")` branch (lines 182-193).
4. Wrap the `sections.map` call so that the first time the loop transitions from `cross_episode` to `per_episode`, a horizontal rule is emitted:

```tsx
let lastGroup: "cross_episode" | "per_episode" | null = null;
return (
  <div className="py-4 overflow-y-auto h-full">
    {sections.map((section) => {
      const dividerNeeded = lastGroup === "cross_episode" && section.group === "per_episode";
      lastGroup = section.group;
      const node = renderSection(section); // existing branch logic moved into helper or kept inline
      return (
        <div key={section.key}>
          {dividerNeeded && (
            <div className="my-2 border-t border-[var(--color-rule)]" aria-hidden />
          )}
          {node}
        </div>
      );
    })}
  </div>
);
```

5. The `else` fall-through that renders `epIds.map((id) => <EpisodeNode ... />)` already targets the `episodes` section. Pass `defaultOpen` only for the running episode if convenient, otherwise leave default closed.

- [ ] **Step 5: Run the full test suite to verify everything passes**

Run: `cd apps/console && bun test`
Expected: PASS — all suites green.

- [ ] **Step 6: Delete StoryboardNode.tsx (now unused) and verify build**

Run:
```bash
rm apps/console/src/components/Navigator/StoryboardNode.tsx
cd apps/console && bun run build 2>&1 | tail -20
```
Expected: Build succeeds. If TypeScript reports a stray import, search for `StoryboardNode` references via `grep -r "StoryboardNode" apps/console/src` and remove them.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/Navigator/Navigator.tsx \
        apps/console/src/components/Navigator/StoryboardNode.tsx \
        apps/console/test/navigatorStoryboards.test.tsx
git commit -m "feat(navigator): hybrid layout with cross_episode + per_episode groups"
```

(Note: a deleted file shows up in `git add` as a removal. If git misses it, run `git rm apps/console/src/components/Navigator/StoryboardNode.tsx` instead.)

---

## Task 5: Manual visual verification

**Files:** none

- [ ] **Step 1: Start the console dev server**

Run: `cd apps/console && bun run dev`
Wait for the dev server URL (typically `http://localhost:5173`).

- [ ] **Step 2: Open a project that already has at least one episode in `pipeline-state.json`**

Pick any `workspace/<name>/` whose `pipeline-state.json` lists `episodes.ep001` with both `storyboard` and `video` keys. If none exists locally, run the SCRIPT and STORYBOARD stages on a small sample to seed one.

- [ ] **Step 3: Verify the sidebar layout**

In the browser:
1. Confirm the top section shows: `总览 / 输入源 / 视觉设定 / 剧本开发 / 素材` with no per-episode items.
2. Confirm a horizontal divider appears between `素材` and the per-episode area.
3. Confirm the per-episode area lists `epXXX` nodes; clicking one expands into `故事板` and `视频` rows.
4. Confirm clicking a sub-row opens the same artifact a click in the old layout would have opened (storyboard artifact for `故事板`, `output/epXXX` listing for `视频`).
5. Confirm the episode node's status badge reflects the worst sub-stage status (e.g. red/failed if either child failed).

- [ ] **Step 4: Verify on an empty project (no episodes yet)**

Open a project where `script.json` exists but no episodes have been generated. Confirm:
1. No per-episode area renders at all (the divider does not appear if there's nothing on the per-episode side).
2. Cross-episode nodes still render correctly.

- [ ] **Step 5: Commit any incidental fixes**

If Step 3 or 4 surfaced a glitch (e.g. divider rendering when per-episode group is empty, or a wrong icon), fix it and commit:

```bash
git add -p
git commit -m "fix(navigator): <specific fix>"
```

---

## Self-Review Checklist (run before handoff)

- [ ] Spec coverage: every layout decision in the brainstorm trace (cross-episode top section, divider, per-episode expandable nodes with sub-stage rows, MVP-aware sub-stage list, status rollup at the episode header) is realized by at least one task.
- [ ] No placeholders: every code block contains real code, not "// TODO".
- [ ] Type consistency: `NavigatorGroup`, `NavigatorSection.group`, `EpisodeSubStageRow`, and the `defaultOpen` prop on `EpisodeNode` are spelled identically across tasks.
- [ ] Test infrastructure: tests use `bun:test` and `react-dom/server` consistent with `apps/console/test/episodeStatus.test.ts` and `apps/console/test/stageNode.test.tsx`.
- [ ] Deletion safety: Task 4 Step 6 verifies no remaining `StoryboardNode` references before the file is deleted.
