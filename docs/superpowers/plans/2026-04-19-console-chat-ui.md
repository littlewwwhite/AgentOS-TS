# AgentOS Console 两栏对话界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AgentOS Console 重构为两栏布局——左侧流式对话框，右侧 Canvas 实时显示 pipeline 状态与产物预览。

**Architecture:** Bun WebSocket server 接收前端用户消息，传给 orchestrator（先用 mock 流式事件跑通 UI，Task 9 换真实 Claude SDK）。事件类型为 `text / tool_use / tool_result / result`，与 e2b 协议一致。右侧 Canvas 根据 `tool_result` 事件的文件路径路由渲染对应视图（PipelineTimeline / 图片网格 / 文本预览）。

**Tech Stack:** Bun WebSocket、`@anthropic-ai/claude-code` SDK、React 19、Tailwind v4、TypeScript

---

## 文件结构

```
apps/console/
├── server.ts                          ← 修改：加 WebSocket endpoint
├── src/
│   ├── orchestrator.ts                ← 新建：mock 流 + 真实 Claude SDK
│   ├── types.ts                       ← 修改：加 WsEvent / ChatMessage 类型
│   ├── App.tsx                        ← 修改：两栏布局
│   ├── hooks/
│   │   └── useWebSocket.ts            ← 新建：WebSocket 状态机
│   └── components/
│       ├── ChatPane.tsx               ← 新建：左栏
│       ├── CanvasPane.tsx             ← 新建：右栏
│       ├── MessageBubble.tsx          ← 新建：单条消息
│       ├── ToolCard.tsx               ← 新建：工具调用卡片
│       ├── ProjectSelector.tsx        ← 新建：Header 项目选择器
│       ├── StatusBadge.tsx            ← 不变
│       ├── PipelineTimeline.tsx       ← 不变（Canvas 内复用）
│       └── StageCard.tsx              ← 不变（Canvas 内复用）
```

**删除/归档（逻辑迁移到 CanvasPane）：**
- `src/pages/Dashboard.tsx`
- `src/pages/ProjectDetail.tsx`

---

## Task 1: 扩展 types.ts

**Files:**
- Modify: `apps/console/src/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加事件类型和消息类型**

```typescript
// WebSocket 事件（服务端 → 前端）
export type WsEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; tool: string; output: string; path?: string }
  | { type: "result"; exitCode: number; duration: number }
  | { type: "error"; message: string };

// 对话消息（前端渲染用）
export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  timestamp: number;
}

// Canvas 视图类型（由 tool_result 路径路由决定）
export type CanvasView =
  | { type: "pipeline"; projectName: string }
  | { type: "images"; paths: string[] }
  | { type: "text"; content: string; label: string }
  | { type: "idle" };
```

- [ ] **Step 2: 验证无 TS 错误**

```bash
cd apps/console && bunx tsc --noEmit
```

期望：无报错输出。

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/types.ts
git commit -m "feat(console): add WsEvent and ChatMessage types"
```

---

## Task 2: 创建 orchestrator.ts（Mock 版）

**Files:**
- Create: `apps/console/src/orchestrator.ts`

- [ ] **Step 1: 创建 mock orchestrator**

```typescript
// apps/console/src/orchestrator.ts
import type { WsEvent } from "./types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function* runMock(message: string): AsyncGenerator<WsEvent> {
  yield { type: "text", text: "正在分析请求" };
  await sleep(200);
  yield { type: "text", text: `：「${message}」\n\n` };
  await sleep(300);

  yield {
    type: "tool_use",
    id: "mock_1",
    tool: "Read",
    input: { file_path: "workspace/c3/pipeline-state.json" },
  };
  await sleep(400);

  yield {
    type: "tool_result",
    id: "mock_1",
    tool: "Read",
    output: '{"current_stage":"VIDEO","stages":{}}',
    path: "workspace/c3/pipeline-state.json",
  };
  await sleep(200);

  yield { type: "text", text: "项目 **c3** 当前处于 VIDEO 阶段，EDITING 尚未开始。" };
  await sleep(100);

  yield { type: "result", exitCode: 0, duration: 1200 };
}

// 后续 Task 9 替换为真实 SDK，此文件不变
export const runAgent = runMock;
```

