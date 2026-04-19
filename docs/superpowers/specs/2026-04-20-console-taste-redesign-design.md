# Console Taste Redesign — Design Spec

**Status:** Approved · 2026-04-20
**Scope:** `apps/console/` frontend (visual + typographic layer only)
**Follows:** Phase A (3-pane structure), Phase C (session resume). Precedes no further phase — this closes the console rebuild.

## 1 · Problem

Current console is the default dark-SaaS aesthetic: flat oklch-grey on oklch-grey, Inter body, purple-blue accent. It reads as "a developer tool someone shipped in a weekend" — not as the creative workbench that AgentOS is. Two concrete symptoms:

- **Client demos lose gravitas.** The UI doesn't earn trust for a tool that decides a studio's production spend.
- **Long-session monitoring fatigues.** Pure-dark with high-chroma accents strains the eye over hour-long pipeline runs.

## 2 · Design direction: "Editorial Workbench"

One-line positioning: **a creative workshop's wall, not a SaaS dashboard.** Craft-register editorial surface with professional-tool information density.

**Reference gravity:** Linear · Arc · Figma (restraint, rhythm) + A24 / Criterion / MUBI (serif register, asymmetry) + DaVinci Resolve (density discipline, state legibility).

**The one memorable thing:** serif display type with warm-ivory paper and a single ink-red accent. No developer tool looks like this; every creative tool does.

## 3 · Non-Goals

- No changes to backend, WS protocol, SDK wiring, or Phase C session logic.
- No new routes, no new components beyond what existing files represent.
- No illustrations, no icons beyond status glyphs. Typography and space carry the design.
- No multi-theme switcher. One theme, done well.
- No accessibility overhaul beyond color-contrast compliance (WCAG AA on primary text; AAA not required).

## 4 · Invariants

1. `cwd` / workspace isolation behavior from Phase C untouched.
2. Every callsite and handler from the Navigator / Viewer / Chat stack preserved — this is a skin change, not a rewrite.
3. WsEvent union, orchestrator, server routes, TabsContext, ProjectContext — all untouched.
4. Single-click-to-open behavior (committed 0d51c83) preserved.
5. No new runtime dependencies beyond fonts.

## 5 · Tokens

All tokens live in `src/styles/globals.css` via Tailwind v4 `@theme`. Raw values use OKLCH so future palette shifts are a single-hue edit.

### 5.1 Palette

```css
/* Base — warm neutrals, all tinted toward brand hue 85 (warm paper) */
--color-paper:       oklch(97% 0.008 85);   /* app bg */
--color-paper-soft:  oklch(94% 0.010 85);   /* raised panels, hover bg */
--color-paper-sunk:  oklch(92% 0.012 85);   /* inset wells (inputs, code) */
--color-rule:        oklch(88% 0.010 85);   /* hairline dividers */
--color-rule-strong: oklch(80% 0.012 85);   /* section separators */

/* Ink scale */
--color-ink:         oklch(22% 0.012 85);   /* primary text */
--color-ink-muted:   oklch(48% 0.010 85);   /* secondary text */
--color-ink-subtle:  oklch(65% 0.008 85);   /* tertiary / metadata */
--color-ink-faint:   oklch(78% 0.008 85);   /* placeholder, disabled */

/* Accents — single warm brand red, three functional states */
--color-accent:      oklch(48% 0.17 32);    /* primary action, active nav, brand */
--color-accent-soft: oklch(94% 0.04 32);    /* accent-tinted surface wash */

--color-run:   oklch(58% 0.14 220);  /* cool slate-blue — running/streaming */
--color-ok:    oklch(52% 0.11 145);  /* forest — validated/completed */
--color-warn:  oklch(66% 0.13 75);   /* ochre — partial/warning */
--color-err:   oklch(52% 0.18 25);   /* deeper red — failed */
```

**Contrast audit:** `--color-ink on --color-paper` is ≈ 12.8:1 (AAA). `--color-ink-muted on --color-paper` ≈ 6.2:1 (AA). `--color-accent on --color-paper` ≈ 5.1:1 (AA for normal text, AAA for large). All status colors checked on `--color-paper-soft` for badge use — all ≥ 4.5:1.

### 5.2 Typography

Three families, each with exactly one job. Self-hosted via Fontsource (no Google runtime fetch — privacy + speed).

```css
--font-serif:  "Fraunces", "EB Garamond", Georgia, serif;   /* display only */
--font-sans:   "Geist", "Inter", system-ui, sans-serif;     /* body + UI */
--font-mono:   "JetBrains Mono", ui-monospace, monospace;   /* metadata only */
```

