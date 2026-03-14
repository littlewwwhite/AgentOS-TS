# Web Server Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 AgentOS 的 web 前端、server 后端与 CLI E2B 行为在关键用户路径上对齐，包括 slash 交互、thinking/tool 时间线、多 Agent 会话持久化与用户隔离、极简鉴权、文件树与预览对齐。

**Architecture:** 保持现有 `web runtime -> ws/http bridge -> SandboxManager -> sandbox protocol -> SandboxOrchestrator` 主链不变，只把当前半实现能力补全。用户鉴权采用极简 token 模式，project key 语义升级为 `user scope + project scope`；聊天 UI 改为统一时间线渲染，slash 命令在前端解析并映射到既有协议命令，避免新增第二套后端命令协议。

**Tech Stack:** Bun, TypeScript, Vitest, Next.js, ws, Node HTTP.

### Task 1: Add minimal auth and scoped project identity

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/auth.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/server.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/session-store.test.ts`

**Step 1: Write the failing test**
- 覆盖缺失或无效 token 时拒绝访问。
- 覆盖同名 `projectId` 在不同 user scope 下隔离。
- 覆盖 host 持久化记录包含 user scope，而不是裸 `projectId`。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/server.test.ts tests/session-store.test.ts`
Expected: FAIL with missing auth/scoped session behavior.

**Step 3: Write minimal implementation**
- 引入极简 bearer token 认证。
- server 根据认证主体构造 scoped project key。
- SessionStore 持久化 user-scoped project metadata。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/server.test.ts tests/session-store.test.ts`
Expected: PASS.

### Task 2: Persist multi-agent session state at the host boundary

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox-manager.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/sandbox-manager.test.ts`

**Step 1: Write the failing test**
- 覆盖 host store 在收到 `result` / `agent_entered` 等事件后可保存 main/agent `session_id`。
- 覆盖 sandbox reconnect 后仍能恢复对应 user/project 的会话元数据。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/sandbox-manager.test.ts`
Expected: FAIL with missing persisted agent session metadata.

**Step 3: Write minimal implementation**
- 扩展 `ProjectSession` 持久化字段以记录 agent session ids。
- `SandboxManager.broadcast()` 在相关事件到来时同步更新 host metadata。
- 保持 sandbox 内 `.sessions.json` 为对话恢复真相来源，不复制 orchestrator 逻辑。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/sandbox-manager.test.ts`
Expected: PASS.

### Task 3: Build slash-aware unified timeline UI

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/runtime-provider.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/app-shell.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/chat-input.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/chat.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/activity-feed.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/slash-command.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/timeline.tsx`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/slash-command.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/to-chat-messages.test.ts`

**Step 1: Write the failing test**
- 覆盖 `/enter`、`/exit`、`/agents`、`/status` 等 slash 命令解析。
- 覆盖时间线保留并展示 `thinking`、`tool_use`、`tool_log`、`result`。
- 覆盖模型固定显示为 `claude-sonnet-4-6`，auto 按钮显示当前 agent 名称。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/web/slash-command.test.ts tests/web/to-chat-messages.test.ts tests/web/reduce-sandbox-event.test.ts`
Expected: FAIL with missing slash/timeline behavior.

**Step 3: Write minimal implementation**
- 前端输入层先解析 slash，再决定是发协议命令还是普通 chat。
- 聊天区改为统一时间线组件，按当前风格展示 thinking/tool cards。
- 右侧面板改为可缩放布局，保持文件/预览/activity 三视图。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/web/slash-command.test.ts tests/web/to-chat-messages.test.ts tests/web/reduce-sandbox-event.test.ts`
Expected: PASS.

### Task 4: Align file tree, preview, and remaining protocol gaps

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/hooks/use-file-tree.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/file-browser.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/preview-pane.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/preview-helpers.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/server.test.ts`

**Step 1: Write the failing test**
- 覆盖文件树目录层级和 root 行为与 CLI 一致。
- 覆盖 preview 对文本/图片/视频/markdown/json 的细节行为。
- 覆盖 `resume` 的明确行为，避免“协议有定义但返回未实现”。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/web/preview-helpers.test.ts tests/server.test.ts`
Expected: FAIL with current partial behavior.

**Step 3: Write minimal implementation**
- 调整 file tree/preview 交互细节。
- 明确 `resume` 语义：要么真正实现，要么在 server/web 层屏蔽不可达入口。
- 输出剩余未对齐项清单，避免隐藏半实现状态。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/web/preview-helpers.test.ts tests/server.test.ts`
Expected: PASS.

### Task 5: Run focused verification

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/docs/plans/2026-03-10-web-server-alignment-implementation.md`

**Step 1: Run focused tests**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts tests/server.test.ts tests/web/project-id.test.ts tests/web/reduce-sandbox-event.test.ts tests/web/to-chat-messages.test.ts tests/web/preview-helpers.test.ts tests/web/slash-command.test.ts`
Expected: PASS.

**Step 2: Run root build**
Run: `bun run build`
Expected: PASS.

**Step 3: Run web build**
Run: `cd web && bun run build`
Expected: PASS.