- [ ] **Step 2: 验证 TS 无报错**

```bash
cd apps/console && bunx tsc --noEmit
```

期望：无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/orchestrator.ts
git commit -m "feat(console): add mock orchestrator"
```

---

## Task 3: server.ts 加 WebSocket endpoint

**Files:**
- Modify: `apps/console/server.ts`

- [ ] **Step 1: 在 `apps/console/server.ts` 顶部加 orchestrator import**

在文件第一行添加：
```typescript
import { runAgent } from "./src/orchestrator";
```

- [ ] **Step 2: 把现有 `Bun.serve()` 改为支持 WebSocket 的版本**

将现有的 `Bun.serve({ port: 3001, fetch(req) { ... } })` 整体替换为：

```typescript
Bun.serve({
  port: 3001,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket 升级
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 500 });
      return undefined;
    }

    // 保留原有 REST API
    if (url.pathname === "/api/projects") {
      return Response.json(scanProjects(), { headers: CORS });
    }

    const m = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      const stateFile = join(WORKSPACE, decodeURIComponent(m[1]), "pipeline-state.json");
      if (!existsSync(stateFile)) {
        return Response.json({ error: "not found" }, { status: 404, headers: CORS });
      }
      return Response.json(JSON.parse(readFileSync(stateFile, "utf-8")), { headers: CORS });
    }

    return Response.json({ error: "not found" }, { status: 404, headers: CORS });
  },

  websocket: {
    open(ws) {
      console.log("WS connected");
    },

    async message(ws, raw) {
      let payload: { message: string; project?: string };
      try {
        payload = JSON.parse(raw as string);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      try {
        for await (const event of runAgent(payload.message)) {
          ws.send(JSON.stringify(event));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: String(err) }));
      }
    },

    close(ws) {
      console.log("WS disconnected");
    },
  },
});

console.log("API → http://localhost:3001  WS → ws://localhost:3001/ws");
```

- [ ] **Step 3: 手动测试 WebSocket**

终端 1 启动 server：
```bash
cd apps/console && bun server.ts
```

终端 2 用 wscat 发送消息（需先 `bun add -g wscat`）：
```bash
wscat -c ws://localhost:3001/ws
> {"message":"查看c3项目状态"}
```

期望输出（每行一个 JSON 事件）：
```
{"type":"text","text":"正在分析请求"}
{"type":"text","text":"：「查看c3项目状态」\n\n"}
{"type":"tool_use","id":"mock_1","tool":"Read","input":{...}}
{"type":"tool_result","id":"mock_1","tool":"Read","output":"...","path":"workspace/c3/pipeline-state.json"}
{"type":"text","text":"项目 **c3** 当前处于 VIDEO 阶段，EDITING 尚未开始。"}
{"type":"result","exitCode":0,"duration":1200}
```

- [ ] **Step 4: Commit**

```bash
git add apps/console/server.ts
git commit -m "feat(console): add WebSocket endpoint"
```

---

## Task 4: useWebSocket hook

**Files:**
- Create: `apps/console/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 创建 hook**

