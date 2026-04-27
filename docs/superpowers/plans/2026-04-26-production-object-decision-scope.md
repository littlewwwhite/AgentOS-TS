# Production Object Decision Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the console from file/path/stage-first UI into a director/producer cockpit centered on the active production object and its decision scope.

**Architecture:** Add a pure `ProductionObject` domain layer that translates existing project-relative paths into production objects without changing storage. Wire that model into the Viewer header and Chat rail first, then reorder Overview into a Production Inbox while leaving Navigator structure largely intact.

**Tech Stack:** React 19, TypeScript, Bun test, Vite, existing CSS tokens in `apps/console/src/styles/globals.css`.

---

## File Structure

**Pure domain model:**
- Create: `apps/console/src/lib/productionObject.ts` — maps project-relative paths to production objects, labels, lineage, decision scope, and available actions.
- Test: `apps/console/test/productionObject.test.ts` — verifies path-to-object behavior for project, script, storyboard episode, shot video, asset library, asset item, and generic artifacts.

**Viewer object identity:**
- Create: `apps/console/src/components/Viewer/ObjectHeader.tsx` — shared object header shown above every active view.
- Test: `apps/console/test/objectHeader.test.tsx` — static-render checks for production object label, scope, lineage, preserves, and secondary path.
- Modify: `apps/console/src/components/Viewer/Viewer.tsx` — replace path-first header with `ObjectHeader`.

**Scoped chat:**
- Create: `apps/console/src/components/Chat/ScopeSummary.tsx` — compact scope card at the top of ChatPane.
- Create: `apps/console/src/lib/scopedMessage.ts` — wraps outbound agent prompts with explicit production scope while keeping user-visible message clean.
- Test: `apps/console/test/scopedMessage.test.ts` — verifies scope wrapper content.
- Modify: `apps/console/src/components/Chat/ChatPane.tsx` — accepts `productionObject` and renders `ScopeSummary`.
- Modify: `apps/console/src/hooks/useWebSocket.ts` — `send()` accepts an optional agent-visible message while storing the original message in transcript.
- Modify: `apps/console/src/App.tsx` — derives active production object and passes it to ChatPane and scoped send.
- Test: `apps/console/test/chatPaneChrome.test.tsx` — add static-render coverage for scope summary.

**Production Inbox:**
- Create: `apps/console/src/lib/productionInbox.ts` — combines review, change-request, and stale workbench items into a decision-first inbox.
- Test: `apps/console/test/productionInbox.test.ts` — verifies priority order and labels.
- Modify: `apps/console/src/components/Viewer/views/OverviewView.tsx` — first screen becomes Production Inbox; workflow/status/workspace become secondary.
- Modify: `apps/console/test/overviewViewChrome.test.tsx` — update chrome expectation to decision-first structure.

**Verification:**
- Run: `cd apps/console && bun test test/productionObject.test.ts test/objectHeader.test.tsx test/scopedMessage.test.ts test/chatPaneChrome.test.tsx test/productionInbox.test.ts test/overviewViewChrome.test.tsx`
- Run: `cd apps/console && bunx tsc --noEmit`
- Run: `cd apps/console && bun run build`
- UI smoke: start `bun run dev`, open the console, select a project, open script/storyboard/video/assets, confirm object identity and chat scope update.

---

## Task 1: ProductionObject domain model

