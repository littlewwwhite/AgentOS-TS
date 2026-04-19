// apps/console/src/App.tsx
import { useWebSocket } from "./hooks/useWebSocket";
import { ChatPane } from "./components/Chat/ChatPane";
import { ProjectProvider, useProject } from "./contexts/ProjectContext";
import { TabsProvider } from "./contexts/TabsContext";
import { ProjectSwitcher } from "./components/Navigator/ProjectSwitcher";
import { Viewer } from "./components/Viewer/Viewer";
import { Navigator } from "./components/Navigator/Navigator";

const WS_URL = "ws://localhost:3001/ws";

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

  const statusLabel = !isConnected ? "离线" : isStreaming ? "流式中" : "已连接";
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
            <span className="italic text-[var(--color-ink-faint)]">— 选择项目</span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ProjectSwitcher selected={name} onSelect={setName} />
          <div
            className="flex items-center gap-3"
            role="status"
            aria-live="polite"
            aria-label={`连接状态：${statusLabel}`}
          >
            <span
              className="w-[6px] h-[6px]"
              style={{ backgroundColor: statusColor }}
              aria-hidden
            />
            <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
              {statusLabel}
            </span>
          </div>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[260px] shrink-0 border-r border-[var(--color-rule)] flex flex-col overflow-hidden">
          <Navigator />
        </div>
        <div className="flex-1 overflow-hidden">
          <Viewer />
        </div>
        <div className="w-[480px] shrink-0 border-l border-[var(--color-rule)] flex flex-col overflow-hidden">
          <ChatPane messages={messages} isStreaming={isStreaming} isConnected={isConnected} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ProjectProvider>
      <TabsProvider>
        <Shell />
      </TabsProvider>
    </ProjectProvider>
  );
}