```typescript
// apps/console/src/hooks/useWebSocket.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, CanvasView, WsEvent } from "../types";

function uid() {
  return Math.random().toString(36).slice(2);
}

function routeCanvas(event: Extract<WsEvent, { type: "tool_result" }>): CanvasView | null {
  const path = event.path ?? "";
  if (path.includes("pipeline-state.json")) {
    const m = path.match(/workspace\/([^/]+)\//);
    return m ? { type: "pipeline", projectName: m[1] } : null;
  }
  if (path.includes("/actors/") || path.includes("/locations/") || path.includes("/props/")) {
    return { type: "images", paths: [path] };
  }
  if (/ep\d+/.test(path) && event.output) {
    return { type: "text", content: event.output, label: path.split("/").pop() ?? path };
  }
  return null;
}

export function useWebSocket(url: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canvas, setCanvas] = useState<CanvasView>({ type: "idle" });
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (e) => {
      const event: WsEvent = JSON.parse(e.data);

      if (event.type === "text") {
        setIsStreaming(true);
        setMessages((prev) => {
          const existingId = streamingIdRef.current;
          if (existingId) {
            return prev.map((m) =>
              m.id === existingId ? { ...m, content: m.content + event.text } : m
            );
          }
          const newId = uid();
          streamingIdRef.current = newId;
          return [
            ...prev,
            { id: newId, role: "assistant", content: event.text, isStreaming: true, timestamp: Date.now() },
          ];
        });
      }

      if (event.type === "tool_use") {
        if (streamingIdRef.current) {
          setMessages((prev) =>
            prev.map((m) => m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m)
          );
          streamingIdRef.current = null;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `tool_${event.id}`,
            role: "assistant",
            content: "",
            toolName: event.tool,
            toolInput: event.input,
            isStreaming: true,
            timestamp: Date.now(),
          },
        ]);
      }

      if (event.type === "tool_result") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `tool_${event.id}` ? { ...m, toolOutput: event.output, isStreaming: false } : m
          )
        );
        const view = routeCanvas(event);
        if (view) setCanvas(view);
      }

      if (event.type === "result") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        );
      }

      if (event.type === "error") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: `错误：${event.message}`, timestamp: Date.now() },
        ]);
      }
    };

    return () => ws.close();
  }, [url]);

  const send = useCallback(
    (message: string, project?: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      wsRef.current.send(JSON.stringify({ message, project }));
    },
    []
  );

  return { messages, canvas, isConnected, isStreaming, send };
}
```

- [ ] **Step 2: 验证 TS 无报错**

```bash
cd apps/console && bunx tsc --noEmit
```

期望：无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/hooks/useWebSocket.ts
git commit -m "feat(console): add useWebSocket hook with canvas routing"
```

---

## Task 5: MessageBubble + ToolCard 组件

**Files:**
- Create: `apps/console/src/components/MessageBubble.tsx`
- Create: `apps/console/src/components/ToolCard.tsx`

- [ ] **Step 1: 创建 ToolCard**

```tsx
// apps/console/src/components/ToolCard.tsx
import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
}

