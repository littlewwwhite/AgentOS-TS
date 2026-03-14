# Server E2B Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `bun src/server.ts` 补齐与 CLI E2B 链路最关键的能力差距：上传/同步文件、持久化 sandbox metadata 并 reconnect、以及前端临时项目隔离。

**Architecture:** 保持当前 `server.ts -> SandboxManager -> SandboxClient -> sandbox protocol` 分层不变，只做最小侵入式扩展。共享集成逻辑由主线处理，互不冲突的独立任务交给并行 subagents：`SessionStore` 文件持久化、前端临时 `projectId` 生成。随后主线串联 `SandboxManager` reconnect 与 upload/sync API，并用现有 Vitest 风格补齐回归测试。

**Tech Stack:** Bun, TypeScript, Vitest, Node HTTP + ws, Next.js.

### Task 1: Persist host-side project session metadata

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/session-store.test.ts`

**Step 1: Write failing tests**
- 覆盖 `SessionStore` 从磁盘加载已有项目记录。
- 覆盖 `upsert()` 自动落盘。
- 覆盖 `delete()` 删除后同步移除持久化记录。

**Step 2: Verify red**
Run: `bun x vitest run tests/session-store.test.ts`
Expected: FAIL with missing persistence behavior.

**Step 3: Implement minimal file-backed store**
- 保持现有 `ProjectSession` 结构兼容。
- 通过构造参数接收存储文件路径；默认仍允许内存模式。
- 启动时 best-effort 读取，更新时原子写回 JSON。

**Step 4: Verify green**
Run: `bun x vitest run tests/session-store.test.ts`
Expected: PASS.

### Task 2: Add temporary project isolation in web entry

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/layout.tsx`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/project-id.test.ts`

**Step 1: Write failing tests**
- 覆盖未配置 `NEXT_PUBLIC_AGENTOS_DEFAULT_PROJECT_ID` 时，不再固定使用 `demo-project`。
- 覆盖生成的 project id 在单次会话内稳定。
- 覆盖显式环境变量仍优先。

**Step 2: Verify red**
Run: `bun x vitest run tests/web/project-id.test.ts`
Expected: FAIL with fixed `demo-project` behavior.

**Step 3: Implement minimal temporary project strategy**
- 优先使用 `NEXT_PUBLIC_AGENTOS_DEFAULT_PROJECT_ID`。
- 否则生成轻量临时 key，并在浏览器侧稳定复用。
- 不引入认证系统，不改变现有 provider 接口。

**Step 4: Verify green**
Run: `bun x vitest run tests/web/project-id.test.ts`
Expected: PASS.

### Task 3: Reconnect existing sandbox from persisted metadata

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox-manager.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/e2b-client.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/sandbox-manager.test.ts`

**Step 1: Write failing tests**
- 覆盖存在 `sandboxId` 时优先 `connect()` 而非 `start()`。
- 覆盖 reconnect 失败时回退到 `start()`。
- 覆盖 reconnect 成功后保持事件广播与命令转发行为不变。

**Step 2: Verify red**
Run: `bun x vitest run tests/sandbox-manager.test.ts`
Expected: FAIL with start-only behavior.

**Step 3: Implement reconnect path**
- 扩展 `SandboxClientLike` 支持 `connect(sandboxId)`。
- `SandboxManager.ensureStarted()` 根据持久化 session 优先尝试 reconnect。
- reconnect 失败时清理并回退到 fresh start。

**Step 4: Verify green**
Run: `bun x vitest run tests/sandbox-manager.test.ts`
Expected: PASS.

### Task 4: Expose upload and sync APIs on the host bridge

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox-manager.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/server.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/sandbox-manager.test.ts`

**Step 1: Write failing tests**
- 覆盖单文件文本上传。
- 覆盖目录/多文件同步。
- 覆盖 workspace pull/sync API。

**Step 2: Verify red**
Run: `bun x vitest run tests/server.test.ts tests/sandbox-manager.test.ts`
Expected: FAIL with missing routes or missing manager methods.

**Step 3: Implement minimal host bridge**
- `SandboxManager` 暴露 `writeTextFile`、`syncTextFiles`、`pullWorkspace` 等最小能力。
- `server.ts` 增加对应 REST 路由。
- 先只支持文本文件，与 CLI 当前能力保持一致，不扩展到通用二进制上传。

**Step 4: Verify green**
Run: `bun x vitest run tests/server.test.ts tests/sandbox-manager.test.ts`
Expected: PASS.

### Task 5: Run focused regression verification

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/docs/plans/2026-03-10-server-e2b-parity-implementation.md`

**Step 1: Run targeted tests**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts tests/server.test.ts tests/web/reduce-sandbox-event.test.ts tests/web/project-id.test.ts`
Expected: PASS.

**Step 2: Run build checks**
Run: `bun run build`
Expected: PASS.

Run: `cd web && bun run build`
Expected: PASS.