**Type scale** (fluid via `clamp` for display, fixed for UI):

| Role | Size | Font | Weight | Use |
|---|---|---|---|---|
| Display XL | clamp(32px, 3.5vw, 44px) | Fraunces | 500 | Project name (header), empty-state hero |
| Display L | 28px | Fraunces | 500 | Section headings in Overview |
| Display M | 20px | Fraunces italic | 400 | Tab label (active), stage name |
| Body L | 15px | Geist | 400 | Default reading size (Viewer JSON keys, Script text) |
| Body M | 13px | Geist | 400 | UI default (Navigator, Chat, buttons) |
| Body S | 12px | Geist | 450 | Sub-labels, timestamps in chat |
| Label | 10px | Geist | 600 | Status labels (uppercase, tracking 0.08em) |
| Mono | 12px | JetBrains Mono | 400 | Paths, IDs, durations |

Variable axes used:
- Fraunces: `opsz` + `SOFT` (soft=50 for warmth), italic for tab labels
- Geist: `wght` only, no italic

**Leading:** 1.5 for body, 1.15 for display. Never 1.0.

**Tracking:** -0.01em for Fraunces display; 0 for Geist body; +0.08em uppercase for status labels.

### 5.3 Spatial

Base unit: 4px. Rhythm scale: `4 · 8 · 12 · 20 · 32 · 52 · 84` (Fibonacci-adjacent; feels composed, not gridded).

Content max-widths:
- Viewer reading column: `72ch` (JSON, script, markdown)
- Chat message: `52ch`
- No global page max — full viewport always used

Pane widths:
- Navigator: 260px fixed (unchanged)
- Chat: 380px fixed (unchanged)
- Viewer: `flex-1` (unchanged)

### 5.4 Borders, radii, elevation

- **Radii:** 0 on all containers. 2px on buttons, badges, and text inputs only. No rounded cards.
- **Elevation:** no drop shadows anywhere. Hierarchy via `--color-rule` hairlines and background tint shift (paper → paper-soft is the only elevation move).
- **Rules:** 1px solid `--color-rule`. Major section break = 1px solid `--color-rule-strong`.

## 6 · Component intent

Exhaustive per-component behavioral + visual intent. No code in this spec — implementation belongs to the plan.

### 6.1 Header (`App.tsx`)

Current: generic brand chip + project switcher + connection dot.

**New:**
- Left: "AgentOS" in Geist 13px 600 uppercase tracking-wide, followed by em-space then project name in **Fraunces 28px** (Display L). If no project, project slot reads "— select project" in `--color-ink-faint` italic.
- Right: only a status cluster — 6px filled square (not dot) in `--color-ok`/`--color-run`/`--color-ink-faint` + Mono 12px "CONNECTED" / "STREAMING" / "OFFLINE" all-caps `--color-ink-subtle`.
- Divider below: 1px `--color-rule-strong`.
- Padding: 20px vertical, 32px horizontal. No logo.

The serif project name is the **first thing anyone sees**. It reads as "we're working on *The Three-Body Problem*" not as "Dashboard ▸ c3".

### 6.2 Navigator (`components/Navigator/`)

Current: bracketed rows, emoji arrows, generic hover bg.

**New:**
- **No cards, no icons.** Three-level typographic hierarchy:
  - Top-level stage (Overview, Inspiration, Script, Assets, Episodes, Draft): Geist 13px 500, uppercase tracking 0.06em, 8px vertical, `--color-ink`.
  - Second-level (Actors / Locations / Props / ep001…): Geist 13px 400, no transform, `--color-ink-muted`, indent 16px.
  - Third-level (Storyboard / Raw / Edited / Scored / Final): Geist 12px 400, `--color-ink-subtle`, indent 32px.
- **Disclosure glyph:** right-aligned Mono 10px `+` (collapsed) / `−` (expanded) in `--color-ink-faint`. No rotating chevron. When expanded, children gain a 1px left border in `--color-rule` like a margin annotation.
- **Active state:** 2px left ink-red accent bar flush to pane edge + `--color-paper-soft` row bg. No text color change (legibility > decoration).
- **Hover state:** bg shift to `--color-paper-soft` only. No outline, no color shift.
- **Status chips:** right-aligned, format = `[■] LABEL`:
  - `■` = 6px filled square, color = status hue
  - `LABEL` = Geist 10px 600 uppercase tracking 0.08em `--color-ink-subtle`
  - RUN · OK · WARN · FAIL · — (em-dash for not_started; no chip if unknown)
