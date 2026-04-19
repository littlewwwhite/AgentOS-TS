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
  const { name, setName } = useProject();
  const { messages, isConnected, isStreaming, send } = useWebSocket(WS_URL);

  function handleSend(message: string) {
    send(message, name ?? undefined);
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center gap-4 px-5 py-3 border-b border-[oklch(20%_0_0)]">
        <span className="text-sm font-semibold text-[oklch(65%_0.18_270)]">AgentOS</span>
        <ProjectSwitcher selected={name} onSelect={setName} />
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
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[260px] shrink-0 border-r border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
          <Navigator />
        </div>
        <div className="flex-1 overflow-hidden">
          <Viewer />
        </div>
        <div className="w-[380px] shrink-0 border-l border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
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