**Files:**
- Create: `apps/console/src/lib/productionObject.ts`
- Test: `apps/console/test/productionObject.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/console/test/productionObject.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  getProductionObjectAvailableActions,
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  resolveProductionObjectFromPath,
} from "../src/lib/productionObject";

describe("productionObject", () => {
  test("empty path resolves to project object", () => {
    const object = resolveProductionObjectFromPath("", { projectId: "demo" });
    expect(object).toEqual({ type: "project", projectId: "demo" });
    expect(getProductionObjectLabel(object)).toBe("demo");
    expect(getProductionObjectScope(object).defaultScope).toBe("entire project");
  });

  test("script path resolves to script object", () => {
    const object = resolveProductionObjectFromPath("output/script.json", { projectId: "demo" });
    expect(object).toEqual({ type: "script", path: "output/script.json" });
    expect(getProductionObjectLabel(object)).toBe("Script");
    expect(getProductionObjectLineage(object)).toEqual(["source", "script"]);
    expect(getProductionObjectAvailableActions(object)).toContain("request script revision");
  });

  test("approved storyboard path resolves to episode object", () => {
    const object = resolveProductionObjectFromPath("output/storyboard/approved/ep001_storyboard.json");
    expect(object).toEqual({
      type: "episode",
      episodeId: "ep001",
      artifactRole: "storyboard",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
    expect(getProductionObjectLabel(object)).toBe("ep001 · Storyboard");
    expect(getProductionObjectScope(object).affects).toEqual(["storyboard", "downstream video"]);
  });

  test("shot video path resolves to shot object", () => {
    const object = resolveProductionObjectFromPath("output/ep001/scn002/clip003/v1.mp4");
    expect(object).toEqual({
      type: "shot",
      episodeId: "ep001",
      sceneId: "scn002",
      shotId: "clip003",
      path: "output/ep001/scn002/clip003/v1.mp4",
    });
    expect(getProductionObjectLabel(object)).toBe("ep001 · scn002 · clip003");
    expect(getProductionObjectScope(object)).toMatchObject({
      defaultScope: "current shot",
      preserves: ["script", "storyboard", "registered assets"],
    });
  });

  test("asset library and asset item paths resolve to asset objects", () => {
    const library = resolveProductionObjectFromPath("output/actors");
    expect(library).toEqual({ type: "asset", assetType: "actor", path: "output/actors" });
    expect(getProductionObjectLabel(library)).toBe("Actors");

    const item = resolveProductionObjectFromPath("output/actors/hero/ref.png");
    expect(item).toEqual({ type: "asset", assetType: "actor", assetId: "hero", path: "output/actors/hero/ref.png" });
    expect(getProductionObjectLabel(item)).toBe("Actor · hero");
    expect(getProductionObjectScope(item).affects).toEqual(["visual identity", "downstream storyboard/video consistency"]);
  });

  test("unknown path falls back to artifact object", () => {
    const object = resolveProductionObjectFromPath("draft/design.json");
    expect(object).toEqual({ type: "artifact", path: "draft/design.json" });
    expect(getProductionObjectLabel(object)).toBe("design.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionObject.test.ts
```

Expected: FAIL with module not found for `../src/lib/productionObject`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/console/src/lib/productionObject.ts`:

```typescript
// input: project-relative workspace paths and optional project identity
// output: production object identity, labels, lineage, decision scope, and action hints
// pos: domain translation layer between storage artifacts and director/producer UI

export type AssetType = "actor" | "location" | "prop";
export type EpisodeArtifactRole = "storyboard" | "video" | "editing" | "music" | "subtitle" | "delivery";

export type ProductionObject =
  | { type: "project"; projectId: string | null }
  | { type: "script"; path: string }
  | { type: "episode"; episodeId: string; artifactRole?: EpisodeArtifactRole; path?: string }
  | { type: "scene"; episodeId: string; sceneId: string; path?: string }
  | { type: "shot"; episodeId: string; sceneId?: string; shotId: string; path?: string }
  | { type: "asset"; assetType: AssetType; assetId?: string; path: string }
  | { type: "artifact"; path: string };

export interface DecisionScope {
  defaultScope: string;
  affects: string[];
  preserves: string[];
}

interface ResolveOptions {
  projectId?: string | null;
}

const ASSET_SEGMENT_TO_TYPE: Record<string, AssetType> = {
  actors: "actor",
  locations: "location",
  props: "prop",
};

const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  actor: "Actor",
  location: "Location",
  prop: "Prop",
};