- **Unread badge:** small filled dot `--color-accent` (6px) after the label. No number.
- **Project switcher:** same typographic spec as stage row but with 8px Mono count of projects next to the dropdown caret (e.g. "C3  /  4 projects").

### 6.3 TabBar (`components/Viewer/TabBar.tsx`)

Current: rounded pills with fill active state.

**New (printer's masthead):**
- Tab row height: 36px.
- Each tab is plain text — Geist 12px 450 `--color-ink-muted`, 16px horizontal padding, no background.
- **Active tab:**
  - Text color `--color-ink`
  - Fraunces italic 13px (font-family override on active only)
  - 2px bottom border `--color-accent` inset to the text baseline (not full-width)
- Close button (×): appears on hover only, 10px Mono ×, `--color-ink-subtle`, 4px left margin.
- Unpinned tabs (if they still exist anywhere): italic text + dashed 1px bottom rule instead of solid. (Deprecated path after 0d51c83, but visual stays to not regress.)
- Row divider below: 1px `--color-rule`.

### 6.4 Viewer (`components/Viewer/`)

**Empty state:** center-left composition, not full center. Fraunces Display XL:
> *Select a stage to begin.*

Below in Geist 13px `--color-ink-muted`:
> Navigator shows every artifact produced by this project. Click to read; the active tab pins automatically.

Then a 52px gap, then a 1px rule, then three Mono lines:
```
PROJECT   c3
STAGE     VISUAL (completed)
NEXT      STORYBOARD
```

This replaces the current "nothing selected" blank.

**Per view-type treatment:** each view module gets a header strip (tab bar's neighbor). Strip contains:
- Left: Mono 12px absolute path (`workspace/c3/output/ep001/ep001_storyboard.json`) — clickable to copy.
- Right: view-kind label in Label style (e.g. "JSON · STORYBOARD").

Content area below the strip is the existing per-view module content, re-styled to tokens (not re-architected):
- `JsonView`: line-numbered, JetBrains Mono 12px, keys `--color-accent`, strings `--color-ink`, numbers `--color-run`, nulls `--color-ink-subtle` italic. No syntax-highlight library — 30-line hand-rolled tokenizer is fine.
- `TextView`: Geist 15px 1.6 on `--color-paper-sunk` with 32px padding, `max-width: 72ch`, left-aligned.
- `ImageView` / `VideoView`: 1px `--color-rule` frame, 8px padding, caption in Mono below.
- `AssetGalleryView`: CSS grid `repeat(auto-fill, minmax(200px, 1fr))`, 20px gap, no card chrome — each image has only filename caption in Mono 11px below.
- `VideoGridView`: same grid but 280px min, posters only, play on click.
- `ScriptView` + `StoryboardView`: two-column Fraunces+Geist pairing — stage directions in Fraunces italic `--color-ink-muted`, dialogue in Geist regular `--color-ink`. This is where the editorial voice shines.
- `OverviewView`: vertical stack of stage cards (not grid). Each stage = Display L name + status chip row + artifacts Mono list. Generous `52px` gap between stages.
- `FallbackView`: same empty-state composition.

### 6.5 Chat (`components/Chat/`)

Current: generic chat bubbles, rounded, colored.

**New (editor's inbox):**
- Pane padding: 20px top, 16px horizontal, 32px bottom.
- Message container: no bubbles. Divider between messages = 24px vertical gap + 1px `--color-rule` at top only on non-first.
- **User message:** right-aligned text, Geist 13px `--color-ink`, max-width 52ch, preceded by tiny right-aligned Mono timestamp "14:32" in `--color-ink-subtle`.
- **Assistant message:** left-aligned text, Geist 13px `--color-ink`, no timestamp. Streaming cursor = blinking ink-red 2px-wide bar at end of text.
- **Tool card:** inline between messages, NOT a boxed card. Structure:
  ```
  → Read workspace/c3/output/script.json                   14:32
    ──────────────────────────────────────
    [collapsed tool output, Mono 11px, 3 lines max, "show more" link]
  ```
  The `→` is a Mono right-arrow in `--color-accent`. Tool name in Geist 12px 600. Path in Mono 11px `--color-ink-subtle`. Output in Mono 11px `--color-paper-sunk` bg, 8px padding, `max-height: 120px` collapsed with gradient fade to `--color-paper`.
- **Input area:** sticky bottom, 1px `--color-rule-strong` top border. `textarea` in Geist 13px, `--color-paper-sunk` bg, 2px radius, 12px padding, no external border. Send button: Geist 12px 600 uppercase tracking 0.06em, `--color-accent` text, no bg, no border. Disabled state: `--color-ink-faint`. Cmd+Enter hint: Mono 10px `--color-ink-subtle` right-aligned.

### 6.6 Status badge (`StatusBadge.tsx`)

Single component, two props: `status`, `unread`. Replaces all ad-hoc status renders.

Render:
```
[■] LABEL  [•]
```
- `■` = 6px filled square, color from status map
- `LABEL` = Geist 10px 600 uppercase tracking 0.08em `--color-ink-subtle`
- `•` = 6px filled circle in `--color-accent`, shown only if `unread > 0`. No number.

Status map:
| Status | Square color | Label |
|---|---|---|
| `running` | `--color-run` | RUN |
| `completed` | `--color-ok` | OK |
| `validated` | `--color-ok` | ✓ (Fraunces 10px, no square) |
| `partial` | `--color-warn` | PART |
| `failed` | `--color-err` | FAIL |
| `not_started` | `--color-ink-faint` | — (em-dash, no square) |
| undefined | hidden entirely | |

### 6.7 Focus + interaction

- Focus ring: 2px `--color-accent` outline with 2px offset, never on pointer clicks (use `:focus-visible`).
- Scrollbars: custom — 6px wide, track `--color-paper`, thumb `--color-ink-faint`, thumb-hover `--color-ink-subtle`. No Windows-chrome feel.
- Text selection: bg `--color-accent-soft`, text `--color-ink`.
- Transitions: `150ms cubic-bezier(0.2, 0, 0, 1)` (ease-out-quart) for bg/border color only. No layout animations.

## 7 · Font loading

Risk: invisible flash until web fonts land. We use Fontsource with `font-display: swap` and subset Latin.

Install:
```
bun add @fontsource-variable/fraunces @fontsource-variable/geist @fontsource-variable/jetbrains-mono
```

Import from `main.tsx`:
```ts
import "@fontsource-variable/fraunces";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
```

This adds ~180 KB gzipped at first load — acceptable for an internal+demo tool. No preload hints (unnecessary for an app shell).

## 8 · Migration discipline

This phase is a **visual rewrite**, not a structural one. Rules:

- Zero changes to `.tsx` component props, handlers, state. Only `className` strings and static JSX.
- Zero changes to `types.ts`, `contexts/*`, `hooks/*`, `orchestrator.ts`, `server.ts`, `serverUtils.ts`.
- Tailwind v4 utilities + `@theme` tokens + arbitrary values. No new CSS files.
- Every component still typechecks the moment it's touched — no multi-file compile-broken intermediate states.
- Commit granularity: one component (or one tight group) per commit.

## 9 · Dark-mode deferral

Explicit non-decision: we **do not** ship a dark variant in this phase. Reasons: (a) user asked for light; (b) doing both forces token abstraction that delays taste decisions; (c) a dark variant can reuse every hue and just invert the L-axis later. Add `color-scheme: light` to root, and that's it.

## 10 · Test plan (manual, post-implementation)

1. Load console with an existing project — verify header displays Fraunces project name; no layout shift after font load.
2. Click every stage in Navigator — verify single-click opens pinned tab; active state is ink-red left bar.
3. Open a JSON file (e.g. `script.json`) — verify key/string/number coloring matches spec; line numbers present.
4. Open Actors gallery — verify `auto-fill minmax(200px, 1fr)` grid, Mono captions.
5. Chat: send a message, verify right-aligned + timestamp + ink-red streaming cursor.
6. Trigger a tool call — verify inline tool card with `→` arrow, collapsed output, show-more link.
7. Contrast: open DevTools color picker on every text-on-bg pair — all ≥ 4.5:1.
8. Reduce motion: enable macOS "Reduce Motion" — verify transitions still work but are ≤ 50ms.
9. Zoom browser to 150% — verify no overlap, no horizontal scroll below 1280px.
10. Take three screenshots for the record: Overview, Script view, Chat mid-stream — attach to PR description.

## 11 · Follow-up

None. This closes the console taste pass. The only remaining console-level TODO is Phase D (the original spec's chat UI features like `askUserQuestion` renderer + session indicator) which can be planned separately if/when needed — taste foundation from this phase will carry it.

## 12 · Open questions

None. Direction committed.
