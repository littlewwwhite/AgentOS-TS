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
