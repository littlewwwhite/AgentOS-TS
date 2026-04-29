# Video Review Workbench Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a XiaoYunque-inspired review workbench for storyboard and video pages, with a persistent in-workbench asset rail, synchronized segment script, video preview, and timeline.

**Architecture:** Keep the existing global `Navigator` as project navigation. Add review-workbench components inside the viewer surface and move reusable clip/asset derivation into pure helpers first, so `StoryboardView` and video review can share state without duplicating path and timeline logic.

**Tech Stack:** Bun, React 19, TypeScript, existing `ProjectContext` / `TabsContext`, `useFileJson`, `useEditableJson`, and `apps/console/src/lib/storyboard.ts`.

---

## Context

Read first:

- `docs/plans/2026-04-29-video-review-workbench-design.md`
- `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- `apps/console/src/components/Viewer/views/VideoGridView.tsx`
- `apps/console/src/lib/storyboard.ts`
- `apps/console/test/lib.test.ts`
- `apps/console/test/storyboardViewRender.test.tsx`

Implementation constraints:

- Do not replace the global `Navigator`.
- Keep `output/actors`, `output/locations`, `output/props` as global asset-gallery entries.
- Keep no-storyboard video directories working through a file-grid fallback.
- Use TDD for every behavior change.
- Use `bun test`, not npm/pnpm.

## Task 1: Add pure asset rail model helpers

**Files:**

- Modify: `apps/console/src/lib/storyboard.ts`
- Test: `apps/console/test/lib.test.ts`

**Step 1: Write the failing test**

Add tests near the existing storyboard helper tests:

```ts
import {
  buildProductionAssetRailModel,
  type StoryboardSceneLike,
} from "../src/lib/storyboard";

