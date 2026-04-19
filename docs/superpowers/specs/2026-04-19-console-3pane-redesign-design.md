# Console 3-Pane Redesign — Design Spec

**Date:** 2026-04-19
**Target:** `apps/console/`
**Status:** approved, ready for implementation plan

## 1 · Problem & Framing

The current console copies Lovable's chat-left + single-canvas pattern. This pattern
fits tools with **one** build artifact (a webapp preview). AgentOS produces a
**tree** of artifacts across 7 pipeline stages × N episodes × multiple asset types
(images, JSON, videos, audio). A reactive "show the last tool result" canvas breaks
the moment the user wants to look at episode 3 while the agent is generating
episode 7, or compare two actor variants side by side.

The right analogue is **VS Code / Final Cut / Figma**: navigator + type-aware
viewer + assistant. Chat is the driver, not the destination; place it on the right
where the user's attention rests only when instructing.

## 2 · Non-Goals

- No multi-user / collaboration features.
- No inline editing of artifacts (viewer is read-only; mutation goes through agent).
- No timeline scrubber / video editor UI — video playback uses plain `<video>`.
- No cross-project views; one project at a time.

## 3 · Layout Convention (Backend Contract)

Single root per project. Top-level `output/` is deprecated.

```
workspace/{project_name}/               ← project root, UI's only scan target
├─ pipeline-state.json                  ← machine-readable state
├─ source.txt                           ← source material
├─ _draft/                              ← LLM intermediates; navigator collapses by default
├─ inspiration.json                     ← Stage 0 (optional)
├─ script.json                          ← Stage 1
├─ actors/
│   └─ {actor_id}/
│       ├─ ref.png
│       └─ variants/*.png
├─ locations/        (same shape as actors/)
├─ props/            (same shape as actors/)
├─ ep{NNN}/
│   ├─ storyboard.json                  ← Stage 3
│   ├─ raw/*.mp4                        ← Stage 4
│   ├─ edited/*.mp4                     ← Stage 5
│   ├─ scored/*.mp4                     ← Stage 6
│   ├─ final/*.mp4                      ← Stage 7 (with subtitles)
│   └─ subtitles.srt
└─ final.mp4                            ← optional composite
```

**Migration scope:**
- Update `CLAUDE.md` §Project Layout: drop `${OUTPUT}` macro, use only `${WORKSPACE}` = `workspace/{name}/`.
- Move `output/c3/*` → `workspace/c3/` (resolve merge manually if collision).
- Skills audit: grep 26 files for literal `output/` paths, convert to `workspace/{name}/`
  where they refer to project outputs. No skill currently uses the `${OUTPUT}` env macro,
  so there is no runtime indirection to fix — just string-level edits in skill prose.
- Top-level `output/` removed from repo after migration.

## 4 · Architecture

Three-zone layout (left → right):

```
┌────────────┬─────────────────────────────────┬────────────┐
│ Navigator  │              Viewer             │   Chat     │
│  ~260 px   │             flex-1              │   380 px   │
│            │ ┌────tabs────────────────────┐  │            │
│ project ▼  │ │ script.json | ep001/raw ●  │  │ messages   │
│ ▸ SCRIPT ✓ │ ├────────────────────────────┤  │            │
│ ▸ VISUAL ✓ │ │                            │  │            │
│ ▸ STORY.. ●│ │     type-aware view        │  │            │
│ ▸ VIDEO …  │ │                            │  │            │
│            │ └────────────────────────────┘  │ ──input──  │
└────────────┴─────────────────────────────────┴────────────┘
```

**Responsibilities:**

- **Navigator** — pipeline-shaped tree; owns selection and expansion; shows per-node
  status badges sourced from `pipeline-state.json` ∪ filesystem presence (filesystem wins).
- **Viewer** — tab strip + dispatch to a type-aware view module; receives
  `(projectName, path)` via tab state.
- **Chat** — unchanged from current `ChatPane`, moved to the right column.

**State isolation:** three independent React Contexts (`ProjectContext`,
`TabsContext`, `ChatContext` via existing `useWebSocket`). No external state lib.
Navigator drives Tabs via `openPath(path, { preview })`. Tool results from WS drive
Navigator badges only — never open tabs or change selection.

## 5 · Navigator

### Tree shape

Tree is rendered from pipeline state, not from raw filesystem. Node → artifact path
mapping is explicit:

