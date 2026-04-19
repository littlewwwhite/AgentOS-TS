# Console Taste Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin `apps/console/` to the Editorial Workbench aesthetic — warm paper + ink + single朱砂 accent + Fraunces/Geist/JetBrains-Mono type system — without touching any structural logic.

**Architecture:** Pure visual rewrite: tokens first (`globals.css` `@theme`), fonts second (Fontsource self-host), then one component per commit. Every component keeps its existing props, handlers, context consumers, and JSX tree; only `className` strings and static JSX (status dots, arrows, empty-state copy) change. TypeScript type-check is the only gate between tasks.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind v4, Vite 6, Bun 1.2. Fonts via `@fontsource-variable/*` packages.

**Reference spec:** `docs/superpowers/specs/2026-04-20-console-taste-redesign-design.md`

**Invariants (DO NOT touch):**
- `apps/console/server.ts`, `apps/console/src/orchestrator.ts`, `apps/console/src/types.ts`, `apps/console/src/contexts/*`, `apps/console/src/hooks/*`, `apps/console/src/lib/*`, `apps/console/src/serverUtils.ts` — zero changes.
- Every component's props, event handlers, context usage, and JSX structural tree.
- All Phase C session-resume behavior.

**Testing approach:** The codebase has no automated UI tests. Use `bunx tsc --noEmit` as the mechanical gate between every task; defer full visual verification to the manual pass in Task 14 (follows the spec's §10 Test plan).

---

## File Map

| File | Role | Task |
|---|---|---|
| `apps/console/package.json` | Add Fontsource deps | 1 |
| `apps/console/src/styles/globals.css` | Replace `@theme` tokens + base styles | 1 |
| `apps/console/src/main.tsx` | Import font packages | 1 |
| `apps/console/index.html` | `color-scheme: light` meta | 1 |
| `apps/console/src/App.tsx` | Rewrite header + 3-zone layout classes | 2 |
| `apps/console/src/components/Navigator/StatusBadge.tsx` | Redesign to `[■] LABEL [•]` | 3 |
| `apps/console/src/components/Navigator/StageNode.tsx` | Typographic hierarchy + `+/−` disclosure | 4 |
| `apps/console/src/components/Navigator/EpisodeNode.tsx` | Match new sub-level spec | 4 |
| `apps/console/src/components/Navigator/ProjectSwitcher.tsx` | Mono-count caret row | 5 |
| `apps/console/src/components/Navigator/Navigator.tsx` | Remove old hover classes, adjust padding | 5 |
| `apps/console/src/components/Viewer/TabBar.tsx` | Printer's masthead (2px accent underline) | 6 |
| `apps/console/src/components/Viewer/Viewer.tsx` | Empty state copy + path strip | 7 |
| `apps/console/src/components/Viewer/views/FallbackView.tsx` | Editorial empty composition | 7 |
| `apps/console/src/components/Viewer/views/{JsonView,TextView,ImageView,VideoView}.tsx` | Token-based restyle | 8 |
| `apps/console/src/components/Viewer/views/{AssetGalleryView,VideoGridView}.tsx` | Frame + mono caption | 9 |
| `apps/console/src/components/Viewer/views/{ScriptView,StoryboardView}.tsx` | Fraunces italic stage directions | 10 |
| `apps/console/src/components/Viewer/views/OverviewView.tsx` | Vertical stage stack + Display L headings | 11 |
| `apps/console/src/components/Chat/ChatPane.tsx` | Editor's inbox layout | 12 |
| `apps/console/src/components/Chat/MessageBubble.tsx` | No bubbles; right/left text alignment | 12 |
| `apps/console/src/components/Chat/ToolCard.tsx` | Inline `→` arrow, collapsed output | 12 |
| `apps/console/src/styles/globals.css` | Scrollbar, selection, focus-visible polish | 13 |

14 tasks total. Tasks 1→7 unlock the shell and reveal the new look end-to-end; 8→12 finish each pane; 13 polishes edges; 14 verifies.

---

## Task 1: Design tokens + font loading

**Files:**
- Modify: `apps/console/package.json` (add 3 deps)
- Replace: `apps/console/src/styles/globals.css`
- Modify: `apps/console/src/main.tsx:1-4` (add 3 imports)
- Modify: `apps/console/index.html:2` (add `class="light"`)

- [ ] **Step 1: Install Fontsource packages**

Run from repo root:
```bash
cd apps/console && bun add @fontsource-variable/fraunces @fontsource-variable/geist @fontsource-variable/jetbrains-mono
```
Expected: `bun.lockb` updates; three new entries appear in `package.json` under `dependencies`; no errors.

- [ ] **Step 2: Replace `src/styles/globals.css`**

Overwrite the entire file with:

```css
@import "tailwindcss";

@theme {
  /* Base — warm neutrals, tinted toward brand hue 85 */
  --color-paper:       oklch(97% 0.008 85);
  --color-paper-soft:  oklch(94% 0.010 85);
  --color-paper-sunk:  oklch(92% 0.012 85);
  --color-rule:        oklch(88% 0.010 85);
  --color-rule-strong: oklch(80% 0.012 85);

  /* Ink scale */
  --color-ink:         oklch(22% 0.012 85);
  --color-ink-muted:   oklch(48% 0.010 85);
  --color-ink-subtle:  oklch(65% 0.008 85);
  --color-ink-faint:   oklch(78% 0.008 85);

  /* Accents */
  --color-accent:      oklch(48% 0.17 32);
  --color-accent-soft: oklch(94% 0.04 32);

  /* Functional status */
  --color-run:   oklch(58% 0.14 220);
  --color-ok:    oklch(52% 0.11 145);
  --color-warn:  oklch(66% 0.13 75);
  --color-err:   oklch(52% 0.18 25);

  /* Type */
  --font-serif: "Fraunces Variable", "EB Garamond", Georgia, serif;
  --font-sans:  "Geist Variable", "Inter", system-ui, sans-serif;
  --font-mono:  "JetBrains Mono Variable", ui-monospace, monospace;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  color-scheme: light;
}

body {
  margin: 0;
  background-color: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

::selection {
  background: var(--color-accent-soft);
  color: var(--color-ink);
}
```

- [ ] **Step 3: Import fonts in `main.tsx`**

Replace `apps/console/src/main.tsx:1-4` with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "./styles/globals.css";
import { App } from "./App";
```

- [ ] **Step 4: Set `color-scheme: light` in HTML**

Replace `apps/console/index.html:2` with:

```html
<html lang="en" class="light" style="color-scheme: light">
```

- [ ] **Step 5: Type-check + build**

Run: `cd apps/console && bunx tsc --noEmit && bun run build`
Expected: Both green. Vite output shows `@fontsource-variable/*` chunks added.

- [ ] **Step 6: Commit**

```bash
git add apps/console/package.json apps/console/bun.lockb apps/console/src/styles/globals.css apps/console/src/main.tsx apps/console/index.html
git commit -m "feat(console): install fontsource fonts and warm-paper design tokens"
```

Note: bun may produce `bun.lock` instead of `bun.lockb` depending on version — add whichever is modified.

---

## Task 2: Header + 3-zone shell (`App.tsx`)

**Files:**
- Modify: `apps/console/src/App.tsx:12-58`

- [ ] **Step 1: Replace the `Shell` component**

Replace `apps/console/src/App.tsx:12-48` (the whole `Shell` function, keeping the exports intact) with:

```tsx
function Shell() {
  const { name, setName, noteToolPath, refresh, sessionId, setSessionId } = useProject();
  const { messages, isConnected, isStreaming, send } = useWebSocket(
    WS_URL,
    noteToolPath,
    refresh,
    setSessionId,
  );

  function handleSend(message: string) {
    send(message, name ?? undefined, sessionId ?? undefined);
  }

  const statusLabel = !isConnected ? "OFFLINE" : isStreaming ? "STREAMING" : "CONNECTED";
  const statusColor = !isConnected
    ? "var(--color-ink-faint)"
    : isStreaming
      ? "var(--color-run)"
      : "var(--color-ok)";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-paper)]">
      <header className="shrink-0 flex items-baseline gap-6 px-8 py-5 border-b border-[var(--color-rule-strong)]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink)]">
          AgentOS
        </span>
        <span className="font-serif text-[28px] leading-none text-[var(--color-ink)]">
          {name ?? (
            <span className="italic text-[var(--color-ink-faint)]">— select project</span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ProjectSwitcher selected={name} onSelect={setName} />
          <span
            className="w-[6px] h-[6px]"
            style={{ backgroundColor: statusColor }}
            aria-hidden
          />
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
            {statusLabel}
          </span>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[260px] shrink-0 border-r border-[var(--color-rule)] flex flex-col overflow-hidden">
          <Navigator />
        </div>
        <div className="flex-1 overflow-hidden">
          <Viewer />
        </div>
        <div className="w-[380px] shrink-0 border-l border-[var(--color-rule)] flex flex-col overflow-hidden">
          <ChatPane messages={messages} isStreaming={isStreaming} isConnected={isConnected} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
```

Leave the `App` export at the bottom unchanged.

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/App.tsx
git commit -m "feat(console): rewrite Shell header with serif project name and mono status cluster"
```

---

## Task 3: StatusBadge → `[■] LABEL [•]`

**Files:**
- Replace: `apps/console/src/components/Navigator/StatusBadge.tsx`

- [ ] **Step 1: Overwrite the file**

Replace the entire file with:

```tsx
import type { StageStatus } from "../../types";

interface Props { status?: StageStatus | null; unread?: number; }

interface StatusSpec { color: string; label: string }

const MAP: Record<StageStatus, StatusSpec | null> = {
  running:     { color: "var(--color-run)",       label: "RUN" },
  partial:     { color: "var(--color-warn)",      label: "PART" },
  completed:   { color: "var(--color-ok)",        label: "OK" },
  validated:   { color: "var(--color-ok)",        label: "✓" },
  failed:      { color: "var(--color-err)",       label: "FAIL" },
  not_started: { color: "var(--color-ink-faint)", label: "—" },
};

export function StatusBadge({ status, unread }: Props) {
  const spec = status ? MAP[status] : null;
  const showUnread = !!(unread && unread > 0);
  if (!spec && !showUnread) return null;
  return (
    <span className="ml-auto flex items-center gap-1.5">
      {spec && (
        <>
          <span
            className="w-[6px] h-[6px] shrink-0"
            style={{ backgroundColor: spec.color }}
            aria-hidden
          />
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
            {spec.label}
          </span>
        </>
      )}
      {showUnread && (
        <span
          className="w-[6px] h-[6px] rounded-full ml-1"
          style={{ backgroundColor: "var(--color-accent)" }}
          aria-label={`${unread} unread`}
        />
      )}
    </span>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/Navigator/StatusBadge.tsx
git commit -m "feat(console): restyle StatusBadge as [■] label + [•] unread dot"
```

---

## Task 4: StageNode + EpisodeNode (new hierarchy)

**Files:**
- Replace: `apps/console/src/components/Navigator/StageNode.tsx`
- Replace: `apps/console/src/components/Navigator/EpisodeNode.tsx`

- [ ] **Step 1: Overwrite StageNode.tsx**

Replace the entire file with:

```tsx
import { useState, type ReactNode } from "react";
import type { StageStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  label: string;
  status?: StageStatus;
  unread?: number;
  expandable?: boolean;
  defaultOpen?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

export function StageNode({ label, status, unread, expandable, defaultOpen = false, onClick, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const hasRowAction = !!onClick;
  function handleRowClick() {
    if (hasRowAction) onClick?.();
    else if (expandable) setOpen(!open);
  }
  return (
    <div>
      <div
        className="group flex items-center gap-2 px-4 py-2 text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={handleRowClick}
      >
        <span>{label}</span>
        <StatusBadge status={status} unread={unread} />
        {expandable && (
          <span
            className="font-mono text-[10px] text-[var(--color-ink-faint)] select-none w-3 text-right"
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            aria-hidden
          >{open ? "−" : "+"}</span>
        )}
      </div>
      {expandable && open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">{children}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Overwrite EpisodeNode.tsx**

Replace the entire file with:

```tsx
import { useState } from "react";
import type { EpisodeState, StageStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
  markSeen?: (path: string) => void;
}

const SUBS: Array<{ label: string; path: (epId: string) => string }> = [
  { label: "Storyboard", path: (id) => `output/${id}/${id}_storyboard.json` },
  { label: "Raw", path: (id) => `output/${id}` },
  { label: "Edited", path: (id) => `output/${id}/edited` },
  { label: "Scored", path: (id) => `output/${id}/scored` },
  { label: "Final", path: (id) => `output/${id}/final` },
];

const STATUS_PRIORITY: StageStatus[] = [
  "failed",
  "running",
  "partial",
  "not_started",
  "completed",
  "validated",
];

function rollupStatus(ep: EpisodeState | undefined): StageStatus {
  if (!ep) return "not_started";
  const present = [ep.storyboard, ep.video, ep.editing, ep.music, ep.subtitle]
    .map((s) => s?.status)
    .filter((s): s is StageStatus => !!s);
  if (present.length === 0) return "not_started";
  return STATUS_PRIORITY.find((p) => present.includes(p)) ?? "not_started";
}

export function EpisodeNode({ epId, ep, unread, markSeen }: Props) {
  const [open, setOpen] = useState(false);
  const { openPath } = useTabs();
  const worstStatus = rollupStatus(ep);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={() => {
          if (!open) markSeen?.(`output/${epId}`);
          setOpen(!open);
        }}
      >
        <span>{epId}</span>
        <StatusBadge status={worstStatus} unread={unread.get(`output/${epId}`)} />
        <span className="font-mono text-[10px] text-[var(--color-ink-faint)] w-3 text-right" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </div>
      {open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">
          {SUBS.map((sub) => {
            const p = sub.path(epId);
            return (
              <div
                key={sub.label}
                onClick={() => { openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: true }); markSeen?.(p); }}
                className="pl-4 pr-4 py-1 text-[12px] text-[var(--color-ink-subtle)] hover:bg-[var(--color-paper-soft)] cursor-pointer flex items-center gap-2 transition-colors"
              >
                <span>{sub.label}</span>
                <StatusBadge unread={unread.get(p)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Navigator/StageNode.tsx apps/console/src/components/Navigator/EpisodeNode.tsx
git commit -m "feat(console): redesign Stage+Episode nodes with typographic hierarchy and +/− disclosure"
```

---

## Task 5: ProjectSwitcher + Navigator shell

**Files:**
- Replace: `apps/console/src/components/Navigator/ProjectSwitcher.tsx`
- Modify: `apps/console/src/components/Navigator/Navigator.tsx:22-23, 36-37`

- [ ] **Step 1: Overwrite ProjectSwitcher.tsx**

Replace the entire file with:

```tsx
import { useEffect, useState } from "react";
import type { Project } from "../../types";

interface Props {
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function ProjectSwitcher({ selected, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => { if (alive) setProjects(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, []);
  return (
    <label className="flex items-baseline gap-2 cursor-pointer">
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        className="bg-transparent border-0 border-b border-[var(--color-rule-strong)] rounded-none px-1 py-0.5 text-[12px] text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
      >
        <option value="">— project —</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <span className="font-mono text-[10px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
        {projects.length} {projects.length === 1 ? "project" : "projects"}
      </span>
    </label>
  );
}
```

- [ ] **Step 2: Update Navigator.tsx empty-state + container padding**

Replace `apps/console/src/components/Navigator/Navigator.tsx:22-23` with:

```tsx
  if (!name) {
    return <div className="p-6 font-serif italic text-[13px] text-[var(--color-ink-faint)]">Select a project to begin.</div>;
  }
```

Replace `apps/console/src/components/Navigator/Navigator.tsx:36-37` with:

```tsx
  return (
    <div className="py-4 overflow-y-auto h-full">
```

Replace the inline `<div>` children inside the "Assets" StageNode (`Actors`, `Locations`, `Props` rows) — these still use old color tokens. Find `apps/console/src/components/Navigator/Navigator.tsx` lines 64-82 (three blocks matching `<div ... className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer" onClick={...}>LABEL</div>`) and replace each with the equivalent block using new tokens:

For Actors:
```tsx
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/actors", "Actors"); markSeen("output/actors"); }}
            >Actors</div>
```

For Locations (same structure, different path/label):
```tsx
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/locations", "Locations"); markSeen("output/locations"); }}
            >Locations</div>
```

For Props:
```tsx
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/props", "Props"); markSeen("output/props"); }}
            >Props</div>
```

- [ ] **Step 3: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Navigator/ProjectSwitcher.tsx apps/console/src/components/Navigator/Navigator.tsx
git commit -m "feat(console): restyle ProjectSwitcher underline + Navigator empty state + asset sub-rows"
```

---

## Task 6: TabBar (printer's masthead)

**Files:**
- Replace: `apps/console/src/components/Viewer/TabBar.tsx`

- [ ] **Step 1: Overwrite TabBar.tsx**

Replace the entire file with:

```tsx
import { useTabs } from "../../contexts/TabsContext";

export function TabBar() {
  const { tabs, activeId, activate, closeTab } = useTabs();
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-stretch border-b border-[var(--color-rule)] overflow-x-auto shrink-0 bg-[var(--color-paper)]">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => activate(t.id)}
            className="group flex items-center gap-2 px-4 h-9 cursor-pointer whitespace-nowrap relative"
          >
            <span
              className={
                "text-[12px] " +
                (active
                  ? "font-serif italic text-[13px] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-muted)] group-hover:text-[var(--color-ink)] " +
                    (t.pinned ? "" : "italic"))
              }
            >
              {t.title}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              className="font-mono text-[10px] text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-ink)] transition-opacity"
              aria-label="Close"
            >×</button>
            {active && (
              <span
                className="absolute left-4 right-4 bottom-0 h-[2px]"
                style={{ backgroundColor: "var(--color-accent)" }}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/Viewer/TabBar.tsx
git commit -m "feat(console): restyle TabBar as printer's masthead with italic active + accent underline"
```

---

## Task 7: Viewer shell + FallbackView

**Files:**
- Replace: `apps/console/src/components/Viewer/Viewer.tsx`
- Replace: `apps/console/src/components/Viewer/views/FallbackView.tsx`

- [ ] **Step 1: Overwrite Viewer.tsx**

Replace the entire file with:

```tsx
import { useTabs } from "../../contexts/TabsContext";
import { useProject } from "../../contexts/ProjectContext";
import { TabBar } from "./TabBar";
import { FallbackView } from "./views/FallbackView";
import { JsonView } from "./views/JsonView";
import { TextView } from "./views/TextView";
import { ImageView } from "./views/ImageView";
import { VideoView } from "./views/VideoView";
import { AssetGalleryView } from "./views/AssetGalleryView";
import { VideoGridView } from "./views/VideoGridView";
import { ScriptView } from "./views/ScriptView";
import { StoryboardView } from "./views/StoryboardView";
import { OverviewView } from "./views/OverviewView";
import type { ViewKind } from "../../types";

function renderView(kind: ViewKind, projectName: string, path: string) {
  switch (kind) {
    case "json": return <JsonView projectName={projectName} path={path} />;
    case "text": return <TextView projectName={projectName} path={path} />;
    case "image": return <ImageView projectName={projectName} path={path} />;
    case "video": return <VideoView projectName={projectName} path={path} />;
    case "asset-gallery": return <AssetGalleryView projectName={projectName} path={path} />;
    case "video-grid": return <VideoGridView projectName={projectName} path={path} />;
    case "script": return <ScriptView projectName={projectName} path={path} />;
    case "storyboard": return <StoryboardView projectName={projectName} path={path} />;
    case "inspiration": return <JsonView projectName={projectName} path={path} />;
    case "overview": return <OverviewView />;
    default: return <FallbackView projectName={projectName} path={path} />;
  }
}

function kindLabel(kind: ViewKind): string {
  switch (kind) {
    case "json": return "JSON";
    case "text": return "TEXT";
    case "image": return "IMAGE";
    case "video": return "VIDEO";
    case "asset-gallery": return "GALLERY";
    case "video-grid": return "VIDEO GRID";
    case "script": return "SCRIPT";
    case "storyboard": return "STORYBOARD";
    case "inspiration": return "INSPIRATION";
    case "overview": return "OVERVIEW";
    default: return "FILE";
  }
}

export function Viewer() {
  const { tabs, activeId, name: _ignored } = useTabs() as ReturnType<typeof useTabs> & { name: never };
  void _ignored;
  const { name } = useProject();
  const active = tabs.find((t) => t.id === activeId);
  if (!name) {
    return (
      <div className="h-full flex items-center justify-center p-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">
        Select a project to begin.
      </div>
    );
  }
  if (!active) {
    return (
      <div className="h-full flex flex-col">
        <TabBar />
        <FallbackView projectName={name} path="" />
      </div>
    );
  }
  const displayPath = active.path ? `workspace/${name}/${active.path}` : `workspace/${name}`;
  return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex items-center justify-between px-6 py-2 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] shrink-0">
        <span className="font-mono text-[11px] text-[var(--color-ink-muted)] truncate">
          {displayPath}
        </span>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)] shrink-0 ml-4">
          {kindLabel(active.view)}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        {renderView(active.view, name, active.path)}
      </div>
    </div>
  );
}
```

Note: the `useTabs() as ReturnType<typeof useTabs> & { name: never }; void _ignored;` dance is not needed — remove that line. Corrected signature below — use this simpler version instead:

```tsx
export function Viewer() {
  const { tabs, activeId } = useTabs();
  const { name } = useProject();
  const active = tabs.find((t) => t.id === activeId);
  // ... rest as above, starting from the `if (!name)` block ...
}
```

(Replace the `const { tabs, activeId, name: _ignored }...` and the `void _ignored;` line with the two lines above.)

- [ ] **Step 2: Overwrite FallbackView.tsx**

Replace the entire file with:

```tsx
interface Props {
  projectName: string;
  path: string;
}

export function FallbackView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center px-10 py-16">
      <div className="max-w-md">
        <div className="font-serif text-[clamp(32px,3.5vw,44px)] leading-[1.15] text-[var(--color-ink)]">
          Select a stage to begin.
        </div>
        <p className="mt-4 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
          The navigator on the left lists every artifact this project has produced.
          Click a stage to read it; tabs pin automatically.
        </p>
        <div className="mt-12 pt-6 border-t border-[var(--color-rule)] font-mono text-[11px] text-[var(--color-ink-subtle)] space-y-1.5">
          <div><span className="inline-block w-16 uppercase tracking-wider">Project</span>{projectName}</div>
          <div><span className="inline-block w-16 uppercase tracking-wider">Path</span>{path || "(root)"}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Viewer/Viewer.tsx apps/console/src/components/Viewer/views/FallbackView.tsx
git commit -m "feat(console): Viewer path strip + FallbackView editorial empty state"
```

---

## Task 8: Leaf views — Json / Text / Image / Video

**Files:**
- Replace: `apps/console/src/components/Viewer/views/JsonView.tsx`
- Replace: `apps/console/src/components/Viewer/views/TextView.tsx`
- Replace: `apps/console/src/components/Viewer/views/ImageView.tsx`
- Replace: `apps/console/src/components/Viewer/views/VideoView.tsx`

- [ ] **Step 1: Overwrite JsonView.tsx**

Replace the entire file with:

```tsx
import { useMemo } from "react";
import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Token { text: string; kind: "key" | "string" | "number" | "bool" | "null" | "punct" | "ws" }

function tokenize(pretty: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = pretty.length;
  while (i < len) {
    const c = pretty[i];
    if (c === '"') {
      const start = i;
      i++;
      while (i < len && pretty[i] !== '"') {
        if (pretty[i] === '\\') i++;
        i++;
      }
      i++;
      const text = pretty.slice(start, i);
      let j = i;
      while (j < len && pretty[j] !== '\n' && pretty[j].match(/\s/)) j++;
      const isKey = pretty[j] === ':';
      tokens.push({ text, kind: isKey ? "key" : "string" });
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const start = i;
      while (i < len && /[-0-9.eE+]/.test(pretty[i])) i++;
      tokens.push({ text: pretty.slice(start, i), kind: "number" });
      continue;
    }
    if (pretty.startsWith("true", i) || pretty.startsWith("false", i)) {
      const word = pretty.startsWith("true", i) ? "true" : "false";
      tokens.push({ text: word, kind: "bool" });
      i += word.length;
      continue;
    }
    if (pretty.startsWith("null", i)) {
      tokens.push({ text: "null", kind: "null" });
      i += 4;
      continue;
    }
    if (/\s/.test(c)) {
      const start = i;
      while (i < len && /\s/.test(pretty[i])) i++;
      tokens.push({ text: pretty.slice(start, i), kind: "ws" });
      continue;
    }
    tokens.push({ text: c, kind: "punct" });
    i++;
  }
  return tokens;
}

function colorFor(kind: Token["kind"]): string | undefined {
  switch (kind) {
    case "key":    return "var(--color-accent)";
    case "string": return "var(--color-ink)";
    case "number": return "var(--color-run)";
    case "bool":   return "var(--color-warn)";
    case "null":   return "var(--color-ink-subtle)";
    case "punct":  return "var(--color-ink-muted)";
    default:       return undefined;
  }
}

export function JsonView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  const pretty = useMemo(() => {
    if (!text) return "";
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch { return text; }
  }, [text]);
  const tokens = useMemo(() => tokenize(pretty), [pretty]);
  const lineCount = pretty.split("\n").length;

  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (text == null) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;

  return (
    <div className="flex font-mono text-[12px] leading-[1.7]">
      <div aria-hidden className="shrink-0 pl-4 pr-3 py-6 text-right text-[var(--color-ink-faint)] select-none border-r border-[var(--color-rule)] bg-[var(--color-paper-soft)]">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 px-6 py-6 whitespace-pre-wrap break-words">
        {tokens.map((t, i) => (
          <span key={i} style={t.kind === "null" ? { color: colorFor(t.kind), fontStyle: "italic" } : { color: colorFor(t.kind) }}>
            {t.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Overwrite TextView.tsx**

Replace the entire file with:

```tsx
import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

export function TextView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (text == null) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;
  return (
    <div className="px-10 py-10 bg-[var(--color-paper-sunk)] min-h-full">
      <pre className="max-w-[72ch] font-sans text-[15px] leading-[1.6] text-[var(--color-ink)] whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}
```

- [ ] **Step 3: Overwrite ImageView.tsx**

Replace the entire file with:

```tsx
import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function ImageView({ projectName, path }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-10 bg-[var(--color-paper-sunk)] gap-4">
      <div className="border border-[var(--color-rule)] p-2 bg-[var(--color-paper)]">
        <img
          src={fileUrl(projectName, path)}
          alt={path}
          className="max-w-[80vw] max-h-[70vh] object-contain block"
        />
      </div>
      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">{path}</div>
    </div>
  );
}
```

- [ ] **Step 4: Overwrite VideoView.tsx**

Replace the entire file with:

```tsx
import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function VideoView({ projectName, path }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-10 bg-[var(--color-paper-sunk)] gap-4">
      <div className="border border-[var(--color-rule)] p-2 bg-[var(--color-paper)]">
        <video
          src={fileUrl(projectName, path)}
          controls
          preload="metadata"
          className="max-w-[80vw] max-h-[70vh] block"
        />
      </div>
      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">{path}</div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/Viewer/views/JsonView.tsx apps/console/src/components/Viewer/views/TextView.tsx apps/console/src/components/Viewer/views/ImageView.tsx apps/console/src/components/Viewer/views/VideoView.tsx
git commit -m "feat(console): restyle leaf views with tokens, line numbers, editorial frames"
```

---

## Task 9: Gallery views — AssetGallery + VideoGrid

**Files:**
- Replace: `apps/console/src/components/Viewer/views/AssetGalleryView.tsx`
- Replace: `apps/console/src/components/Viewer/views/VideoGridView.tsx`

- [ ] **Step 1: Overwrite AssetGalleryView.tsx**

Replace the entire file with:

```tsx
import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import type { TreeNode } from "../../../types";

interface Props { projectName: string; path: string; }

interface Group {
  id: string;
  files: TreeNode[];
}

function isImage(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function AssetGalleryView({ projectName, path }: Props) {
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    const byGroup = new Map<string, TreeNode[]>();
    for (const node of tree) {
      if (node.type !== "file") continue;
      if (!node.path.startsWith(prefix)) continue;
      if (!isImage(node.name)) continue;
      const rel = node.path.slice(prefix.length);
      const group = rel.split("/")[0] ?? "(root)";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(node);
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, files]) => ({ id, files: files.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [tree, path]);

  if (groups.length === 0) {
    return <div className="px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">No image assets found.</div>;
  }

  return (
    <div className="px-10 py-8 space-y-12">
      {groups.map((g) => (
        <section key={g.id}>
          <header className="flex items-baseline gap-3 mb-4">
            <h2 className="font-serif text-[20px] italic text-[var(--color-ink)]">{g.id}</h2>
            <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
              {g.files.length} items
            </span>
          </header>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {g.files.map((f) => (
              <figure key={f.path} className="space-y-2">
                <button
                  onClick={() => setLightbox(f.path)}
                  className="block w-full aspect-square overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)] hover:border-[var(--color-accent)] transition-colors"
                >
                  <img src={fileUrl(projectName, f.path)} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
                </button>
                <figcaption className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{f.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-[var(--color-ink)]/90 flex items-center justify-center z-50 cursor-zoom-out"
        >
          <img src={fileUrl(projectName, lightbox)} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Overwrite VideoGridView.tsx**

Replace the entire file with:

```tsx
import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import type { TreeNode } from "../../../types";

interface Props { projectName: string; path: string; }

function isVideo(name: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(name);
}

export function VideoGridView({ projectName, path }: Props) {
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const videos: TreeNode[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    return tree
      .filter((n) => n.type === "file" && isVideo(n.name) && n.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [tree, path]);

  if (videos.length === 0) {
    return <div className="px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">No video files found.</div>;
  }

  return (
    <div className="px-10 py-8">
      <header className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
          {videos.length} clips
        </span>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        {videos.map((v) => (
          <figure key={v.path} className="space-y-2">
            <button
              onClick={() => setLightbox(v.path)}
              className="block w-full aspect-video overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)] hover:border-[var(--color-accent)] transition-colors"
            >
              <video src={fileUrl(projectName, v.path) + "#t=0.5"} preload="metadata" muted className="w-full h-full object-cover" />
            </button>
            <figcaption className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{v.path}</figcaption>
          </figure>
        ))}
      </div>
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-[var(--color-ink)]/95 flex items-center justify-center z-50 cursor-zoom-out p-8"
        >
          <video
            src={fileUrl(projectName, lightbox)}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Viewer/views/AssetGalleryView.tsx apps/console/src/components/Viewer/views/VideoGridView.tsx
git commit -m "feat(console): restyle gallery views as auto-fill grids with mono captions"
```

---

## Task 10: Editorial views — Script + Storyboard

**Files:**
- Replace: `apps/console/src/components/Viewer/views/ScriptView.tsx`
- Replace: `apps/console/src/components/Viewer/views/StoryboardView.tsx`

- [ ] **Step 1: Overwrite ScriptView.tsx**

Replace the entire file with:

```tsx
import { useState } from "react";
import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Episode { episode_id?: string; title?: string; logline?: string; scenes?: Scene[]; }
interface Script { title?: string; episodes?: Episode[]; }

export function ScriptView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Script>(projectName, path);
  const [openEp, setOpenEp] = useState<string | null>(null);
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (!data) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;
  const eps = data.episodes ?? [];
  return (
    <div className="px-10 py-10 max-w-[72ch]">
      {data.title && (
        <h1 className="font-serif text-[32px] leading-tight text-[var(--color-ink)] mb-2">{data.title}</h1>
      )}
      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider mb-10">
        {eps.length} {eps.length === 1 ? "episode" : "episodes"}
      </div>
      <div className="space-y-3">
        {eps.map((ep, i) => {
          const id = ep.episode_id ?? `ep${i + 1}`;
          const open = openEp === id;
          const scenes = ep.scenes ?? [];
          const shotCount = scenes.reduce((s, sc) => s + (sc.shots?.length ?? 0), 0);
          return (
            <article key={id} className="border-t border-[var(--color-rule)] pt-3">
              <button
                onClick={() => setOpenEp(open ? null : id)}
                className="w-full text-left flex items-baseline gap-4 group"
              >
                <span className="font-mono text-[11px] text-[var(--color-ink-faint)] w-12">{id}</span>
                {ep.title && (
                  <span className="font-serif text-[20px] text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors">
                    {ep.title}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
                  {scenes.length} sc · {shotCount} sh
                </span>
              </button>
              {open && (
                <div className="mt-4 pl-12 space-y-4 text-[14px]">
                  {ep.logline && (
                    <p className="font-serif italic text-[var(--color-ink-muted)] leading-relaxed">
                      {ep.logline}
                    </p>
                  )}
                  {scenes.map((sc, j) => (
                    <div key={sc.scene_id ?? j} className="space-y-0.5">
                      <div className="text-[var(--color-ink)]">
                        <span className="font-mono text-[11px] text-[var(--color-ink-faint)] mr-2 uppercase tracking-wider">
                          {sc.scene_id ?? `scn${j + 1}`}
                        </span>
                        {sc.title}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
                        {sc.shots?.length ?? 0} shots
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Overwrite StoryboardView.tsx**

Replace the entire file with:

```tsx
import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Storyboard { episode_id?: string; title?: string; scenes?: Scene[]; }

export function StoryboardView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Storyboard>(projectName, path);
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (!data) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;
  const scenes = data.scenes ?? [];
  return (
    <div className="px-10 py-10 max-w-[72ch] space-y-10">
      <header>
        <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider mb-1">
          {data.episode_id ?? "storyboard"}
        </div>
        {data.title && (
          <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">{data.title}</h1>
        )}
      </header>
      {scenes.map((sc, si) => (
        <section key={sc.scene_id ?? si} className="border-t border-[var(--color-rule)] pt-6 space-y-4">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wider w-12">
              {sc.scene_id ?? `scn${si + 1}`}
            </span>
            {sc.title && (
              <h2 className="font-serif text-[20px] italic text-[var(--color-ink)]">{sc.title}</h2>
            )}
          </div>
          <div className="space-y-4 pl-16">
            {(sc.shots ?? []).map((sh, i) => (
              <div key={sh.shot_id ?? i} className="space-y-1">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-[var(--color-accent)] uppercase tracking-wider">
                    {sh.shot_id ?? `shot${i + 1}`}
                  </span>
                  {sh.duration != null && (
                    <span className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                      {sh.duration}s
                    </span>
                  )}
                </div>
                {sh.prompt && (
                  <div className="font-serif italic text-[14px] leading-relaxed text-[var(--color-ink-muted)] whitespace-pre-wrap">
                    {sh.prompt}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Viewer/views/ScriptView.tsx apps/console/src/components/Viewer/views/StoryboardView.tsx
git commit -m "feat(console): restyle Script and Storyboard views with Fraunces italic stage directions"
```

---

## Task 11: OverviewView (vertical stage stack)

**Files:**
- Replace: `apps/console/src/components/Viewer/views/OverviewView.tsx`

- [ ] **Step 1: Overwrite OverviewView.tsx**

Replace the entire file with:

```tsx
import { useProject } from "../../../contexts/ProjectContext";
import { StatusBadge } from "../../Navigator/StatusBadge";
import type { StageStatus } from "../../../types";

const STAGES = ["INSPIRATION", "SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"] as const;

export function OverviewView() {
  const { name, state, tree } = useProject();
  if (!name) return null;
  if (!state) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;

  const epCount = Object.keys(state.episodes ?? {}).length;
  const assetCount = tree.filter((n) => n.type === "file" && /^output\/(actors|locations|props)/.test(n.path)).length;
  const videoCount = tree.filter((n) => n.type === "file" && /\.(mp4|webm|mov)$/i.test(n.name)).length;

  return (
    <div className="px-10 py-10 max-w-[72ch] space-y-16">
      <section>
        <h1 className="font-serif text-[44px] leading-tight text-[var(--color-ink)]">{name}</h1>
        <div className="mt-3 font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider space-x-4">
          <span>Stage {state.current_stage ?? "—"}</span>
          <span>·</span>
          <span>Next {state.next_action ?? "—"}</span>
        </div>
        {state.last_error && (
          <div className="mt-4 font-mono text-[12px] text-[var(--color-err)]">
            Last error: {state.last_error}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-subtle)] mb-6">
          Pipeline
        </h2>
        <dl className="space-y-5">
          {STAGES.map((s) => {
            const status = (state.stages?.[s]?.status ?? "not_started") as StageStatus;
            const artifacts = state.stages?.[s]?.artifacts ?? [];
            return (
              <div key={s} className="flex items-baseline gap-6 border-t border-[var(--color-rule)] pt-4">
                <dt className="font-serif text-[20px] text-[var(--color-ink)] w-48 shrink-0">{s.toLowerCase()}</dt>
                <dd className="flex-1 flex items-center gap-4">
                  <StatusBadge status={status} />
                  <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
                    {artifacts.length} {artifacts.length === 1 ? "artifact" : "artifacts"}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="grid grid-cols-3 gap-10 border-t border-[var(--color-rule)] pt-8">
        <Stat label="Episodes" value={epCount} />
        <Stat label="Assets" value={assetCount} />
        <Stat label="Videos" value={videoCount} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-subtle)]">{label}</div>
      <div className="mt-2 font-serif text-[44px] leading-none text-[var(--color-ink)]">{value}</div>
    </div>
  );
}
```

Note: this fills status rows using the new `StatusBadge` component (after Task 3). The `span-x-4` class is Tailwind-incorrect — replace with `space-x-4` (already used above; this note clarifies). Typographic hierarchy reuses tokens only.

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/Viewer/views/OverviewView.tsx
git commit -m "feat(console): restyle OverviewView as vertical editorial stack"
```

---

## Task 12: Chat — Pane + MessageBubble + ToolCard

**Files:**
- Replace: `apps/console/src/components/Chat/ChatPane.tsx`
- Replace: `apps/console/src/components/Chat/MessageBubble.tsx`
- Replace: `apps/console/src/components/Chat/ToolCard.tsx`

- [ ] **Step 1: Overwrite ChatPane.tsx**

Replace the entire file with:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  onSend: (message: string) => void;
}

const SUGGESTIONS = [
  "查看所有项目状态",
  "c3 项目现在到哪个阶段了？",
  "开始 c3 的视频剪辑",
];

export function ChatPane({ messages, isStreaming, isConnected, onSend }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming || !isConnected) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-paper)]">
      <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6">
        {messages.length === 0 && (
          <div className="flex flex-col justify-center h-full gap-8">
            <div>
              <div className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
                Say something.
              </div>
              <div className="mt-2 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
                Instruct the agent in natural language. The session persists across messages.
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  disabled={!isConnected}
                  className="text-left text-[13px] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] py-1 border-b border-[var(--color-rule)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="font-mono text-[10px] text-[var(--color-ink-faint)] mr-2">→</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={m.id} message={m} isFirst={i === 0} />
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--color-rule-strong)] px-5 py-4 flex gap-3 items-end bg-[var(--color-paper)]"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={isConnected ? "Message…" : "Connecting…"}
          disabled={!isConnected || isStreaming}
          rows={1}
          className="flex-1 bg-[var(--color-paper-sunk)] border-0 rounded-[2px] px-3 py-2.5 text-[13px] text-[var(--color-ink)] placeholder-[var(--color-ink-faint)] resize-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming || !isConnected}
          className="shrink-0 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)] hover:text-[var(--color-ink)] px-2 py-2.5 disabled:text-[var(--color-ink-faint)] disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Overwrite MessageBubble.tsx**

Replace the entire file with:

```tsx
import type { ChatMessage } from "../../types";
import { ToolCard } from "./ToolCard";

interface Props {
  message: ChatMessage;
  isFirst?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function MessageBubble({ message, isFirst }: Props) {
  const { role, content, toolName, isStreaming, timestamp } = message;

  if (toolName) return <ToolCard message={message} isFirst={isFirst} />;

  const isUser = role === "user";
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-6";

  return (
    <div className={`flex flex-col gap-1 ${borderClass} ${isUser ? "items-end" : "items-start"}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
        {formatTime(timestamp)}
      </span>
      <div className={`max-w-[52ch] text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap break-words ${isUser ? "text-right" : ""}`}>
        {content}
        {isStreaming && (
          <span
            className="inline-block w-[2px] h-4 ml-0.5 align-middle animate-pulse"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Overwrite ToolCard.tsx**

Replace the entire file with:

```tsx
import { useState } from "react";
import type { ChatMessage } from "../../types";

interface Props {
  message: ChatMessage;
  isFirst?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function extractPath(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const v = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
  return typeof v === "string" ? v : "";
}

export function ToolCard({ message, isFirst }: Props) {
  const { toolName, toolInput, toolOutput, isStreaming, timestamp } = message;
  const [expanded, setExpanded] = useState(false);
  const path = extractPath(toolInput);
  const output = toolOutput ?? "";
  const overflows = output.length > 240 || output.split("\n").length > 4;
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-6";

  return (
    <div className={`flex flex-col gap-1.5 ${borderClass}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[12px] text-[var(--color-accent)]">→</span>
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">{toolName}</span>
        {path && (
          <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{path}</span>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
          {isStreaming ? "running" : formatTime(timestamp)}
        </span>
      </div>
      {output && (
        <div className="ml-5">
          <pre
            className={
              "font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)] bg-[var(--color-paper-sunk)] px-3 py-2 whitespace-pre-wrap break-words " +
              (expanded ? "" : "max-h-[120px] overflow-hidden")
            }
          >
            {output}
          </pre>
          {overflows && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)] hover:text-[var(--color-ink)] transition-colors"
            >
              Show more
            </button>
          )}
          {expanded && overflows && (
            <button
              onClick={() => setExpanded(false)}
              className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)] transition-colors"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/Chat/ChatPane.tsx apps/console/src/components/Chat/MessageBubble.tsx apps/console/src/components/Chat/ToolCard.tsx
git commit -m "feat(console): rewrite Chat pane as editor's inbox (no bubbles, inline tool cards)"
```

---

## Task 13: Global polish — scrollbars, focus, selection

**Files:**
- Modify: `apps/console/src/styles/globals.css` (append)

- [ ] **Step 1: Append polish rules to globals.css**

Append to the end of `apps/console/src/styles/globals.css`:

```css
/* Focus ring — visible keyboard-only */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}