export function ToolCard({ message }: Props) {
  const { toolName, toolInput, toolOutput, isStreaming } = message;

  return (
    <div className="rounded-lg border border-[oklch(22%_0_0)] bg-[oklch(14%_0_0)] overflow-hidden text-[12px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[oklch(22%_0_0)] bg-[oklch(16%_0_0)]">
        <span className="text-[oklch(65%_0.18_270)] font-mono font-semibold">{toolName}</span>
        {isStreaming && (
          <span className="text-[oklch(42%_0_0)] animate-pulse">执行中…</span>
        )}
      </div>

      {toolInput && (
        <div className="px-3 py-2 font-mono text-[oklch(50%_0_0)] truncate">
          {JSON.stringify(toolInput).slice(0, 120)}
        </div>
      )}

      {toolOutput && (
        <div className="px-3 py-2 font-mono text-[oklch(60%_0_0)] border-t border-[oklch(22%_0_0)] max-h-24 overflow-y-auto">
          {toolOutput.slice(0, 300)}
          {toolOutput.length > 300 && "…"}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 MessageBubble**

```tsx
// apps/console/src/components/MessageBubble.tsx
import type { ChatMessage } from "../types";
import { ToolCard } from "./ToolCard";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const { role, content, toolName, isStreaming } = message;

  if (toolName) return <ToolCard message={message} />;

  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-[oklch(65%_0.18_270)] text-white rounded-br-sm"
            : "bg-[oklch(18%_0_0)] text-[oklch(88%_0_0)] rounded-bl-sm border border-[oklch(22%_0_0)]",
        ].join(" ")}
      >
        <span className="whitespace-pre-wrap break-words">{content}</span>
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-1 bg-current opacity-70 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证 TS 无报错**

```bash
cd apps/console && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/MessageBubble.tsx apps/console/src/components/ToolCard.tsx
git commit -m "feat(console): add MessageBubble and ToolCard"
```

---

## Task 6: ChatPane 组件

**Files:**
- Create: `apps/console/src/components/ChatPane.tsx`

- [ ] **Step 1: 创建 ChatPane**

```tsx
// apps/console/src/components/ChatPane.tsx
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
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
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <p className="text-[oklch(40%_0_0)] text-sm">向 AgentOS 发送指令</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  disabled={!isConnected}
                  className="text-left text-[13px] text-[oklch(55%_0_0)] border border-[oklch(22%_0_0)] rounded-xl px-4 py-2.5 hover:border-[oklch(30%_0_0)] hover:text-[oklch(70%_0_0)] transition-colors disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-[oklch(20%_0_0)] px-4 py-3 flex gap-2 items-end"
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
          placeholder={isConnected ? "输入指令…" : "连接中…"}
          disabled={!isConnected || isStreaming}
          rows={1}
          className="flex-1 bg-[oklch(18%_0_0)] border border-[oklch(25%_0_0)] rounded-xl px-4 py-2.5 text-sm text-[oklch(88%_0_0)] placeholder-[oklch(38%_0_0)] resize-none focus:outline-none focus:border-[oklch(65%_0.18_270)] disabled:opacity-40 transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming || !isConnected}
          className="shrink-0 bg-[oklch(65%_0.18_270)] hover:bg-[oklch(70%_0.18_270)] text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TS 无报错**

```bash
cd apps/console && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/ChatPane.tsx
git commit -m "feat(console): add ChatPane component"
```

---

## Task 7: CanvasPane 组件

**Files:**
- Create: `apps/console/src/components/CanvasPane.tsx`

- [ ] **Step 1: 创建 CanvasPane**

```tsx
// apps/console/src/components/CanvasPane.tsx
import { useEffect, useState } from "react";
import type { CanvasView, PipelineState } from "../types";
import { PipelineTimeline } from "./PipelineTimeline";
import { StageCard } from "./StageCard";

const STAGES = ["SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"];

interface Props {
  view: CanvasView;
}

function PipelineView({ projectName }: { projectName: string }) {
  const [state, setState] = useState<PipelineState | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectName)}`)
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, [projectName]);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-[oklch(40%_0_0)] text-sm">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5 overflow-y-auto h-full">
      <div>
        <h2 className="text-sm font-semibold mb-1">{projectName}</h2>
        {state.next_action && (
          <p className="text-[12px] text-[oklch(42%_0_0)]">
            下一步：<span className="text-[oklch(65%_0_0)]">{state.next_action}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[oklch(22%_0_0)] bg-[oklch(16%_0_0)] p-4">
        <PipelineTimeline stages={state.stages} currentStage={state.current_stage} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {STAGES.map((stage) => (
          <StageCard
            key={stage}
            name={stage}
            stage={state.stages[stage] ?? { status: "not_started", artifacts: [] }}
          />
        ))}
      </div>
    </div>
  );
}

function IdleView() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <div className="text-4xl opacity-20">◎</div>
      <p className="text-sm text-[oklch(38%_0_0)]">
        发送指令后，<br />相关内容将在此处显示
      </p>
    </div>
  );
}