| Node label              | Artifact path                              |
|-------------------------|--------------------------------------------|
| `Overview`              | `(project root)`                           |
| `Inspiration`           | `inspiration.json`                         |
| `Script`                | `script.json`                              |
| `Assets > Actors`       | `actors/`                                  |
| `Assets > Locations`    | `locations/`                               |
| `Assets > Props`        | `props/`                                   |
| `Episodes > ep001`      | `ep001/` (expands to Storyboard/Raw/…)     |
| `Episodes > ep001 > Storyboard` | `ep001/storyboard.json`            |
| `Episodes > ep001 > Raw`        | `ep001/raw/`                       |
| `Episodes > ep001 > Edited`     | `ep001/edited/`                    |
| `Episodes > ep001 > Scored`     | `ep001/scored/`                    |
| `Episodes > ep001 > Final`      | `ep001/final/`                     |
| `Draft`                 | `_draft/` (collapsed by default)           |

### Status badges

Each stage/episode node carries one badge derived from `pipeline-state.json`:

| Badge     | Source                                           |
|-----------|--------------------------------------------------|
| `✓` green | `status ∈ {completed, validated}`                |
| `◐` amber | `status === "partial"`                           |
| `●` blue  | `status === "running"` (pulsing)                 |
| `✗` red   | `status === "failed"`                            |
| none      | `status ∈ {not_started}` or absent               |
| `●N` blue | unread tool-result count since last user click   |

Unread counter is local UI state; resets when the user clicks the node.

### Weak-follow rule

WebSocket `tool_result.path` → resolve to the deepest matching navigator node →
increment that node's unread counter and flash its row for 600ms. **Never** opens
a tab, **never** changes selection. Exception: if the resolved node is the
currently-selected node, suppress the unread counter (user is already looking).

## 6 · Viewer

### Tab model

- Single-click navigator node → **preview tab** (italic title, blue underline).
  The next preview single-click replaces it. At most one preview tab exists.
- Double-click, `Cmd`/`Ctrl`+click, or typing into/interacting with a preview tab's
  content → converts preview to **pinned tab**.
- Explicit close (× button or `Cmd`+`W`) removes a tab.
- Tab bar overflows to horizontal scroll past 10 tabs. No stacking, no grouping.
- Tab state is in-memory only (not persisted across reloads in v1).

### View modules (one per artifact category)

Dispatch is a pure function: `(path) → ViewComponent`.

| Selection                                       | View                  |
|-------------------------------------------------|-----------------------|
| project root                                    | `OverviewView`        |
| `*.json` with schema = script                   | `ScriptView`          |
| `*.json` with schema = inspiration              | `JsonView`            |
| `*.json` with schema = storyboard               | `StoryboardView`      |
| `actors/`, `locations/`, `props/`               | `AssetGalleryView`    |
| `ep{N}/raw|edited|scored|final/`                | `VideoGridView`       |
| `*.srt`                                         | `TextView` (mono)     |
| `*.png`, `*.jpg` (leaf)                         | `ImageView`           |
| `*.mp4`, `*.webm` (leaf)                        | `VideoView`           |
| anything else                                   | `FallbackView`        |

Each view takes `(projectName, path)` and is responsible for its own data
fetching. No global data store.

### Module specs (behavior, not styling)

- **OverviewView** — pipeline summary table (7 rows, status column), key stats
  (episode count, asset count per type, last updated). Links into the navigator
  on row click.
- **ScriptView** — renders `script.json` as expandable episode cards. Each card
  shows logline, scene count, shot count. Clicking a scene jumps into
  `StoryboardView` for that episode.
- **StoryboardView** — per-episode scene list. Each scene expands to shot rows;
  each shot row shows `shot_id`, `prompt` (truncated + expand), reference asset
  thumbnails resolved via `element_id` lookup.
- **AssetGalleryView** — responsive image grid grouped by `element_id`. Hover
  shows element id; click opens a lightbox with all variants of that element.
- **VideoGridView** — responsive thumbnail grid (first-frame poster). Click opens
  lightbox with HTML5 `<video controls>`. Keyboard: arrow keys cycle.
- **JsonView** — collapsible JSON tree, monospace, no editing.
- **TextView** — plain text in monospace with word wrap.
- **ImageView / VideoView** — single-asset fullscreen variants.
- **FallbackView** — shows filename, size, mtime; "Reveal in Finder" link (macOS
  `x-apple.finder-reveal` URL scheme — graceful fallback if unsupported).

## 7 · Backend Additions

Keep current WS endpoint unchanged. Add read-only HTTP endpoints to `server.ts`:

| Method | Path                                       | Returns                                           |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | `/api/projects`                            | existing — list + state                           |
| GET    | `/api/projects/{name}`                     | existing — `pipeline-state.json`                  |
| GET    | `/api/projects/{name}/tree`                | new — recursive dir listing (name, type, size, mtime) |
| GET    | `/files/{name}/*`                          | new — static file serving from `workspace/{name}/` |

