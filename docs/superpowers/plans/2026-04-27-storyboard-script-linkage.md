# Storyboard Script Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the storyboard workspace show which script beats produced each storyboard prompt call, what shots came out of that call, and whether the corresponding video exists, while keeping Script, Storyboard, and Video as separate production modules.

**Architecture:** Add a pure storyboard linkage model in `src/lib/storyboard.ts` that derives UI-ready generation units from `storyboard.json`, `script.json`, and the project media tree. `StoryboardView.tsx` should render those units as the primary storyboard surface: script evidence → storyboard prompt call → shot results → video readiness. Existing timeline and playback helpers remain as secondary support instead of driving the page structure.

**Tech Stack:** React 19, TypeScript, Vite, Bun test, existing `useEditableJson`, `useFileJson`, `useProject`, and storyboard/fountain utility modules.

---

## File Map

- Modify: `apps/console/src/lib/storyboard.ts`
  - Add the `StoryboardGenerationUnit` model and pure builders.
  - Keep media path resolution and prompt parsing in one shared domain helper file.
- Modify: `apps/console/test/lib.test.ts`
  - Add RED/GREEN coverage for script excerpt extraction, source ref labels, prompt preservation, parsed shots, and video readiness.
- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
  - Render storyboard generation units as the primary view.
  - Keep the existing preview/timeline as a secondary section.
- Modify: `apps/console/test/storyboardViewRender.test.tsx`
  - Verify approved storyboard pages display script linkage and do not collapse to an empty state when video is missing.
- Modify: `apps/console/test/storyboardViewChrome.test.ts`
  - Lock out file/path/video-first wording from the storyboard primary surface.
- Modify: `apps/console/test/navigatorStoryboards.test.tsx`
  - Lock the boundary that Storyboard navigation opens storyboard JSON, while Video navigation is about video outputs or pending video status.

---

### Task 1: Add a storyboard generation unit domain model

**Files:**
- Modify: `apps/console/src/lib/storyboard.ts`
- Test: `apps/console/test/lib.test.ts`

- [ ] **Step 1: Write the failing unit test**

Add these imports in `apps/console/test/lib.test.ts`:

```ts
import type { ScriptJson } from "../src/lib/fountain";
```

Extend the storyboard helper import list with `buildStoryboardGenerationUnits`:

```ts
import {
  buildClipInspectorData,
  buildStoryboardEditorModel,
  buildStoryboardGenerationUnits,
  clipVideoPath,
  durationFromRange,
  parseDraftStoryboardPrompt,
  resolveStoryboardSelectionAtTime,
  summarizeSourceRefs,
  splitStoryboardText,
} from "../src/lib/storyboard";
```

Add this test inside `describe("storyboard helpers", () => { ... })`:

```ts
test("builds storyboard generation units from script refs and approved prompt calls", () => {
  const script = {
    episodes: [
      {
        episode_id: "ep001",
        scenes: [
          {
            scene_id: "scn_001",
            actions: [
              { type: "action", content: "账房摊开银锭。" },
              { type: "dialogue", actor_id: "act_001", content: "这些账，今晚要清。" },
              { type: "action", content: "主角抬眼，屋内安静。" },
              { type: "action", content: "门外传来脚步声。" },
            ],
          },
        ],
      },
    ],
    actors: [{ actor_id: "act_001", actor_name: "灵霜" }],
  } satisfies ScriptJson;

  const units = buildStoryboardGenerationUnits(
    "output/storyboard/approved/ep001_storyboard.json",
    [
      {
        scene_id: "scn_001",
        shots: [
          {
            source_refs: [0, 1, 2],
            prompt: `PART1\n\n总体描述：压抑内宅。\n\n\`\`\`json\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景手部+银锭特写","beats":["账房摊开银锭"]},{"shot_id":"S2","time_range":"00:06-00:10","camera_setup":{"type":"中景"},"beats":["主角抬眼"]}]}\n\`\`\``,
          },
        ],
      },
    ],
    script,
    new Set(["output/ep001/scn001/ep001_scn001_part001.mp4"]),
  );

  expect(units).toHaveLength(1);
  expect(units[0]).toMatchObject({
    key: "scn_001::part_001",
    episodeId: "ep001",
    sceneId: "scn_001",
    partId: "part_001",
    sourceRefsLabel: "0-2",
    promptSummary: "总体描述：压抑内宅。",
    videoStatus: "generated",
    videoPath: "output/ep001/scn001/ep001_scn001_part001.mp4",
  });
  expect(units[0]?.scriptExcerpt).toEqual([
    "账房摊开银锭。",
    "灵霜：这些账，今晚要清。",
    "主角抬眼，屋内安静。",
  ]);
  expect(units[0]?.prompt).toContain("总体描述：压抑内宅。");
  expect(units[0]?.shots).toEqual([
    {
      shotId: "S1",
      timeRange: "00:00-00:06",
      duration: 6,
      prompt: "近景手部+银锭特写\n账房摊开银锭",
    },
    {
      shotId: "S2",
      timeRange: "00:06-00:10",
      duration: 4,
      prompt: "中景\n主角抬眼",
    },
  ]);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/lib.test.ts"