function TextView({ content, label }: { content: string; label: string }) {
  return (
    <div className="flex flex-col h-full p-5 gap-3">
      <span className="text-[11px] text-[oklch(42%_0_0)] uppercase tracking-widest">{label}</span>
      <pre className="flex-1 overflow-auto text-[12px] font-mono text-[oklch(72%_0_0)] whitespace-pre-wrap leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

export function CanvasPane({ view }: Props) {
  return (
    <div className="h-full bg-[oklch(13%_0_0)] overflow-hidden">
      {view.type === "idle" && <IdleView />}
      {view.type === "pipeline" && <PipelineView projectName={view.projectName} />}
      {view.type === "text" && <TextView content={view.content} label={view.label} />}
      {view.type === "images" && (
        <div className="p-5 text-sm text-[oklch(45%_0_0)]">
          图片预览：{view.paths.join(", ")}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证 TS 无报错**

```bash
cd apps/console && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/components/CanvasPane.tsx
git commit -m "feat(console): add CanvasPane with pipeline/text/idle views"
```

---

## Task 8: App.tsx 两栏布局 + ProjectSelector

**Files:**
- Create: `apps/console/src/components/ProjectSelector.tsx`
- Modify: `apps/console/src/App.tsx`

- [ ] **Step 1: 创建 ProjectSelector**

```tsx
// apps/console/src/components/ProjectSelector.tsx
import { useEffect, useState } from "react";
import type { Project } from "../types";

interface Props {
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function ProjectSelector({ selected, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="bg-[oklch(18%_0_0)] border border-[oklch(25%_0_0)] rounded-lg px-3 py-1.5 text-sm text-[oklch(78%_0_0)] focus:outline-none focus:border-[oklch(65%_0.18_270)] transition-colors"
    >
      <option value="">选择项目…</option>
      {projects.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name} · {p.state.current_stage}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: 重写 App.tsx 为两栏布局**

```tsx
// apps/console/src/App.tsx
import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { ChatPane } from "./components/ChatPane";
import { CanvasPane } from "./components/CanvasPane";
import { ProjectSelector } from "./components/ProjectSelector";

const WS_URL = "ws://localhost:3001/ws";

export function App() {
  const [project, setProject] = useState<string | null>(null);
  const { messages, canvas, isConnected, isStreaming, send } = useWebSocket(WS_URL);

  function handleSend(message: string) {
    send(message, project ?? undefined);
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-4 px-5 py-3 border-b border-[oklch(20%_0_0)]">
        <span className="text-sm font-semibold text-[oklch(65%_0.18_270)]">AgentOS</span>
        <ProjectSelector selected={project} onSelect={setProject} />
        <div className="ml-auto flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isConnected ? "oklch(70% 0.18 145)" : "oklch(42% 0 0)" }}
          />
          <span className="text-[11px] text-[oklch(42%_0_0)]">
            {isConnected ? "已连接" : "连接中"}
          </span>
        </div>
      </header>

      {/* Two-pane body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat */}
        <div className="w-[380px] shrink-0 border-r border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
          <ChatPane
            messages={messages}
            isStreaming={isStreaming}
            isConnected={isConnected}
            onSend={handleSend}
          />
        </div>

        {/* Right: Canvas */}
        <div className="flex-1 overflow-hidden">
          <CanvasPane view={canvas} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证 TS 无报错并构建**

```bash
cd apps/console && bunx tsc --noEmit && bun vite build
```

期望：无 TS 报错，build 成功。

- [ ] **Step 4: 启动完整 dev 环境验证 UI**

```bash
cd apps/console && bun run dev
```

打开 `http://localhost:5173`，验证：
- Header 显示项目选择器 + 连接状态
- 左栏显示建议指令
- 发送"查看c3项目状态" → 左栏流式显示消息 → 右栏出现 PipelineTimeline
- 连接状态指示灯绿色

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ProjectSelector.tsx apps/console/src/App.tsx
git commit -m "feat(console): two-pane chat layout with project selector"
```

---

## Task 9: 接入真实 Claude SDK

**Files:**
- Modify: `apps/console/src/orchestrator.ts`

- [ ] **Step 1: 安装 Claude Code SDK**

```bash
cd apps/console && bun add @anthropic-ai/claude-code
```

- [ ] **Step 2: 验证 SDK 导出的 API**

```bash
node -e "const sdk = require('./node_modules/@anthropic-ai/claude-code'); console.log(Object.keys(sdk))"
```

记录输出（确认 `query` 函数名称）。如与预期不符，执行：
```bash
grep -n "export" node_modules/@anthropic-ai/claude-code/dist/index.js | head -20
```

- [ ] **Step 3: 替换 orchestrator.ts 的 runAgent 实现**

在 `apps/console/src/orchestrator.ts` 末尾，将 `export const runAgent = runMock;` 替换为：

```typescript
import { query } from "@anthropic-ai/claude-code";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dir, "../..");

export async function* runReal(message: string, project?: string): AsyncGenerator<WsEvent> {
  const cwd = project
    ? join(PROJECT_ROOT, "workspace", project)
    : PROJECT_ROOT;

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        cwd,
        // settings 会自动从 cwd/.claude/ 读取，包含 skills
      },
    })) {
      const type = (msg as { type?: string }).type;

      if (type === "assistant") {
        const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
        for (const block of content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>) {
          if (block.type === "text" && block.text) {
            // 文本按字符 yield（模拟流式）
            for (const char of block.text) {
              yield { type: "text", text: char };
            }
          }
          if (block.type === "tool_use") {
            yield { type: "tool_use", id: block.id ?? "", tool: block.name ?? "", input: block.input };
          }
        }
      }

      if (type === "tool") {
        const t = msg as { tool_use_id?: string; tool_name?: string; content?: string };
        yield {
          type: "tool_result",
          id: t.tool_use_id ?? "",
          tool: t.tool_name ?? "",
          output: t.content ?? "",
          path: extractPath(t.content ?? ""),
        };
      }

      if (type === "result") {
        const r = msg as { subtype?: string; duration_ms?: number };
        yield { type: "result", exitCode: r.subtype === "error" ? 1 : 0, duration: r.duration_ms ?? 0 };
      }
    }
  } catch (err) {
    yield { type: "error", message: String(err) };
  }
}

function extractPath(content: string): string | undefined {
  // 从工具输出中提取文件路径（工具参数由 tool_use 携带，这里提取 Read 输出的路径标记）
  const m = content.match(/(?:workspace|output)\/[^\s"]+/);
  return m?.[0];
}

export const runAgent = runReal;
```

> **注意**：Claude Code SDK 的消息格式需根据 Step 2 的实际输出微调。`runMock` 保留在文件中，切换只需改最后一行。

- [ ] **Step 4: 设置 ANTHROPIC_API_KEY 并测试**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd apps/console && bun server.ts
```

在浏览器 `http://localhost:5173` 发送 "查看 c3 项目状态"，验证：
- 左栏出现真实 Claude 回复（流式）
- 右栏 Canvas 在 Claude 读取 pipeline-state.json 后更新

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/orchestrator.ts
git commit -m "feat(console): wire real Claude SDK in orchestrator"
```

---

## 验证清单

完成所有 Task 后，逐项确认：

- [ ] `bun run dev` 启动无报错
- [ ] Header 项目选择器显示 workspace/ 下所有项目
- [ ] 左栏连接指示灯绿色
- [ ] 发送消息后文字流式追加
- [ ] tool_use 显示工具卡片（含工具名 + 参数）
- [ ] tool_result 触发右栏 Canvas 更新
- [ ] `pipeline-state.json` 路径 → Canvas 显示 PipelineTimeline
- [ ] 输入框 Enter 发送，Shift+Enter 换行
- [ ] 连接断开时输入框 disabled