/* Scrollbars — narrow, tinted neutral */
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

*::-webkit-scrollbar-track {
  background: var(--color-paper);
}

*::-webkit-scrollbar-thumb {
  background: var(--color-ink-faint);
  border-radius: 3px;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--color-ink-subtle);
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-ink-faint) var(--color-paper);
}

/* Reduce motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}

/* Global transition speed on color-only state changes */
button, a, input, textarea, select {
  transition: color 150ms cubic-bezier(0.2, 0, 0, 1),
              background-color 150ms cubic-bezier(0.2, 0, 0, 1),
              border-color 150ms cubic-bezier(0.2, 0, 0, 1);
}
```

- [ ] **Step 2: Type-check + build**

Run: `cd apps/console && bunx tsc --noEmit && bun run build`
Expected: Both green. Bundle size grows by font chunks (expected ~180 KB gzipped total from Task 1 onward).

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/styles/globals.css
git commit -m "feat(console): scrollbar tint, focus-visible ring, reduce-motion + color transitions"
```

---

## Task 14: Manual verification (spec §10)

No automated tests. Walk through the spec's 10-point test plan; fix any deviation before declaring done.

**Preconditions:**
- At least one project under `workspace/` with a `pipeline-state.json`.
- A valid `ANTHROPIC_API_KEY`.