test("builds asset rail groups with current clip assets highlighted", () => {
  const scenes: Array<StoryboardSceneLike & { scene_id: string }> = [
    {
      scene_id: "scn_001",
      actors: [{ actor_id: "act_001" }],
      locations: [{ location_id: "loc_001" }],
      props: [{ prop_id: "prop_001" }],
    },
    {
      scene_id: "scn_002",
      actors: [{ actor_id: "act_002" }],
      locations: [{ location_id: "loc_002" }],
    },
  ];

  const model = buildProductionAssetRailModel({
    scenes,
    currentSceneId: "scn_001",
    dict: {
      act_001: "林萧",
      act_002: "王强",
      loc_001: "废墟街道",
      loc_002: "地下室",
      prop_001: "废铁",
    },
    availablePaths: [
      "output/actors/act_001/ref.png",
      "output/locations/loc_001/ref.png",
      "output/props/prop_001/ref.png",
    ],
  });

  expect(model.groups.actor.items).toEqual([
    expect.objectContaining({ id: "act_001", label: "林萧", scope: "current", thumbnailPath: "output/actors/act_001/ref.png" }),
    expect.objectContaining({ id: "act_002", label: "王强", scope: "episode" }),
  ]);
  expect(model.groups.location.items[0]).toMatchObject({
    id: "loc_001",
    label: "废墟街道",
    scope: "current",
    thumbnailPath: "output/locations/loc_001/ref.png",
  });
  expect(model.groups.prop.items[0]).toMatchObject({
    id: "prop_001",
    label: "废铁",
    scope: "current",
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd apps/console
bun test test/lib.test.ts
```

Expected: FAIL with `buildProductionAssetRailModel` not exported.

**Step 3: Write minimal implementation**

Add exported types and helper functions to `apps/console/src/lib/storyboard.ts`.

Implementation shape:

```ts
export type ProductionAssetKind = "actor" | "location" | "prop";
export type ProductionAssetScope = "current" | "episode" | "project";

export interface ProductionAssetRailItem {
  kind: ProductionAssetKind;
  id: string;
  label: string;
  scope: ProductionAssetScope;
  thumbnailPath: string | null;
}

export interface ProductionAssetRailModel {
  groups: Record<ProductionAssetKind, { label: string; items: ProductionAssetRailItem[] }>;
}
```

Rules:

- Current scene assets get `scope: "current"`.
- Assets used elsewhere in the episode get `scope: "episode"`.
- Future catalog-only assets may use `scope: "project"`, but do not add catalog support in this task unless needed.
- Thumbnail path resolution should be deterministic and conservative:
  - actor: first image path under `output/actors/<id>/`
  - location: first image path under `output/locations/<id>/`
  - prop: first image path under `output/props/<id>/`
  - accepted extensions: `png`, `jpg`, `jpeg`, `webp`

**Step 4: Run test to verify it passes**

Run:

```bash
cd apps/console
bun test test/lib.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/console/src/lib/storyboard.ts apps/console/test/lib.test.ts
git commit -m "feat(console): derive review workbench asset rail model"
```

## Task 2: Add ProductionAssetRail read-only component

**Files:**

- Create: `apps/console/src/components/Viewer/review/ProductionAssetRail.tsx`
- Test: `apps/console/test/productionAssetRail.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionAssetRail } from "../src/components/Viewer/review/ProductionAssetRail";

describe("ProductionAssetRail", () => {
  test("renders grouped current and episode assets", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionAssetRail, {
        projectName: "demo",
        model: {
          groups: {
            actor: {
              label: "角色",
              items: [
                { kind: "actor", id: "act_001", label: "林萧", scope: "current", thumbnailPath: "output/actors/act_001/ref.png" },
                { kind: "actor", id: "act_002", label: "王强", scope: "episode", thumbnailPath: null },
              ],
            },
            location: { label: "场景", items: [] },
            prop: { label: "道具", items: [] },
          },
        },
      }),
    );

    expect(html).toContain("资产库");
    expect(html).toContain("角色");
    expect(html).toContain("林萧");
    expect(html).toContain("当前片段");
    expect(html).toContain("王强");
    expect(html).toContain("本集");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd apps/console
bun test test/productionAssetRail.test.tsx
```

Expected: FAIL with component not found.

**Step 3: Write minimal implementation**

Create `ProductionAssetRail.tsx`.

Requirements:

- Use a fixed-width rail suitable for embedding inside the viewer, around `w-[280px]`.
- Header label: `资产库`.
- Sections: `角色`, `场景`, `道具`.
- Current assets should have stronger border/background.
- Missing thumbnails should render a stable empty thumbnail with the asset name initials or id text.
- Use `fileUrl(projectName, thumbnailPath)` when `thumbnailPath` exists.

**Step 4: Run test to verify it passes**

Run:

```bash
cd apps/console
bun test test/productionAssetRail.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/console/src/components/Viewer/review/ProductionAssetRail.tsx apps/console/test/productionAssetRail.test.tsx
git commit -m "feat(console): add review workbench asset rail"
```

## Task 3: Extract shared segment timeline component

**Files:**

- Create: `apps/console/src/components/Viewer/review/SegmentTimeline.tsx`
- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Test: `apps/console/test/segmentTimeline.test.tsx`
- Test: `apps/console/test/storyboardViewRender.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentTimeline } from "../src/components/Viewer/review/SegmentTimeline";

describe("SegmentTimeline", () => {
  test("renders total time, selected segment, and clip duration", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentTimeline, {
        projectName: "demo",
        clips: [
          {
            key: "scn_001::clip_001",
            sceneId: "scn_001",
            sceneIndex: 0,
            clipId: "clip_001",
            clipIndex: 0,
            videoPath: "output/ep001/scn001/clip001/ep001_scn001_clip001.mp4",
            expectedDuration: null,
            totalDuration: 15,
            startOffset: 0,
            endOffset: 15,
            shotCount: 3,
            displayText: "片段一",
            shots: [],
          },
        ],
        currentClipKey: "scn_001::clip_001",
        availablePaths: new Set(["output/ep001/scn001/clip001/ep001_scn001_clip001.mp4"]),
        episodeTime: 0,
        totalDuration: 72,
        onSelectClip: () => undefined,
      }),
    );

    expect(html).toContain("按时间线播放");
    expect(html).toContain("00:00 / 01:12");
    expect(html).toContain("片段 1");
    expect(html).toContain("00:15");
    expect(html).toContain("aria-current=\"true\"");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd apps/console
bun test test/segmentTimeline.test.tsx
```

Expected: FAIL with component not found.

**Step 3: Write minimal implementation**

Move the existing `VideoClipStrip` behavior into `SegmentTimeline`.

Requirements:

- Keep `aria-label="视频片段轨"` or equivalent.
- Render time as `mm:ss / mm:ss`.
- Render clip thumbnail from video when available.
- Preserve current StoryboardView behavior after migration.
- Do not implement multi-select yet; render disabled `多选` only if needed for layout parity.

**Step 4: Replace StoryboardView local strip**

- Remove local `VideoClipStrip` from `StoryboardView.tsx`.
- Import `SegmentTimeline`.
- Pass `episodeTime`, `editorModel.totalDuration`, `editorModel.clips`, `treePaths`, and `handleSelectClip`.

**Step 5: Run tests**

Run:

```bash
cd apps/console
bun test test/segmentTimeline.test.tsx test/storyboardViewRender.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/console/src/components/Viewer/review/SegmentTimeline.tsx apps/console/src/components/Viewer/views/StoryboardView.tsx apps/console/test/segmentTimeline.test.tsx apps/console/test/storyboardViewRender.test.tsx
git commit -m "feat(console): share segment timeline component"
```

## Task 4: Add workbench asset rail to StoryboardView

**Files:**

- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Test: `apps/console/test/storyboardViewRender.test.tsx`

**Step 1: Write the failing test**

Extend the existing first render test:

```ts
expect(html).toContain("资产库");
expect(html).toContain("角色");
expect(html).toContain("场景");
```

Add actor/location data to the test storyboard and script fixtures as needed.

**Step 2: Run test to verify it fails**

Run:

```bash
cd apps/console
bun test test/storyboardViewRender.test.tsx
```

Expected: FAIL because the storyboard surface does not render the workbench asset rail.

**Step 3: Implement**

In `StoryboardView`:

- Build `assetRailModel` with `buildProductionAssetRailModel`.
- Use `currentClip?.sceneId` as `currentSceneId`.
- Insert `ProductionAssetRail` inside the main non-draft storyboard layout, left of the existing script/video/timeline area.

Layout target:

```tsx
<div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-4 ...">
  <ProductionAssetRail ... />
  <div className="min-h-0 min-w-0">...</div>
</div>
```

Keep the old empty-state behavior when there are no generation units and no clips.

**Step 4: Run tests**

Run:

```bash
cd apps/console
bun test test/storyboardViewRender.test.tsx test/productionAssetRail.test.tsx test/lib.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/console/src/components/Viewer/views/StoryboardView.tsx apps/console/test/storyboardViewRender.test.tsx
git commit -m "feat(console): show asset rail in storyboard review"
```

## Task 5: Add video review storyboard resolution

**Files:**

- Create: `apps/console/src/lib/videoReview.ts`
- Modify: `apps/console/src/components/Viewer/views/VideoGridView.tsx`
- Test: `apps/console/test/videoReview.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { resolveVideoReviewStoryboardPath } from "../src/lib/videoReview";

describe("resolveVideoReviewStoryboardPath", () => {
  test("finds runtime storyboard inside an episode directory first", () => {
    expect(resolveVideoReviewStoryboardPath({
      videoDir: "output/ep001",
      treePaths: new Set([
        "output/ep001/ep001_storyboard.json",
        "output/storyboard/approved/ep001_storyboard.json",
      ]),
      stateStoryboardPath: "output/storyboard/approved/ep001_storyboard.json",
    })).toBe("output/ep001/ep001_storyboard.json");
  });

  test("falls back to state storyboard artifact", () => {
    expect(resolveVideoReviewStoryboardPath({
      videoDir: "output/ep001",
      treePaths: new Set(["output/storyboard/approved/ep001_storyboard.json"]),
      stateStoryboardPath: "output/storyboard/approved/ep001_storyboard.json",
    })).toBe("output/storyboard/approved/ep001_storyboard.json");
  });

  test("returns null when no storyboard exists", () => {
    expect(resolveVideoReviewStoryboardPath({
      videoDir: "output/ep001",
      treePaths: new Set(["output/ep001/scn001/clip001/a.mp4"]),
    })).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd apps/console
bun test test/videoReview.test.ts
```

Expected: FAIL with module not found.

**Step 3: Implement**

Rules:

- Parse episode id from `output/ep001`.
- Prefer `output/ep001/ep001_storyboard.json`.
- Then use `stateStoryboardPath` if present and exists in tree.
- Then try `output/storyboard/approved/ep001_storyboard.json`.
- Then try `output/storyboard/draft/ep001_storyboard.json`.
- Return `null` if none exists.

**Step 4: Run test**

Run:

```bash
cd apps/console
bun test test/videoReview.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/console/src/lib/videoReview.ts apps/console/test/videoReview.test.ts
git commit -m "feat(console): resolve video review storyboard paths"
```

## Task 6: Replace video directory view with review workbench when storyboard exists

**Files:**

- Create: `apps/console/src/components/Viewer/review/EpisodeReviewWorkbench.tsx`
- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Modify: `apps/console/src/components/Viewer/views/VideoGridView.tsx`
- Test: `apps/console/test/videoGridViewRender.test.tsx`
- Test: `apps/console/test/storyboardViewRender.test.tsx`

**Step 1: Write failing VideoGridView tests**

Mock `useProject` and `useFileJson`, following `storyboardViewRender.test.tsx`.

Required assertions:

```ts
expect(html).toContain("资产库");
expect(html).toContain("片段 1");
expect(html).toContain("生成视频 prompt");
expect(html).not.toContain("暂无视频文件");
```

Add a second test for fallback:

```ts
expect(html).toContain("未找到分镜结构，按文件展示视频");
expect(html).toContain("output/ep001/scn001/clip001/a.mp4");
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd apps/console
bun test test/videoGridViewRender.test.tsx
```

Expected: FAIL because `VideoGridView` still renders only file-grid behavior.

**Step 3: Extract EpisodeReviewWorkbench**

Move shared non-draft storyboard review UI into `EpisodeReviewWorkbench`.

Props:

```ts
interface EpisodeReviewWorkbenchProps {
  projectName: string;
  storyboardPath: string;
  data: StoryboardJson;
  scriptData: ScriptJson | null | undefined;
  catalogData: ScriptJson | null | undefined;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  savedAt: number | null;
  error: string | null;
  readOnly: boolean;
  patch: (path: string, value: unknown) => void;
  onActionDone: () => void;
  showLifecycleActions: boolean;
}
```

For video review, pass:

- `readOnly: true`
- no-op `patch`
- `showLifecycleActions: false`
- `status: "idle"`

**Step 4: Wire StoryboardView to EpisodeReviewWorkbench**

Keep draft storyboard behavior local to `StoryboardView`.

For non-draft storyboard data, render `EpisodeReviewWorkbench`.

**Step 5: Wire VideoGridView**

In `VideoGridView`:

- Use `resolveVideoReviewStoryboardPath`.
- Load storyboard JSON through `useFileJson`.
- If storyboard path and data exist, render `EpisodeReviewWorkbench`.
- If no storyboard path or data, render existing video file grid with the fallback notice.

**Step 6: Run targeted tests**

Run:

```bash
cd apps/console
bun test test/storyboardViewRender.test.tsx test/videoGridViewRender.test.tsx test/videoReview.test.ts test/lib.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/console/src/components/Viewer/review/EpisodeReviewWorkbench.tsx apps/console/src/components/Viewer/views/StoryboardView.tsx apps/console/src/components/Viewer/views/VideoGridView.tsx apps/console/test/videoGridViewRender.test.tsx apps/console/test/storyboardViewRender.test.tsx
git commit -m "feat(console): reuse review workbench for video directories"
```

## Task 7: Visual verification in local browser

**Files:**

- No production code expected unless verification reveals layout defects.

**Step 1: Run full console tests**

Run:

```bash
cd apps/console
bun test
```

Expected: PASS.

**Step 2: Start dev server**

Run:

```bash
cd apps/console
bun dev
```

Expected: Vite and server start without errors.

**Step 3: Inspect in browser**

Open the console app and verify:

- Storyboard page shows global navigator plus internal asset rail.
- Video page for an episode with storyboard shows the same workbench structure.
- Video page without storyboard shows file-grid fallback and notice.
- Timeline click updates script panel and video preview.
- Text does not overflow in asset cards, timeline cards, or top bar at desktop width.

**Step 4: Fix visual regressions if found**

Use focused CSS/layout changes only.

Run after fixes:

```bash
cd apps/console
bun test test/storyboardViewRender.test.tsx test/videoGridViewRender.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/console/src apps/console/test
git commit -m "fix(console): polish review workbench layout"
```

Skip this commit if no fixes are needed.

## Final Verification

Run:

```bash
cd apps/console
bun test
bun run build
```

Expected:

- All tests pass.
- Production build succeeds.
- Existing unrelated dirty files remain untouched.