const EPISODE_ROLE_LABEL: Record<EpisodeArtifactRole, string> = {
  storyboard: "Storyboard",
  video: "Video",
  editing: "Editing",
  music: "Music",
  subtitle: "Subtitle",
  delivery: "Delivery",
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function episodeIdFromStoryboard(path: string): string | null {
  const match = path.match(/(?:^|\/)(ep\d+)_storyboard\.json$/);
  return match?.[1] ?? null;
}

function episodeRoleFromPath(path: string): EpisodeArtifactRole | undefined {
  if (path.includes("/storyboard/") || path.endsWith("_storyboard.json") || path.endsWith(".shots.json")) return "storyboard";
  if (path.includes("/edited/") || path.includes("/editing/")) return "editing";
  if (path.includes("/music/") || path.includes("/scored/")) return "music";
  if (path.includes("/subtitle") || path.includes("/final/")) return "subtitle";
  if (path.endsWith("_delivery.json")) return "delivery";
  if (/\.(mp4|webm|mov)$/i.test(path) || /\/raw(?:\/|$)/.test(path)) return "video";
  return undefined;
}

export function resolveProductionObjectFromPath(path: string, options: ResolveOptions = {}): ProductionObject {
  if (!path) return { type: "project", projectId: options.projectId ?? null };
  if (path === "output/script.json") return { type: "script", path };

  const segments = path.split("/").filter(Boolean);
  const assetIndex = segments.findIndex((segment) => segment in ASSET_SEGMENT_TO_TYPE);
  if (assetIndex >= 0) {
    const assetType = ASSET_SEGMENT_TO_TYPE[segments[assetIndex]];
    const assetId = segments[assetIndex + 1];
    return assetId ? { type: "asset", assetType, assetId, path } : { type: "asset", assetType, path };
  }

  const shotMatch = path.match(/(?:^|\/)(ep\d+)\/(scn\d+)\/(clip\d+)\//);
  if (shotMatch) {
    return { type: "shot", episodeId: shotMatch[1], sceneId: shotMatch[2], shotId: shotMatch[3], path };
  }

  const sceneMatch = path.match(/(?:^|\/)(ep\d+)\/(scn\d+)(?:\/|$)/);
  if (sceneMatch) return { type: "scene", episodeId: sceneMatch[1], sceneId: sceneMatch[2], path };

  const storyboardEpisodeId = episodeIdFromStoryboard(path);
  if (storyboardEpisodeId) return { type: "episode", episodeId: storyboardEpisodeId, artifactRole: "storyboard", path };

  const episodeMatch = path.match(/(?:^|\/)(ep\d+)(?:\/|$)/);
  if (episodeMatch) return { type: "episode", episodeId: episodeMatch[1], artifactRole: episodeRoleFromPath(path), path };

  return { type: "artifact", path };
}

export function getProductionObjectLabel(object: ProductionObject): string {
  switch (object.type) {
    case "project": return object.projectId ?? "Project";
    case "script": return "Script";
    case "episode": return object.artifactRole ? `${object.episodeId} · ${EPISODE_ROLE_LABEL[object.artifactRole]}` : object.episodeId;
    case "scene": return `${object.episodeId} · ${object.sceneId}`;
    case "shot": return [object.episodeId, object.sceneId, object.shotId].filter(Boolean).join(" · ");
    case "asset": return object.assetId ? `${ASSET_TYPE_LABEL[object.assetType]} · ${object.assetId}` : `${titleCase(object.assetType)}s`;
    case "artifact": return basename(object.path);
  }
}

export function getProductionObjectLineage(object: ProductionObject): string[] {
  switch (object.type) {
    case "project": return ["project"];
    case "script": return ["source", "script"];
    case "asset": return ["script entities", "visual assets"];
    case "episode": return ["script", object.artifactRole ?? "episode"];
    case "scene": return ["script", "storyboard", "scene"];
    case "shot": return ["script", "storyboard", "video shot"];
    case "artifact": return ["workspace artifact"];
  }
}

export function getProductionObjectScope(object: ProductionObject): DecisionScope {
  switch (object.type) {
    case "project": return {
      defaultScope: "entire project",
      affects: ["pipeline state", "all episodes"],
      preserves: [],
    };
    case "script": return {
      defaultScope: "canonical script",
      affects: ["story structure", "downstream assets/storyboards/videos"],
      preserves: ["source material"],
    };
    case "asset": return {
      defaultScope: object.assetId ? "current asset" : `${object.assetType} library`,
      affects: ["visual identity", "downstream storyboard/video consistency"],
      preserves: ["script text"],
    };
    case "episode": return {
      defaultScope: object.artifactRole ? `current episode ${object.artifactRole}` : "current episode",
      affects: object.artifactRole === "storyboard" ? ["storyboard", "downstream video"] : ["current episode artifact"],
      preserves: ["other episodes", "source material"],
    };
    case "scene": return {
      defaultScope: "current scene",
      affects: ["scene pacing", "scene shots"],
      preserves: ["other scenes", "source material"],
    };
    case "shot": return {
      defaultScope: "current shot",
      affects: ["shot video candidate"],
      preserves: ["script", "storyboard", "registered assets"],
    };
    case "artifact": return {
      defaultScope: "current artifact",
      affects: ["selected file"],
      preserves: ["unrelated artifacts"],
    };
  }
}

export function getProductionObjectAvailableActions(object: ProductionObject): string[] {
  switch (object.type) {
    case "project": return ["continue production", "inspect blockers", "open decision inbox"];
    case "script": return ["approve script", "request script revision", "lock script"];
    case "asset": return ["approve asset", "request visual revision", "compare references"];
    case "episode": return ["approve episode artifact", "request episode revision", "rerun downstream stage"];
    case "scene": return ["approve scene", "request scene revision", "inspect scene shots"];
    case "shot": return ["approve shot", "request shot revision", "regenerate shot variants"];
    case "artifact": return ["inspect artifact", "open raw file"];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionObject.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/productionObject.ts apps/console/test/productionObject.test.ts
git commit -m "feat(console): add production object model"
```

---

## Task 2: ObjectHeader in Viewer

**Files:**
- Create: `apps/console/src/components/Viewer/ObjectHeader.tsx`
- Test: `apps/console/test/objectHeader.test.tsx`
- Modify: `apps/console/src/components/Viewer/Viewer.tsx`

- [ ] **Step 1: Write the failing component test**

Create `apps/console/test/objectHeader.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectHeader } from "../src/components/Viewer/ObjectHeader";


describe("ObjectHeader", () => {
  test("renders object identity before raw path", () => {
    const html = renderToStaticMarkup(
      React.createElement(ObjectHeader, {
        object: {
          type: "shot",
          episodeId: "ep001",
          sceneId: "scn002",
          shotId: "clip003",
          path: "output/ep001/scn002/clip003/v1.mp4",
        },
        viewKind: "video",
      }),
    );

    expect(html).toContain("ep001 · scn002 · clip003");
    expect(html).toContain("默认作用域");
    expect(html).toContain("current shot");
    expect(html).toContain("不会影响");
    expect(html).toContain("script");
    expect(html).toContain("output/ep001/scn002/clip003/v1.mp4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/objectHeader.test.tsx
```

Expected: FAIL with module not found for `ObjectHeader`.

- [ ] **Step 3: Create ObjectHeader**

Create `apps/console/src/components/Viewer/ObjectHeader.tsx`:

```tsx
// input: active production object and resolved view kind
// output: object-first header for the central production workbench
// pos: shared identity and decision scope chrome above Viewer content

import type { ViewKind } from "../../types";
import {
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  type ProductionObject,
} from "../../lib/productionObject";

interface Props {
  object: ProductionObject;
  viewKind: ViewKind;
}

function objectPath(object: ProductionObject): string | null {
  if ("path" in object && object.path) return object.path;
  return null;
}

export function ObjectHeader({ object, viewKind }: Props) {
  const label = getProductionObjectLabel(object);
  const lineage = getProductionObjectLineage(object);
  const scope = getProductionObjectScope(object);
  const path = objectPath(object);

  return (
    <div className="shrink-0 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-3">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="font-serif text-[24px] leading-tight text-[var(--color-ink)] truncate">
            {label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
            <span>{viewKind}</span>
            <span aria-hidden>·</span>
            <span>{lineage.join(" → ")}</span>
          </div>
        </div>
        <div className="shrink-0 text-right font-sans text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
          <div><span className="text-[var(--color-ink-subtle)]">默认作用域</span> {scope.defaultScope}</div>
          {scope.preserves.length > 0 && (
            <div><span className="text-[var(--color-ink-subtle)]">不会影响</span> {scope.preserves.join(" / ")}</div>
          )}
        </div>
      </div>
      {path && (
        <div className="mt-2 truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
          {path}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify ObjectHeader passes**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/objectHeader.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire ObjectHeader into Viewer**

Modify `apps/console/src/components/Viewer/Viewer.tsx`.

Add imports near the existing imports:

```typescript
import { ObjectHeader } from "./ObjectHeader";
import { resolveProductionObjectFromPath } from "../../lib/productionObject";
```

Replace the current path-first header block:

```tsx
      <div className="flex items-center justify-between px-6 py-2 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] shrink-0">
        <span className="font-mono text-[11px] text-[var(--color-ink-muted)] truncate">
          {displayPath}
        </span>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)] shrink-0 ml-4">
          {kindLabel(active.view)}
        </span>
      </div>
```

with:

```tsx
      <ObjectHeader
        object={resolveProductionObjectFromPath(active.path, { projectId: name })}
        viewKind={active.view}
      />
```

Remove the now-unused `displayPath` and `kindLabel` usage if TypeScript reports them as unused. If `kindLabel` is only used by the removed header, delete the `kindLabel` function from `Viewer.tsx`.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionObject.test.ts test/objectHeader.test.tsx && bunx tsc --noEmit
```

Expected: PASS and no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/Viewer/ObjectHeader.tsx apps/console/src/components/Viewer/Viewer.tsx apps/console/test/objectHeader.test.tsx
git commit -m "feat(console): show production object header"
```

---

## Task 3: Scoped ChatPane and outbound scoped messages

**Files:**
- Create: `apps/console/src/components/Chat/ScopeSummary.tsx`
- Create: `apps/console/src/lib/scopedMessage.ts`
- Test: `apps/console/test/scopedMessage.test.ts`
- Modify: `apps/console/src/components/Chat/ChatPane.tsx`
- Modify: `apps/console/src/hooks/useWebSocket.ts`
- Modify: `apps/console/src/App.tsx`
- Test: `apps/console/test/chatPaneChrome.test.tsx`

- [ ] **Step 1: Write scoped message test**

Create `apps/console/test/scopedMessage.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildScopedAgentMessage } from "../src/lib/scopedMessage";


describe("buildScopedAgentMessage", () => {
  test("wraps the user request with explicit production scope", () => {
    const message = buildScopedAgentMessage("重做一下", {
      type: "shot",
      episodeId: "ep001",
      sceneId: "scn002",
      shotId: "clip003",
      path: "output/ep001/scn002/clip003/v1.mp4",
    });

    expect(message).toContain("[Production Scope]");
    expect(message).toContain("Object: ep001 · scn002 · clip003");
    expect(message).toContain("Default scope: current shot");
    expect(message).toContain("Affects: shot video candidate");
    expect(message).toContain("Preserve: script / storyboard / registered assets");
    expect(message).toContain("[User Request]\n重做一下");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/scopedMessage.test.ts
```

Expected: FAIL with module not found for `../src/lib/scopedMessage`.

- [ ] **Step 3: Implement scoped message builder**

Create `apps/console/src/lib/scopedMessage.ts`:

```typescript
// input: user message and active production object
// output: agent-facing message with explicit production scope
// pos: boundary that makes natural-language commands safer without changing chat transcript text

import {
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  type ProductionObject,
} from "./productionObject";

export function buildScopedAgentMessage(message: string, object: ProductionObject): string {
  const scope = getProductionObjectScope(object);
  const lineage = getProductionObjectLineage(object);
  return [
    "[Production Scope]",
    `Object: ${getProductionObjectLabel(object)}`,
    `Default scope: ${scope.defaultScope}`,
    `Affects: ${scope.affects.join(" / ") || "none"}`,
    `Preserve: ${scope.preserves.join(" / ") || "none"}`,
    `Lineage: ${lineage.join(" -> ")}`,
    "",
    "[User Request]",
    message,
  ].join("\n");
}
```

- [ ] **Step 4: Run scoped message test**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/scopedMessage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add scope summary component**

Create `apps/console/src/components/Chat/ScopeSummary.tsx`:

```tsx
// input: active production object
// output: compact scope summary for scoped agent commands
// pos: visible contract between selected workbench object and ChatPane instructions

import {
  getProductionObjectLabel,
  getProductionObjectScope,
  type ProductionObject,
} from "../../lib/productionObject";

interface Props {
  object: ProductionObject;
}

export function ScopeSummary({ object }: Props) {
  const scope = getProductionObjectScope(object);
  return (
    <section className="border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-3">
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
        Current scope
      </div>
      <div className="mt-1 font-serif text-[20px] leading-tight text-[var(--color-ink)]">
        {getProductionObjectLabel(object)}
      </div>
      <div className="mt-2 space-y-1 font-sans text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        <div><span className="text-[var(--color-ink-subtle)]">默认作用域</span> {scope.defaultScope}</div>
        <div><span className="text-[var(--color-ink-subtle)]">会影响</span> {scope.affects.join(" / ") || "—"}</div>
        <div><span className="text-[var(--color-ink-subtle)]">不会影响</span> {scope.preserves.join(" / ") || "—"}</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Update ChatPane test before component wiring**

Append this test to `apps/console/test/chatPaneChrome.test.tsx`:

```tsx
  test("renders active production scope above the transcript", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: false,
        onSend: () => undefined,
        messages: [],
        suggestions: [],
        productionObject: {
          type: "shot",
          episodeId: "ep001",
          sceneId: "scn002",
          shotId: "clip003",
          path: "output/ep001/scn002/clip003/v1.mp4",
        },
      }),
    );

    expect(html).toContain("Current scope");
    expect(html).toContain("ep001 · scn002 · clip003");
    expect(html).toContain("current shot");
  });
```

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/chatPaneChrome.test.tsx
```

Expected: FAIL because `ChatPane` does not accept/render `productionObject` yet.

- [ ] **Step 7: Wire ScopeSummary into ChatPane**

Modify `apps/console/src/components/Chat/ChatPane.tsx`.

Add imports:

```typescript
import type { ProductionObject } from "../../lib/productionObject";
import { ScopeSummary } from "./ScopeSummary";
```

Extend `Props`:

```typescript
interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  onSend: (message: string) => void;
  onStop?: () => void;
  suggestions: string[];
  slashCommands?: string[];
  productionObject?: ProductionObject;
}
```

Change the function signature to destructure the new prop:

```typescript
export function ChatPane({
  messages,
  isStreaming,
  isConnected,
  onSend,
  onStop,
  suggestions,
  slashCommands = [],
  productionObject,
}: Props) {
```

Render the summary immediately inside the root container before the transcript scroller:

```tsx
    <div className="flex flex-col h-full bg-[var(--color-paper)]">
      {productionObject && <ScopeSummary object={productionObject} />}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-3">
```

- [ ] **Step 8: Run ChatPane chrome test**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/chatPaneChrome.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Allow clean transcript text with scoped outbound agent text**

Modify `apps/console/src/hooks/useWebSocket.ts`.

Add this interface near the top after `extractPath`:

```typescript
interface SendOptions {
  agentMessage?: string;
}
```

Replace the `send` callback signature and websocket send line:

```typescript
  const send = useCallback(
    (message: string, project?: string, sessionId?: string, options: SendOptions = {}) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setIsStreaming(true);
      setMessages((prev) => [...prev, userMsg]);
      wsRef.current.send(JSON.stringify({ message: options.agentMessage ?? message, project, sessionId }));
    },
    []
  );
```

- [ ] **Step 10: Derive active production object and scoped send in App**

Modify `apps/console/src/App.tsx`.

Add imports:

```typescript
import { buildScopedAgentMessage } from "./lib/scopedMessage";
import { resolveProductionObjectFromPath } from "./lib/productionObject";
```

After `const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;`, add:

```typescript
  const activeProductionObject = useMemo(
    () => resolveProductionObjectFromPath(activeTab?.path ?? "", { projectId: name }),
    [activeTab?.path, name],
  );
```

Replace `handleSend`:

```typescript
  function handleSend(message: string) {
    send(message, name ?? undefined, sessionId ?? undefined, {
      agentMessage: buildScopedAgentMessage(message, activeProductionObject),
    });
  }
```

Pass the object to `ChatPane`:

```tsx
          <ChatPane
            messages={messages}
            isStreaming={isStreaming}
            isConnected={isConnected}
            onSend={handleSend}
            onStop={stop}
            suggestions={suggestions}
            slashCommands={slashCommands}
            productionObject={activeProductionObject}
          />
```

- [ ] **Step 11: Run focused tests and typecheck**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/scopedMessage.test.ts test/chatPaneChrome.test.tsx && bunx tsc --noEmit
```

Expected: PASS and no TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add apps/console/src/components/Chat/ScopeSummary.tsx apps/console/src/components/Chat/ChatPane.tsx apps/console/src/lib/scopedMessage.ts apps/console/src/hooks/useWebSocket.ts apps/console/src/App.tsx apps/console/test/scopedMessage.test.ts apps/console/test/chatPaneChrome.test.tsx
git commit -m "feat(console): scope chat commands to active production object"
```

---

## Task 4: Production Inbox pure model

**Files:**
- Create: `apps/console/src/lib/productionInbox.ts`
- Test: `apps/console/test/productionInbox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/console/test/productionInbox.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildProductionInbox } from "../src/lib/productionInbox";
import type { PipelineState } from "../src/types";

function state(): PipelineState {
  return {
    version: 1,
    updated_at: "2026-04-26T00:00:00Z",
    current_stage: "VIDEO",
    next_action: "review VIDEO",
    last_error: null,
    stages: {
      SCRIPT: { status: "approved", artifacts: ["output/script.json"] },
      VISUAL: { status: "approved", artifacts: ["output/actors/actors.json"] },
      STORYBOARD: { status: "stale", artifacts: ["output/storyboard/approved/ep001_storyboard.json"] },
      VIDEO: { status: "in_review", artifacts: ["output/ep001/ep001_delivery.json"] },
      EDITING: { status: "not_started", artifacts: [] },
      MUSIC: { status: "not_started", artifacts: [] },
      SUBTITLE: { status: "not_started", artifacts: [] },
    },
    episodes: {},
    artifacts: {
      "output/script.json": {
        kind: "canonical",
        owner_role: "writer",
        status: "approved",
        editable: true,
        revision: 1,
        depends_on: [],
        invalidates: [],
      },
      "output/storyboard/approved/ep001_storyboard.json": {
        kind: "canonical",
        owner_role: "director",
        status: "change_requested",
        editable: true,
        revision: 2,
        depends_on: ["output/script.json"],
        invalidates: ["output/ep001/ep001_delivery.json"],
      },
    },
    change_requests: [
      {
        id: "cr_001",
        target_artifact: "output/storyboard/approved/ep001_storyboard.json",
        requested_by_role: "producer",
        reason: "镜头节奏过慢",
        created_at: "2026-04-26T00:01:00Z",
        status: "open",
      },
    ],
  };
}

describe("buildProductionInbox", () => {
  test("places decision and blocker items before passive status", () => {
    const inbox = buildProductionInbox(state());

    expect(inbox.primaryItems).toHaveLength(2);
    expect(inbox.primaryItems[0]).toMatchObject({
      priority: "blocked",
      title: "返修 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
    expect(inbox.primaryItems[1]).toMatchObject({
      priority: "blocked",
      title: "重新生成 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
    expect(inbox.summary).toEqual({ decisions: 0, blocked: 2, total: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionInbox.test.ts
```

Expected: FAIL with module not found for `../src/lib/productionInbox`.

- [ ] **Step 3: Implement Production Inbox model**

Create `apps/console/src/lib/productionInbox.ts`:

```typescript
// input: pipeline state workbench queues
// output: decision-first production inbox for director/producer homepage
// pos: converts workflow state into actionable production priorities

import type { PipelineState } from "../types";
import { buildOverviewWorkbench, type WorkbenchItem } from "./overviewWorkbench";

export type ProductionInboxPriority = "decision" | "blocked";

export interface ProductionInboxItem extends WorkbenchItem {
  priority: ProductionInboxPriority;
  cta: string;
}

export interface ProductionInbox {
  primaryItems: ProductionInboxItem[];
  summary: {
    decisions: number;
    blocked: number;
    total: number;
  };
}

function toInboxItem(item: WorkbenchItem): ProductionInboxItem {
  if (item.kind === "review") {
    return { ...item, priority: "decision", cta: "去拍板" };
  }
  if (item.kind === "change_request") {
    return { ...item, priority: "blocked", cta: "去返修" };
  }
  return { ...item, priority: "blocked", cta: "重新生成" };
}

function priorityRank(priority: ProductionInboxPriority): number {
  return priority === "blocked" ? 0 : 1;
}

export function buildProductionInbox(state: PipelineState): ProductionInbox {
  const workbench = buildOverviewWorkbench(state);
  const primaryItems = [
    ...workbench.changeRequestItems,
    ...workbench.staleItems,
    ...workbench.reviewItems,
  ].map(toInboxItem)
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));

  const decisions = primaryItems.filter((item) => item.priority === "decision").length;
  const blocked = primaryItems.filter((item) => item.priority === "blocked").length;
  return {
    primaryItems,
    summary: {
      decisions,
      blocked,
      total: primaryItems.length,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionInbox.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/lib/productionInbox.ts apps/console/test/productionInbox.test.ts
git commit -m "feat(console): derive production inbox priorities"
```

---

## Task 5: Reorder Overview into Production Inbox

**Files:**
- Modify: `apps/console/src/components/Viewer/views/OverviewView.tsx`
- Modify: `apps/console/test/overviewViewChrome.test.tsx`

- [ ] **Step 1: Update Overview chrome test**

Replace `apps/console/test/overviewViewChrome.test.tsx` with:

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionInboxPanel, WorkflowProgressStrip } from "../src/components/Viewer/views/OverviewView";

describe("OverviewView chrome", () => {
  test("renders current MVP workflow strip without post-production stages", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowProgressStrip, {
        items: [
          { key: "SCRIPT", label: "剧本", state: "current" },
          { key: "VISUAL", label: "素材", state: "idle" },
          { key: "STORYBOARD", label: "分镜", state: "idle" },
          { key: "VIDEO", label: "视频", state: "idle" },
        ],
      }),
    );

    expect(html).not.toContain("输入");
    expect(html).toContain("剧本");
    expect(html).toContain("分镜");
    expect(html).toContain("视频");
    expect(html).not.toContain("剪辑");
  });

  test("renders production inbox before passive workflow status", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionInboxPanel, {
        items: [
          {
            key: "cr_001",
            kind: "change_request",
            priority: "blocked",
            cta: "去返修",
            stage: "STORYBOARD",
            title: "返修 STORYBOARD",
            reason: "镜头节奏过慢",
            path: "output/storyboard/approved/ep001_storyboard.json",
            status: "change_requested",
          },
        ],
        onOpen: () => undefined,
      }),
    );

    expect(html).toContain("Production Inbox");
    expect(html).toContain("返修 STORYBOARD");
    expect(html).toContain("镜头节奏过慢");
    expect(html).toContain("去返修");
  });
});
```

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/overviewViewChrome.test.tsx
```

Expected: FAIL because `ProductionInboxPanel` is not exported yet.

- [ ] **Step 2: Add ProductionInboxPanel to OverviewView**

Modify `apps/console/src/components/Viewer/views/OverviewView.tsx`.

Add import:

```typescript
import { buildProductionInbox, type ProductionInboxItem } from "../../../lib/productionInbox";
```

Add this exported component above `OverviewView`:

```tsx
export function ProductionInboxPanel({
  items,
  onOpen,
}: {
  items: ProductionInboxItem[];
  onOpen: (item: ProductionInboxItem) => void;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="font-serif text-[36px] leading-tight text-[var(--color-ink)]">Production Inbox</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            先处理会阻塞交付或需要拍板的制作对象。
          </p>
        </div>
        <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-[0.08em]">
          {items.length} items
        </div>
      </div>
      <div className="mt-6 space-y-3">
        {items.length === 0 ? (
          <div className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4 text-[13px] text-[var(--color-ink-muted)]">
            当前没有需要导演/制片处理的事项。
          </div>
        ) : items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onOpen(item)}
            className="block w-full border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4 text-left transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
                {item.priority} · {item.stage}
              </div>
              <div className="font-sans text-[11px] font-semibold text-[var(--color-accent)]">
                {item.cta}
              </div>
            </div>
            <div className="mt-2 font-serif text-[24px] leading-tight text-[var(--color-ink)]">
              {item.title}
            </div>
            <div className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              {item.reason}
            </div>
            {item.path && (
              <div className="mt-3 truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                {item.path}
              </div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
```

Inside `OverviewView`, after `const workbench = buildOverviewWorkbench(state);`, add:

```typescript
  const inbox = buildProductionInbox(state);
```

- [ ] **Step 3: Reorder OverviewView return tree**

In `apps/console/src/components/Viewer/views/OverviewView.tsx`, change the order inside the top-level `<div className="px-10 py-10 max-w-[72ch] space-y-16">` so the first sections are:

```tsx
      <section>
        <h1 className="font-serif text-[44px] leading-tight text-[var(--color-ink)]">{name}</h1>
        <div className="mt-3 font-mono text-[11px] text-[var(--color-ink-subtle)] tracking-[0.04em] space-x-4">
          <span>阶段 {state.current_stage ?? "—"}</span>
          <span>·</span>
          <span>下一步 {state.next_action ?? "—"}</span>
        </div>
        {state.last_error && (
          <div className="mt-4 font-mono text-[12px] text-[var(--color-err)]">
            最近错误：{state.last_error}
          </div>
        )}
      </section>

      <ProductionInboxPanel
        items={inbox.primaryItems}
        onOpen={(item) => item.path && openWorkbenchPath(item.path, item.title)}
      />

      <section className="grid grid-cols-3 gap-10 border-y border-[var(--color-rule)] py-8">
        <Stat label="需拍板" value={inbox.summary.decisions} />
        <Stat label="阻塞项" value={inbox.summary.blocked} />
        <Stat label="总事项" value={inbox.summary.total} />
      </section>

      <WorkflowStatusCard
        status={workflowStatus}
        decision={resumeDecision}
        targetPath={resumeTargetPath}
        onOpenTarget={resumeTargetPath ? () => openWorkbenchPath(resumeTargetPath, decisionTitle(resumeDecision, resumeTargetPath)) : undefined}
      />

      <WorkflowProgressStrip items={workflowProgress} />
```

Keep the existing `WorkbenchSection` blocks after this area for detailed queues. Keep `WorkspaceCard` below the queue sections so workspace/debug information is secondary.

- [ ] **Step 4: Run overview tests**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionInbox.test.ts test/overviewViewChrome.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bunx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/Viewer/views/OverviewView.tsx apps/console/test/overviewViewChrome.test.tsx
git commit -m "feat(console): make overview decision-first"
```

---

## Task 6: Full verification and UI smoke

**Files:**
- No source files expected.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/productionObject.test.ts test/objectHeader.test.tsx test/scopedMessage.test.ts test/chatPaneChrome.test.tsx test/productionInbox.test.ts test/overviewViewChrome.test.tsx
```

Expected: PASS for all listed tests.

- [ ] **Step 2: Run broader regression tests for touched areas**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun test test/resolveView.test.ts test/overviewWorkbench.test.ts test/chatSuggestions.test.ts test/workflowStatus.test.ts test/workflowProgress.test.ts test/panelLayout.test.ts
```

Expected: PASS for all listed tests.

- [ ] **Step 3: Typecheck**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bunx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Build**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun run build
```

Expected: Vite build completes successfully and writes `dist/`.

- [ ] **Step 5: Start dev server for UI smoke**

Run:

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console && bun run dev
```

Expected: server starts with the Bun API server and Vite dev server. Keep it running for the browser checks.

- [ ] **Step 6: Browser smoke checks**

Open the Vite URL printed by the dev server and verify:

1. Select an existing project.
2. Overview first screen shows `Production Inbox` before workspace/debug information.
3. Open `output/script.json`; Viewer header title is `Script`, not the raw path.
4. Open `output/storyboard/approved/ep001_storyboard.json`; Viewer header title is `ep001 · Storyboard`.
5. Open a clip path such as `output/ep001/scn001/clip001/v1.mp4` if present; Viewer header title includes episode, scene, and clip.
6. Chat rail top shows `Current scope` and updates when active tab changes.
7. Sending a chat message leaves the visible transcript as the original user text, while the agent receives the scoped wrapper through `useWebSocket.send()`.

- [ ] **Step 7: Commit verification-only fixes if needed**

If verification exposes small compile or UI wiring mistakes introduced by this branch, fix them and commit only the touched files:

```bash
git add apps/console/src apps/console/test
git commit -m "fix(console): stabilize production object cockpit wiring"
```

If no fixes are needed, do not create an empty commit.

---

## Self-Review

**Spec coverage:**
- ProductionObject type and path-to-object mapping: Task 1.
- ObjectHeader replacing path-first header: Task 2.
- Chat scope summary and scoped outbound agent prompt: Task 3.
- Overview as Production Inbox: Tasks 4 and 5.
- Avoid large Navigator rewrite: no task rewrites `Navigator.tsx`.
- Phased, executable, verifiable plan: Tasks 1-6 with tests, typecheck, build, and UI smoke.

**Placeholder scan:**
- No `TBD`, placeholder code, unnamed files, or unspecified tests are used.
- Each code step names exact paths and includes concrete code blocks.

**Type consistency:**
- `ProductionObject`, `DecisionScope`, and `ProductionInboxItem` names are defined before use.
- `buildScopedAgentMessage()` is used consistently in tests and `App.tsx`.
- `productionObject?: ProductionObject` is passed consistently from `App.tsx` to `ChatPane` to `ScopeSummary`.