```

Expected: FAIL with an export/import error for `buildStoryboardGenerationUnits`.

- [ ] **Step 3: Add types and pure builders**

In `apps/console/src/lib/storyboard.ts`, add this import at the top next to the existing fountain import:

```ts
import { buildFountainTokens, buildRefDict, type FountainToken, type ScriptJson } from "./fountain";
```

Replace the current import:

```ts
import { resolveRefs } from "./fountain";
```

with the combined import above.

Add these exported interfaces after `DraftStoryboardPromptSummary`:

```ts
export interface StoryboardGenerationUnitShot {
  shotId: string;
  timeRange: string | null;
  duration: number;
  prompt: string;
}

export interface StoryboardGenerationUnit {
  key: string;
  episodeId: string;
  sceneId: string;
  partId: string;
  sourceRefsLabel: string;
  scriptExcerpt: string[];
  prompt: string;
  promptSummary: string;
  shots: StoryboardGenerationUnitShot[];
  videoPath: string;
  videoStatus: "not_generated" | "generated";
}
```

Add these helper functions before `buildStoryboardEditorModel`:

```ts
function episodeIdFromStoryboardDataPath(storyboardPath: string): string {
  return episodeIdFromStoryboardPath(storyboardPath) ?? episodeSlugFromPath(storyboardPath);
}

function dialogueTokenText(token: Extract<FountainToken, { kind: "dialogue" }>, dict: Record<string, string>): string {
  const name = dict[token.actorId] ?? token.actorId;
  return `${name}：${token.text}`;
}

function scriptBeatText(token: FountainToken, dict: Record<string, string>): string | null {
  if (token.kind === "action") return token.text;
  if (token.kind === "dialogue") return dialogueTokenText(token, dict);
  return null;
}

function sceneScriptBeats(script: ScriptJson | null | undefined, sceneId: string, dict: Record<string, string>): string[] {
  if (!script) return [];
  return buildFountainTokens(script)
    .filter((token) => "sceneId" in token && token.sceneId === sceneId)
    .map((token) => scriptBeatText(token, dict))
    .filter((value): value is string => Boolean(value));
}

function scriptExcerptFromRefs(beats: string[], refs: unknown): string[] {
  if (!isNumberArray(refs)) return [];
  return refs
    .map((ref) => beats[ref])
    .filter((value): value is string => Boolean(value));
}

function generationUnitShotsFromPrompt(prompt: string): StoryboardGenerationUnitShot[] {
  return storyboardShotsFromPrompt(prompt).map((shot) => ({
    shotId: shot.shot_id ?? "shot",
    timeRange: shot.time_range ?? null,
    duration: shotDuration(shot),
    prompt: shot.partial_prompt ?? "",
  }));
}
```

Add this exported builder before `buildStoryboardEditorModel`:

```ts
export function buildStoryboardGenerationUnits(
  storyboardPath: string,
  scenes: ReadonlyArray<StoryboardSceneLike & {
    scene_id: string;
    shots?: ReadonlyArray<StoryboardShotLike>;
  }>,
  script: ScriptJson | null | undefined,
  availablePaths?: Iterable<string>,
): StoryboardGenerationUnit[] {
  const dict = buildRefDict(script ?? {});
  const mediaPaths = availablePaths
    ? Array.from(new Set(Array.from(availablePaths).filter(isVideoPath)))
    : undefined;
  const episodeId = episodeIdFromStoryboardDataPath(storyboardPath);

  return scenes.flatMap((scene) => {
    const beats = sceneScriptBeats(script, scene.scene_id, dict);

    return (scene.shots ?? [])
      .filter((shot) => typeof shot.prompt === "string" && shot.prompt.trim())
      .map((shot, index) => {
        const partId = `part_${String(index + 1).padStart(3, "0")}`;
        const videoPath = resolveClipVideoPath(storyboardPath, scene.scene_id, partId, mediaPaths);
        const prompt = shot.prompt ?? "";

        return {
          key: `${scene.scene_id}::${partId}`,
          episodeId,
          sceneId: scene.scene_id,
          partId,
          sourceRefsLabel: summarizeSourceRefs(shot.source_refs),
          scriptExcerpt: scriptExcerptFromRefs(beats, shot.source_refs),
          prompt,
          promptSummary: storyboardPromptSummary(prompt),
          shots: generationUnitShotsFromPrompt(prompt),
          videoPath,
          videoStatus: mediaPaths?.includes(videoPath) ? "generated" : "not_generated",
        } satisfies StoryboardGenerationUnit;
      });
  });
}
```

- [ ] **Step 4: Run the test to verify GREEN**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/lib.test.ts"
```