- [ ] **Step 1: Start dev server**

Run from repo root: `cd apps/console && bun run dev`
Expected: Console shows `API → http://localhost:3001  WS → ws://localhost:3001/ws`; browser auto-opens Vite URL.

- [ ] **Step 2: Header check**

Confirm: left shows "AGENTOS" small caps + project name in **Fraunces 28px**; right shows project switcher, 6px status square, mono "CONNECTED". No layout shift after fonts load.

- [ ] **Step 3: Navigator click check**

Click every top-level entry (Overview, Inspiration, Script, Assets, Episodes, Draft): each single-click opens a pinned tab, active tab has ink-red left bar behavior (verify by clicking another and coming back — still there).

- [ ] **Step 4: Expand check**

Click `+` on Episodes. Expand an episode. Confirm: 1px left rule annotation appears on children; sub-items indent; `−` replaces `+`.

- [ ] **Step 5: JSON view**

Open `script.json`. Confirm: line numbers present in paper-soft gutter; keys in accent red; string values in ink; numbers in run-blue; nulls italic-subtle. No overflow, no horizontal scroll below 1280px.

- [ ] **Step 6: Asset gallery**

Open Actors. Confirm: auto-fill grid ≥200px; square tiles with 1px rule border; hover border turns accent; filename caption in mono below.

