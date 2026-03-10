# AgentOS Web Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 AgentOS-TS 落地一个可运行的 `web/` 前端基础骨架，采用 `Next.js + assistant-ui external store + shadcn 风格工作台壳层`，并通过宿主侧 WebSocket/REST 桥接接入现有 E2B sandbox 协议。

**Architecture:** 以前端工作台壳层、事件驱动 reducer、以及最小宿主桥接为主线。保留当前 `SandboxCommand` / `SandboxEvent` 作为系统真相，不引入新的聊天协议；在 UI 层只把用户/助手消息映射到 assistant-ui，把工具事件、系统事件、文件树和预览保持为 AgentOS 自己的一等状态。

**Tech Stack:** Bun, TypeScript, Vitest, Node HTTP + ws, Next.js, assistant-ui, Tailwind CSS, react-resizable-panels.

## Task 1: Add project-scoped sandbox state management

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox-manager.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/session-store.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/sandbox-manager.test.ts`

**Step 1: Write failing tests for metadata and lifecycle rules**
- 覆盖项目元数据创建、更新、删除。
- 覆盖 `SandboxManager` 的 `getOrCreate`、`sendCommand`、`destroy`、事件广播和单例复用。

**Step 2: Run targeted tests to verify red state**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts`
Expected: FAIL with missing module or missing symbol errors.

**Step 3: Implement minimal in-memory store and manager**
- `SessionStore` 只保存 MVP 必需元数据：`projectId`、`sandboxId`、`createdAt`、`updatedAt`。
- `SandboxManager` 负责：按项目懒启动 sandbox client、复用 client、转发事件、暴露文件读取能力。
- 不做数据库持久化，不引入额外依赖，不提前实现权限系统。

**Step 4: Re-run targeted tests**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts`
Expected: PASS.

## Task 2: Add a thin host bridge for WebSocket and file preview

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/package.json`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.gitignore`

**Step 1: Write failing tests for pure server-side helpers if needed**
- 如果服务层逻辑需要纯函数辅助（如 URL/path 解析），先补小型单测。
- 网络层本身以构建和手工联通验证为主。

**Step 2: Implement the bridge**
- 暴露 `GET /health`。
- 暴露 `GET /api/projects`、`POST /api/projects/:projectId`、`DELETE /api/projects/:projectId`。
- 暴露 `GET /api/projects/:projectId/files/tree`、`GET /api/projects/:projectId/files/read`、`GET /api/projects/:projectId/files/download`。
- 暴露 `WS /ws/:projectId`，消息 1:1 映射到 `SandboxCommand`。
- 不在宿主层重塑事件协议，不引入第二套状态机。

**Step 3: Verify buildability**
Run: `bun run build`
Expected: PASS.

## Task 3: Add browser-side protocol reducer with tests

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/protocol.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/reduce-sandbox-event.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/reduce-sandbox-event.test.ts`

**Step 1: Write failing reducer tests first**
- 覆盖 `ready`、`skills`、`text`、`tool_use`、`tool_log`、`result`、`status`、`history`、`agent_entered`、`agent_exited`。
- 明确“assistant 文本流按 session 追加”的预期。

**Step 2: Run reducer tests to verify red state**
Run: `bun x vitest run tests/web/reduce-sandbox-event.test.ts`
Expected: FAIL.

**Step 3: Implement browser-safe protocol mirror and reducer**
- 明确 `UiState`、`TimelineItem`、`FileTreeNode` 类型。
- reducer 保持纯函数，可脱离 React 直接测试。

**Step 4: Re-run reducer tests**
Run: `bun x vitest run tests/web/reduce-sandbox-event.test.ts`
Expected: PASS.

## Task 4: Scaffold the `web/` app and integrate the first MVP shell

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/package.json`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/tsconfig.json`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/next.config.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/postcss.config.mjs`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/layout.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/page.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/globals.css`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/runtime-provider.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/hooks/use-sandbox-connection.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/hooks/use-file-tree.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/app-shell.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/sidebar.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/preview-pane.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/activity-feed.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/agent-tabs.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/assistant-ui/thread.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/ui/*`

**Step 1: Scaffold from the chosen foundation, not from Fragments runtime**
- 使用 `assistant-ui external store` 的思想作为聊天层基础。
- 使用工作台三栏布局承接 AgentOS 特有状态。
- 参考 `Fragments` 的 code/preview 节奏，但不复用它的 `FragmentSchema` 和 `/api/chat -> /api/sandbox` 流程。

**Step 2: Implement the first MVP shell**
- 左侧：项目状态、agent 列表、文件树。
- 中间：文件预览区（先支持 text / json / markdown；二进制通过 download URL 直连预览）。
- 右侧：assistant-ui 聊天线程 + Agent tabs + Activity feed。
- 默认桌面优先，移动端允许退化但不崩。

**Step 3: Verify app buildability**
Run: `cd web && bun install && bun run build`
Expected: PASS.

## Task 5: End-to-end verification for the foundation layer

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/docs/plans/2026-03-10-agentos-web-foundation-implementation.md`

**Step 1: Run focused tests**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts tests/web/reduce-sandbox-event.test.ts`
Expected: PASS.

**Step 2: Run root build**
Run: `bun run build`
Expected: PASS.

**Step 3: Run web build**
Run: `cd web && bun run build`
Expected: PASS.

**Step 4: Manual smoke checklist**
- 启动宿主桥接：`bun src/server.ts`
- 启动前端：`cd web && bun run dev`
- 打开浏览器，确认三栏布局渲染成功。
- 确认可以连接、发消息、看到文本流和工具/系统事件。
- 确认可以查看文件树，并能预览文本文件。

Plan complete and saved to `docs/plans/2026-03-10-agentos-web-foundation-implementation.md`.