Expected: PASS for all tests in `lib.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/storyboard.ts apps/console/test/lib.test.ts
git commit -m "Add storyboard script linkage model"
```

---

### Task 2: Cover missing-video and missing-script behavior

**Files:**
- Modify: `apps/console/src/lib/storyboard.ts`
- Test: `apps/console/test/lib.test.ts`

- [ ] **Step 1: Write failing edge-case tests**

Add these tests inside `describe("storyboard helpers", () => { ... })`:

```ts
test("marks storyboard generation units as pending video when no media exists", () => {
  const units = buildStoryboardGenerationUnits(
    "output/storyboard/approved/ep001_storyboard.json",
    [
      {
        scene_id: "scn_001",
        shots: [
          {
            source_refs: [0],
            prompt: `PART1\n\n总体描述：压抑内宅。\n\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景","beats":["账房摊开银锭"]}]}`,
          },
        ],
      },
    ],
    null,
    new Set(),
  );

  expect(units[0]?.videoStatus).toBe("not_generated");
  expect(units[0]?.videoPath).toBe("output/ep001/scn001/ep001_scn001_part001.mp4");
  expect(units[0]?.scriptExcerpt).toEqual([]);
});

test("keeps storyboard units usable when source refs point past available script beats", () => {
  const script = {
    episodes: [
      {
        episode_id: "ep001",
        scenes: [
          {
            scene_id: "scn_001",
            actions: [{ type: "action", content: "账房摊开银锭。" }],
          },
        ],
      },
    ],
  } satisfies ScriptJson;

  const units = buildStoryboardGenerationUnits(
    "output/storyboard/approved/ep001_storyboard.json",
    [
      {
        scene_id: "scn_001",
        shots: [
          {
            source_refs: [0, 9],
            prompt: `PART1\n\n总体描述：压抑内宅。\n\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景"}]}`,
          },
        ],
      },
    ],
    script,
  );

  expect(units[0]?.sourceRefsLabel).toBe("0, 9");
  expect(units[0]?.scriptExcerpt).toEqual(["账房摊开银锭。"]);
});
```

- [ ] **Step 2: Run tests to verify RED or confirm existing behavior**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/lib.test.ts"
```

Expected: If Task 1 implementation already handles these cases, the tests may pass immediately. If they fail, failures should be about `videoStatus`, fallback `videoPath`, or excerpt filtering.

- [ ] **Step 3: Apply the minimal fix if needed**

If `videoStatus` fails because fallback paths are compared against an empty media list, ensure the builder uses this exact status expression:

```ts
videoStatus: mediaPaths?.includes(videoPath) ? "generated" : "not_generated",
```

If `scriptExcerpt` fails for out-of-range refs, ensure `scriptExcerptFromRefs` filters missing beat values exactly as follows:

```ts
function scriptExcerptFromRefs(beats: string[], refs: unknown): string[] {
  if (!isNumberArray(refs)) return [];
  return refs
    .map((ref) => beats[ref])
    .filter((value): value is string => Boolean(value));
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/lib.test.ts"
```

Expected: PASS for all storyboard helper tests.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/storyboard.ts apps/console/test/lib.test.ts
git commit -m "Cover storyboard linkage fallbacks"
```

---

### Task 3: Render storyboard generation units as the primary StoryboardView surface

**Files:**
- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Test: `apps/console/test/storyboardViewRender.test.tsx`

- [ ] **Step 1: Write the failing render test**

Replace the `storyboardData` fixture in `apps/console/test/storyboardViewRender.test.tsx` with:

```ts
const storyboardData = {
  episode_id: "ep_001",
  status: "approved",
  scenes: [
    {
      scene_id: "scn_001",
      shots: [
        {
          source_refs: [0, 1, 2],
          prompt: `PART1\n\n总体描述：压抑内宅。\n\n\`\`\`json\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景手部+银锭特写","beats":["账房摊开银锭"]}]}\n\`\`\``,
        },
      ],
    },
  ],
};