- Tree endpoint skips `_draft/` unless `?include_draft=1`.
- File endpoint sets MIME from extension; supports `Range` for videos.
- Both endpoints 404 if path escapes `workspace/{name}/` (realpath check).

No auth — localhost only.

## 8 · Data Flow

```
  ┌────────────────┐     GET /api/projects/{name}
  │ ProjectContext │◄────GET /api/projects/{name}/tree
  └──────┬─────────┘
         │ state + tree
         ▼
  ┌────────────────┐     click → openPath()
  │   Navigator    │──────────────────────────┐
  └──────┬─────────┘                          │
         │ WS tool_result.path                │
         │ (weak-follow: badges only)         │
         ▼                                    ▼
  ┌────────────────┐                   ┌──────────────┐
  │  WS listener   │                   │ TabsContext  │
  └────────────────┘                   └──────┬───────┘
                                              │ active tab
                                              ▼
                                       ┌──────────────┐
                                       │ Viewer + view│
                                       │ module fetch │
                                       │ file content │
                                       └──────────────┘
```

Refresh triggers:
- WS `tool_result` → `ProjectContext` re-fetches state + tree (debounced 500ms).
- WS `result` (agent turn end) → same.
- User clicks "refresh" button in navigator header → force re-fetch.

## 9 · File Structure (Frontend)

```
apps/console/src/
├─ App.tsx                           ← 3-zone layout
├─ types.ts                          ← existing, extended
├─ contexts/
│   ├─ ProjectContext.tsx            ← state + tree + refresh
│   └─ TabsContext.tsx               ← open tabs + preview
├─ components/
│   ├─ Navigator/
│   │   ├─ Navigator.tsx
│   │   ├─ ProjectSwitcher.tsx       ← dropdown at top
│   │   ├─ StageNode.tsx
│   │   ├─ EpisodeNode.tsx
│   │   └─ StatusBadge.tsx           ← reuse existing
│   ├─ Viewer/
│   │   ├─ Viewer.tsx                ← tab bar + view dispatch
│   │   ├─ TabBar.tsx
│   │   ├─ resolveView.ts            ← path → ViewComponent
│   │   └─ views/
│   │       ├─ OverviewView.tsx
│   │       ├─ ScriptView.tsx
│   │       ├─ StoryboardView.tsx
│   │       ├─ AssetGalleryView.tsx
│   │       ├─ VideoGridView.tsx
│   │       ├─ JsonView.tsx
│   │       ├─ TextView.tsx
│   │       ├─ ImageView.tsx
│   │       ├─ VideoView.tsx
│   │       └─ FallbackView.tsx
│   └─ Chat/                         ← ChatPane + MessageBubble + ToolCard (moved)
├─ hooks/
│   ├─ useWebSocket.ts               ← existing; replace canvas logic with weak-follow emit
│   ├─ useProjectTree.ts             ← fetch + cache tree
│   └─ useFile.ts                    ← fetch text/json file content
└─ lib/
    ├─ fileUrl.ts                    ← build /files/ URL from project + path
    └─ schemaDetect.ts               ← detect JSON schema kind
```

Obsoleted (delete):
- `components/CanvasPane.tsx`
- `components/PipelineTimeline.tsx` (reused inside OverviewView — move its
  contents there, delete file)
- `CanvasView` type in `types.ts`

## 10 · Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Tree endpoint slow on large projects (10k+ files) | Cap depth to 4; page `ep*/` entries; lazy-load sub-dirs on expand |
| Video thumbnails heavy to generate on-the-fly | v1: use first-frame via `<video preload="metadata">` + `currentTime=0.1`; no server-side thumbs |
| Skill path migration breaks existing pipelines | Migration PR includes grep log proving every change; old `output/c3/` kept until user confirms |
| Weak-follow unread counters grow unbounded | Max display `99+`; counter stored in-memory (resets on reload) |
| Preview tab UX confusion | Title italicized + distinct underline; tooltip "double-click to keep open" |

## 11 · Testing

- **Visual smoke:** start `bun run dev` on a populated project (e.g. `c3-1`),
  verify navigator renders full tree, each view module opens without error,
  tab preview/pin works, weak-follow badge appears on a synthetic WS message.
- **Unit:** `resolveView` dispatch table (pure function, fully unit-testable),
  `schemaDetect` JSON classifier, URL builders.
- No e2e framework in scope for this spec.

## 12 · Out of Scope (Future)

- Viewer edit-in-place (redo this shot from UI).
- Cross-episode diff view for storyboards.
- Asset-level status badges (per-actor generation progress).
- Tab persistence across reloads.
- Dark/light theme toggle (currently dark-only).
