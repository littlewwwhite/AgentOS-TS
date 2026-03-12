# Web E2B Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让当前 Web workbench 在交互、状态语义和后端能力上与 E2B CLI 链路基本对齐，重点补齐 slash 命令、thinking/tool 展示、固定模型、用户与项目隔离、agent 会话持久化、文件结构与预览对齐。

**Architecture:** 保持现有 `server.ts -> SandboxManager -> sandbox protocol` 和 `runtime-provider -> reducer -> app-shell` 两条主线，不引入第二套聊天协议。新增共享层只放在三个位置：`host auth/session store`、`web slash/runtime helpers`、`timeline display components`。前端视觉继续沿用当前 Fragments 风格，只增强信息密度和交互分区。

**Tech Stack:** Bun, TypeScript, Vitest, Node HTTP + ws, Next.js, React.

### Task 1: Add host-side auth and ownership-aware project sessions

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/auth.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/session-store.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/server.test.ts`

**Step 1: Write the failing test**
- 为 `ProjectSession` 增加 `ownerId`、`agentSessions`、`lastActiveAgent` 等持久化字段。
- 覆盖 `Authorization` header 存在时按 owner 隔离项目。
- 覆盖 owner 不匹配时返回 403。
- 覆盖未配置 token 时的 dev-open 模式。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/session-store.test.ts tests/server.test.ts`
Expected: FAIL with missing auth/session ownership behavior.

**Step 3: Write minimal implementation**
- `auth.ts` 提供极简 token 解析与 ownerId 提取。
- `SessionStore` 持久化扩展字段。
- `server.ts` 在 REST/WS 入口统一鉴权并校验 owner。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/session-store.test.ts tests/server.test.ts`
Expected: PASS.

### Task 2: Persist host-side agent session metadata and active agent state

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox-manager.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/session-store.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/sandbox-manager.test.ts`

**Step 1: Write the failing test**
- 覆盖 host store 持久化 `agent -> session_id` 映射。
- 覆盖收到 `result` / `agent_entered` 事件后更新 host-side metadata。
- 覆盖 server 重启后仍能恢复项目级 agent session metadata。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts`
Expected: FAIL with missing agent session persistence.

**Step 3: Write minimal implementation**
- `SandboxManager.broadcast()` 识别相关事件并回填 `SessionStore`。
- 只存 host 需要知道的 metadata，不复制 sandbox 内完整 transcript。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts`
Expected: PASS.

### Task 3: Add shared slash command parsing and runtime actions

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/slash-commands.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/runtime-provider.tsx`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/slash-commands.test.ts`

**Step 1: Write the failing test**
- 覆盖 `/enter`、`/exit`、`/agents`、`/status`、`/help`。
- 覆盖非法 slash 命令产生 UI 级错误提示。
- 覆盖 slash 命令不会进入普通 chat transcript。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/web/slash-commands.test.ts`
Expected: FAIL with missing parser/runtime handling.

**Step 3: Write minimal implementation**
- 抽出纯函数解析器。
- runtime-provider 里优先处理 slash，再回退普通 `chat`。
- 先不实现浏览器本地文件上传 slash，上传走 workbench UI。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/web/slash-commands.test.ts`
Expected: PASS.

### Task 4: Upgrade chat timeline and control surfaces

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/app-shell.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/chat.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/chat-input.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/agent-tabs.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/timeline-event-card.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/activity-feed.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/to-chat-messages.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/reduce-sandbox-event.test.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/to-chat-messages.test.ts`

**Step 1: Write the failing test**
- 覆盖 thinking/tool/result 被映射到 timeline UI。
- 覆盖顶部 control 显示固定模型 `claude-sonnet-4-6`。
- 覆盖原来的 `Auto` 按钮改为当前 agent 名称。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/web/reduce-sandbox-event.test.ts tests/web/to-chat-messages.test.ts`
Expected: FAIL with current assistant-only mapping.

**Step 3: Write minimal implementation**
- 聊天区改为“用户/助手消息 + 可折叠 thinking/tool/result 卡片”的统一时间线。
- `agent-tabs` 与输入工具条展示当前 agent。
- `chat-input` 提供 slash hint 与帮助入口。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/web/reduce-sandbox-event.test.ts tests/web/to-chat-messages.test.ts`
Expected: PASS.

### Task 5: Make workbench panels resizable and file view aligned with backend

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/package.json`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/app-shell.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/file-browser.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/preview-pane.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/hooks/use-file-tree.ts`

**Step 1: Write the failing test**
- 为纯函数层补文件树排序/路径选中测试；布局部分以 build 和手工 smoke 为主。
- 覆盖目录优先、文件预览模式选择、空状态与错误状态。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/web/file-tree.test.ts`
Expected: FAIL if helper tests are newly added.

**Step 3: Write minimal implementation**
- 使用 resizable panels 或等价轻量实现让左右区域和右侧内部区块可拖动。
- 文件区与预览区文案、层级和 root path 与后端 `/workspace` 语义保持一致。
- 预留上传入口，点击文件后仍维持代码/预览切换。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/web/file-tree.test.ts`
Expected: PASS.

### Task 6: Fix model routing and remaining protocol alignment

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/options.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/navbar.tsx`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/options.test.ts`

**Step 1: Write the failing test**
- 覆盖默认模型强制为 `claude-sonnet-4-6`。
- 覆盖前端状态栏文案与后端模型常量一致。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/options.test.ts`
Expected: FAIL with current configurable model behavior.

**Step 3: Write minimal implementation**
- 后端默认模型固定为 `claude-sonnet-4-6`，仅保留一处常量。
- 前端导航显示该模型，不再展示“auto”语义。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/options.test.ts`
Expected: PASS.

### Task 7: Audit and patch remaining CLI/server/web gaps

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/docs/plans/2026-03-10-web-e2b-alignment-implementation.md`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/server.test.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/reduce-sandbox-event.test.ts`

**Step 1: Write the failing test**
- 为审计发现的 residual gaps 添加最小回归测试。

**Step 2: Run test to verify it fails**
Run: `bun x vitest run tests/server.test.ts tests/web/reduce-sandbox-event.test.ts`
Expected: FAIL only for newly identified gaps.

**Step 3: Write minimal implementation**
- 只修当前审计确认的未对齐项，不扩张范围。

**Step 4: Run test to verify it passes**
Run: `bun x vitest run tests/server.test.ts tests/web/reduce-sandbox-event.test.ts`
Expected: PASS.

### Task 8: Run focused regression verification

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/docs/plans/2026-03-10-web-e2b-alignment-implementation.md`

**Step 1: Run targeted tests**
Run: `bun x vitest run tests/session-store.test.ts tests/sandbox-manager.test.ts tests/server.test.ts tests/options.test.ts tests/web/project-id.test.ts tests/web/reduce-sandbox-event.test.ts tests/web/to-chat-messages.test.ts tests/web/slash-commands.test.ts tests/web/file-tree.test.ts`
Expected: PASS.

**Step 2: Run build checks**
Run: `bun run build`
Expected: PASS.

Run: `cd web && bun run build`
Expected: PASS.