- [ ] **Step 7: Script + Storyboard views**

Open `script.json` and (if present) an episode's `storyboard.json`. Confirm: titles in Fraunces; stage directions / prompts in Fraunces italic muted; reads like an editorial layout.

- [ ] **Step 8: Chat flow**

Send "我叫小明". Confirm: right-aligned text, timestamp above in mono, no bubble, 1px rule below from second message onward; streaming cursor = blinking ink-red 2px bar.

Then send "请查看 workspace/<project>/pipeline-state.json". When tool runs, confirm: inline `→` accent arrow + tool name + path mono + timestamp; output in paper-sunk mono, max 120px, "Show more" link if longer.

- [ ] **Step 9: Contrast + reduced motion**

Open DevTools → Lighthouse → Accessibility: expect ≥ 95. Manually sample 5 text-on-bg pairs with DevTools color picker: all AA (≥ 4.5:1).

Enable macOS "Reduce Motion" (or DevTools Rendering → Emulate CSS media feature prefers-reduced-motion). Confirm: transitions effectively instantaneous; streaming cursor's pulse still runs (animation-duration: 0.01ms is the fallback — blink is visually merged but not broken).

- [ ] **Step 10: Final build + screenshots**

Run: `cd apps/console && bunx tsc --noEmit && bun run build`
Expected: both green; bundle `dist/assets/index-*.js` ≤ 300 KB gzipped, `dist/assets/index-*.css` ≤ 20 KB gzipped.

Capture three screenshots for the PR description:
1. Overview view (project header + pipeline stack)
2. Script view mid-scroll
3. Chat pane with one user message + one tool card

- [ ] **Step 11: Commit (only if Task 14 required fixes)**

If any step required a code change, commit it with a targeted message. Otherwise no commit.

---

## Done criteria

- All 14 tasks' checkboxes are checked.
- `git log --oneline` since the start of this plan shows at least 13 commits (Tasks 1–13) plus possibly 1 for Task 14 fixes.
- `bunx tsc --noEmit` and `bun run build` both green.
- All 10 manual verification steps pass.
- Invariants at the top of this plan untouched (grep-verify: no diffs under `apps/console/src/contexts/`, `hooks/`, `lib/`, `orchestrator.ts`, `server.ts`, `serverUtils.ts`, `types.ts`).