const scriptData = {
  episodes: [
    {
      episode_id: "ep001",
      scenes: [
        {
          scene_id: "scn_001",
          actions: [
            { type: "action", content: "账房摊开银锭。" },
            { type: "dialogue", actor_id: "act_001", content: "这些账，今晚要清。" },
            { type: "action", content: "主角抬眼，屋内安静。" },
          ],
        },
      ],
    },
  ],
  actors: [{ actor_id: "act_001", actor_name: "灵霜" }],
};
```

Replace the `useFileJson` mock with:

```ts
mock.module("../src/hooks/useFile", () => ({
  useFileJson: (_projectName: string, path: string) => ({
    data: path === "output/script.json" ? scriptData : {},
  }),
}));
```

Add assertions to the existing render test:

```ts
expect(html).toContain("来源剧本 0-2");
expect(html).toContain("账房摊开银锭。");
expect(html).toContain("灵霜：这些账，今晚要清。");
expect(html).toContain("分镜提示词");
expect(html).toContain("视频待生成");
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/storyboardViewRender.test.tsx"
```

Expected: FAIL because `来源剧本 0-2`, the resolved script excerpt, and `视频待生成` are not rendered by the current `StoryboardView` primary surface.

- [ ] **Step 3: Import the new builder and type**

In `apps/console/src/components/Viewer/views/StoryboardView.tsx`, extend the storyboard import list:

```ts
import {
  buildClipInspectorData,
  buildStoryboardEditorModel,
  buildStoryboardGenerationUnits,
  parseDraftStoryboardPrompt,
  resolveStoryboardSelectionAtTime,
  summarizeSourceRefs,
  splitStoryboardText,
  type ClipInspectorData,
  type DraftStoryboardPromptSummary,
  type StoryboardClipLike,
  type StoryboardEditorClip,
  type StoryboardEditorShot,
  type StoryboardGenerationUnit,
  type StoryboardSceneLike,
  type StoryboardShotLike,
} from "../../../lib/storyboard";
```

- [ ] **Step 4: Add the primary unit components**

Add these components before `PreviewStage` in `StoryboardView.tsx`:

```tsx
function StoryboardGenerationUnitCard({ unit }: { unit: StoryboardGenerationUnit }) {
  return (
    <article className="grid gap-4 border border-[var(--color-rule)] bg-[var(--color-paper)] p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-[Geist,sans-serif] text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-subtle)]">
            来源剧本 {unit.sourceRefsLabel}
          </div>
          <MetaBadge label="视频" value={unit.videoStatus === "generated" ? "已生成" : "视频待生成"} />
        </div>
        {unit.scriptExcerpt.length === 0 ? (
          <div className="font-serif italic text-[14px] text-[var(--color-ink-faint)]">
            未找到对应剧本段落
          </div>
        ) : (
          <ol className="space-y-2">
            {unit.scriptExcerpt.map((line, index) => (
              <li key={`${unit.key}-script-${index}`} className="grid grid-cols-[24px_1fr] gap-3">
                <span className="pt-0.5 font-mono text-[10px] text-[var(--color-ink-faint)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-serif text-[14px] leading-relaxed text-[var(--color-ink)]">
                  {line}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <div className="font-[Geist,sans-serif] text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink-subtle)]">
            分镜提示词
          </div>
          <div className="mt-1 font-serif text-[15px] leading-relaxed text-[var(--color-ink)]">
            {unit.promptSummary || "（无提示词摘要）"}
          </div>
        </div>
        <div className="space-y-2">
          {unit.shots.map((shot) => (
            <div key={`${unit.key}-${shot.shotId}`} className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--color-ink)]">{shot.shotId}</span>
                {shot.timeRange && (
                  <span className="font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-muted)]">
                    {shot.timeRange}
                  </span>
                )}
              </div>
              {shot.prompt && (
                <div className="mt-1 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                  {shot.prompt}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function StoryboardGenerationUnitList({ units }: { units: StoryboardGenerationUnit[] }) {
  if (units.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-[22px] leading-tight text-[var(--color-ink)]">
            剧本到故事板
          </h2>
          <p className="mt-1 font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
            每组展示一次分镜生成调用：来源剧本、提示词、镜头结果和视频状态。
          </p>
        </div>
        <MetaBadge label="分镜调用" value={`${units.length}`} />
      </div>
      <div className="space-y-3">
        {units.map((unit) => (
          <StoryboardGenerationUnitCard key={unit.key} unit={unit} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Build units in `StoryboardView`**

Inside `StoryboardView`, after `treePaths` and `scenes` are defined, add:

```ts
const generationUnits = useMemo(
  () => buildStoryboardGenerationUnits(path, scenes, scriptData, treePaths),
  [path, scenes, scriptData, treePaths],
);
```

- [ ] **Step 6: Render units before preview/timeline**

In the approved storyboard return branch, place this component above the existing preview/timeline grid:

```tsx
<StoryboardGenerationUnitList units={generationUnits} />
```

Keep the existing preview, clip info, and timeline below it as secondary production inspection tools.

- [ ] **Step 7: Run the render test to verify GREEN**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/storyboardViewRender.test.tsx"
```

Expected: PASS and still includes `S1` and `近景手部+银锭特写`.

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/components/Viewer/views/StoryboardView.tsx apps/console/test/storyboardViewRender.test.tsx
git commit -m "Show script linkage in storyboard view"
```

---

### Task 4: Remove video-first wording from the storyboard primary surface

**Files:**
- Modify: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Test: `apps/console/test/storyboardViewChrome.test.ts`

- [ ] **Step 1: Write the failing chrome test**

Add these assertions to `apps/console/test/storyboardViewChrome.test.ts`:

```ts
expect(source).toContain("剧本到故事板");
expect(source).toContain("来源剧本");
expect(source).toContain("分镜提示词");
expect(source).not.toContain("每组展示一次视频生成结果");
expect(source).not.toContain("故事板视频");
expect(source).not.toContain("当前片段");
```

- [ ] **Step 2: Run the chrome test to verify RED if old wording exists**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/storyboardViewChrome.test.ts"
```

Expected: The positive assertions may fail before Task 3 is complete; after Task 3, only unwanted wording should fail if still present.

- [ ] **Step 3: Adjust StoryboardView wording minimally**

Ensure the primary unit list uses exactly this intro copy:

```tsx
<p className="mt-1 font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
  每组展示一次分镜生成调用：来源剧本、提示词、镜头结果和视频状态。
</p>
```

Keep preview/timeline labels as secondary controls, but avoid using them as the page-level title or first explanatory text.

- [ ] **Step 4: Run the chrome test to verify GREEN**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/storyboardViewChrome.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/Viewer/views/StoryboardView.tsx apps/console/test/storyboardViewChrome.test.ts
git commit -m "Clarify storyboard workspace wording"
```

---

### Task 5: Lock Storyboard and Video navigation boundaries

**Files:**
- Modify: `apps/console/test/navigatorStoryboards.test.tsx`
- Modify: `apps/console/src/components/Navigator/StoryboardNode.tsx`
- Modify: `apps/console/src/components/Navigator/Navigator.tsx`

- [ ] **Step 1: Write the failing boundary test**

Add this test to `apps/console/test/navigatorStoryboards.test.tsx`:

```tsx
test("storyboard navigation opens storyboard json instead of episode video folders", () => {
  const opened: Array<{ path: string; title: string }> = [];
  const element = StoryboardNode({
    status: "completed",
    paths: [
      "output/storyboard/approved/ep001_storyboard.json",
      "output/ep001/ep001_delivery.json",
      "output/ep001/scn001/ep001_scn001_clip001.mp4",
    ],
    unread: new Map(),
    openPath: (path, _view, title) => opened.push({ path, title }),
  });

  const child = (element.props.children as any[])[0];
  child.props.onClick();

  expect(opened).toEqual([
    {
      path: "output/storyboard/approved/ep001_storyboard.json",
      title: "ep001/故事板",
    },
  ]);
});
```

- [ ] **Step 2: Run the test to verify RED or expose current leak**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/navigatorStoryboards.test.tsx"
```

Expected: If `StoryboardNode` already filters through `isStoryboardArtifactPath` upstream only, this direct component test may fail because `StoryboardNode` trusts the caller. The intended boundary is safer if `StoryboardNode` also ignores non-storyboard paths.

- [ ] **Step 3: Filter paths inside `StoryboardNode`**

In `apps/console/src/components/Navigator/StoryboardNode.tsx`, update imports:

```ts
import { isStoryboardArtifactPath, storyboardEpisodeIdFromPath } from "../../lib/productionObject";
```

Change `storyboardEntries` to filter its input:

```ts
function storyboardEntries(paths: string[]) {
  const byEpisode = new Map<string, string>();
  for (const path of paths.filter(isStoryboardArtifactPath)) {
    const episodeId = storyboardEpisodeIdFromPath(path) ?? path;
    const current = byEpisode.get(episodeId);
    if (!current || rankStoryboardPath(path) < rankStoryboardPath(current)) byEpisode.set(episodeId, path);
  }
  return Array.from(byEpisode.entries()).sort(([left], [right]) => left.localeCompare(right));
}
```

No Navigator structural rewrite is needed.

- [ ] **Step 4: Run navigation tests to verify GREEN**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/navigatorStoryboards.test.tsx"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/Navigator/StoryboardNode.tsx apps/console/test/navigatorStoryboards.test.tsx
git commit -m "Keep storyboard navigation scoped to storyboard artifacts"
```

---

### Task 6: Run the focused console verification suite and smoke the UI

**Files:**
- No source changes expected unless verification exposes a regression.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/lib.test.ts" "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/storyboardViewRender.test.tsx" "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/storyboardViewChrome.test.ts" "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/navigatorStoryboards.test.tsx" "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console/test/navigatorSections.test.ts"
```

Expected: PASS for all focused console UI tests.

- [ ] **Step 2: Run production build**

Run:

```bash
bun run --cwd "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console" build
```

Expected: Vite build succeeds with no TypeScript errors.

- [ ] **Step 3: Start the console for browser smoke**

Run:

```bash
bun run --cwd "/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/production-object-decision-scope/apps/console" dev
```

Expected: Vite prints a local URL. If `server.ts` fails with port `3001` already in use, do not kill the existing process unless explicitly approved; use the Vite URL and existing backend if it serves the target project data.

- [ ] **Step 4: Browser smoke the storyboard page**

Open the Vite URL for a project with approved storyboard data, for example the current local project query if available:

```text
http://localhost:<vite-port>/?project=一叶知秋
```

Verify manually:

- The left navigation has separate top-level entries for `故事板` and `分集视频`.
- Opening `故事板 > ep001` shows `剧本到故事板` near the top.
- A storyboard unit shows `来源剧本 0-2` or the relevant source refs label.
- The unit shows script excerpt text before the storyboard prompt summary.
- The unit shows `分镜提示词`, shot IDs such as `S1`, and a video status.
- The page does not show the empty storyboard state when approved `scenes[].shots[].prompt` exists.
- The storyboard primary surface does not look like the same object as the video grid.

- [ ] **Step 5: Commit verification fixes only if needed**

If verification required code fixes, commit the specific files:

```bash
git add apps/console/src apps/console/test
git commit -m "Stabilize storyboard script linkage UI"
```

If no source changes were needed, do not create an empty commit.

---

## Self-Review

### Spec coverage

- Requirement: Keep Script and Storyboard as separate modules while showing their relationship.
  - Covered by Tasks 1 and 3 through `StoryboardGenerationUnit` and `StoryboardGenerationUnitList`.
- Requirement: Storyboard must show which script lines/beats correspond to each storyboard prompt call.
  - Covered by Tasks 1, 2, and 3 using `source_refs`, `scriptExcerpt`, and render assertions.
- Requirement: Storyboard must not be empty just because video is not generated.
  - Covered by Tasks 2 and 3 through `videoStatus: "not_generated"` and render test assertions.
- Requirement: Storyboard and Video must remain distinct Production Objects.
  - Covered by Task 5 navigation boundary tests and by Task 3 UI structure.
- Requirement: Minimal root fix, no broad Navigator rewrite.
  - Covered by File Map and Task 5, which only hardens `StoryboardNode` filtering.

### Placeholder scan

No `TBD`, `TODO`, "implement later", vague "write tests", or "similar to" instructions are present. Every test, command, implementation snippet, and commit step is explicit.

### Type consistency

- `StoryboardGenerationUnit` uses `episodeId`, `sceneId`, `partId`, `sourceRefsLabel`, `scriptExcerpt`, `prompt`, `promptSummary`, `shots`, `videoPath`, and `videoStatus` consistently across tests and React components.
- `StoryboardGenerationUnitShot` uses `shotId`, `timeRange`, `duration`, and `prompt` consistently across builder and rendering.
- The builder signature is consistent across unit tests and `StoryboardView.tsx`:

```ts
buildStoryboardGenerationUnits(storyboardPath, scenes, scriptData, treePaths)
```
