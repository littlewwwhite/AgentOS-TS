# Redundancy Cleanup — Plan A (Minimal Surgery)

## Context

Project has accumulated dead code and duplication across two execution modes
(REPL via `orchestrator.ts` and E2B sandbox via `sandbox-orchestrator.ts`).
Both modes remain in active use; this cleanup removes only provably dead code
and eliminates copy-paste duplication without changing module boundaries.

## Changes

### 1. Unify `.env` loading

`index.ts` and `sandbox.ts` each contain an identical inline `loadEnvFile()`.
A shared version already exists in `env.ts` (`loadDotEnv()`).

- Add `loadEnvToProcess()` to `env.ts` — sync, writes parsed KV into
  `process.env` (skip if key already set).
- Replace inline `loadEnvFile()` in `index.ts` and `sandbox.ts` with the
  shared import.

### 2. Delete `security.ts`

`validateBashCommand()` has zero production callers — security boundary moved
to E2B sandbox isolation (see commit `5ab4e07`).

- Delete `src/security.ts`
- Delete `tests/security.test.ts` (if present)

### 3. Remove deprecated `buildHooks()` + `logger.ts`

`buildHooks()` in `hooks/index.ts` is marked `@deprecated`; `options.ts`
already calls `buildSandboxHooks()`. The entire `hooks/logger.ts` module is
only referenced by the deprecated path.

- Remove `buildHooks()` from `hooks/index.ts`
- Delete `src/hooks/logger.ts`

### 4. Clean `dist/` build artifacts

Stale `dist/permissions.*` left from deleted source file.

- `rm -rf dist && bun run build`

### 5. Tidy `package.json` scripts

- Remove `"dev": "tsx src/index.ts"` (redundant with `"start"` using bun)

## Non-goals

- Merging orchestrator logic (deferred to Plan B)
- Merging logger hooks into parameterized ToolLogger (deferred)
- Documentation cleanup (out of scope)
