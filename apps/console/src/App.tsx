// apps/console/src/App.tsx
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { ChatPane } from "./components/Chat/ChatPane";
import { ProjectProvider, useProject } from "./contexts/ProjectContext";
import { TabsProvider, useTabs } from "./contexts/TabsContext";
import { ProjectSwitcher } from "./components/Navigator/ProjectSwitcher";
import { Viewer } from "./components/Viewer/Viewer";
import { Navigator } from "./components/Navigator/Navigator";
import { buildWorkflowStatus } from "./lib/workflowStatus";
import { buildChatSuggestions } from "./lib/chatSuggestions";
import { buildAgentMessage } from "./lib/scopedMessage";
import { resolveProductionObjectFromPath } from "./lib/productionObject";
import {
  CHAT_PANEL_DEFAULT,
  CHAT_PANEL_STORYBOARD,
  NAVIGATOR_PANEL,
  chatPanelBoundsForMode,
  chatPanelModeForView,
  clampPanelWidth,
  fitPanelWidths,
  isChatAutoHiddenView,
  readPanelWidthValue,
  shouldRenderChatPane,
} from "./lib/panelLayout";

const WS_URL = "ws://localhost:3001/ws";
const NAVIGATOR_WIDTH_STORAGE_KEY = "agentos:layout:navigator-width";
const CHAT_WIDTH_STORAGE_KEYS = {
  default: "agentos:layout:chat-width:default",
  storyboard: "agentos:layout:chat-width:storyboard",
} as const;

function readStoredPanelWidth(storageKey: string, fallback: { min: number; max: number; default: number }) {
  if (typeof window === "undefined") return fallback.default;
  try {
    return readPanelWidthValue(window.localStorage.getItem(storageKey), fallback);
  } catch {
    return fallback.default;
  }
}

function writeStoredPanelWidth(storageKey: string, width: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    return;
  }
}

function ResizeHandle({
  label,
  onPointerDown,
  onKeyDown,
}: {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="group relative w-2 shrink-0 cursor-col-resize touch-none bg-transparent focus:outline-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--color-rule)]/70 transition-colors group-hover:bg-[var(--color-accent)] group-focus-visible:bg-[var(--color-accent)]" />
    </button>
  );
}

function Shell() {
  const { name, state, setName, noteToolPath, refresh, sessionId, setSessionId } = useProject();
  const { tabs, activeId } = useTabs();
  const { messages, isConnected, isStreaming, slashCommands, send, stop } = useWebSocket(
    WS_URL,
    noteToolPath,
    refresh,
    setSessionId,
    name,
    sessionId,
  );

  const statusLabel = !isConnected ? "离线" : isStreaming ? "处理中" : "已连接";
  const statusColor = !isConnected
    ? "var(--color-ink-faint)"
    : isStreaming
      ? "var(--color-run)"
      : "var(--color-ok)";
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const activeProductionObject = useMemo(
    () => resolveProductionObjectFromPath(activeTab?.path ?? "", { projectId: name }),
    [activeTab?.path, name],
  );

  const handleSend = useCallback((message: string) => {
    send(message, name ?? undefined, sessionId ?? undefined, {
      agentMessage: buildAgentMessage(message, activeProductionObject),
    });
  }, [activeProductionObject, name, send, sessionId]);

  useEffect(() => {
    function handleSendMessage(event: Event) {
      const message = (event as CustomEvent<{ message?: unknown }>).detail?.message;
      if (typeof message !== "string" || !message.trim()) return;
      handleSend(message);
    }

    window.addEventListener("agentos:send-message", handleSendMessage);
    return () => window.removeEventListener("agentos:send-message", handleSendMessage);
  }, [handleSend]);

  const activeView = activeTab?.view ?? "overview";
  const workflowStatus = name && state ? buildWorkflowStatus(state) : null;
  const suggestions = buildChatSuggestions({
    hasProject: !!name,
    workflowTone: workflowStatus?.tone,
    currentStage: workflowStatus?.currentStage,
  });
  const chatMode = chatPanelModeForView(activeView);
  const autoHideChatPane = isChatAutoHiddenView(activeView);
  const [isChatPaneRestored, setIsChatPaneRestored] = useState(false);
  const showChatPane = shouldRenderChatPane({
    view: activeView,
    isRestored: isChatPaneRestored,
  });
  const chatBounds = chatPanelBoundsForMode(chatMode);
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === "undefined" ? 1440 : window.innerWidth
  ));
  const [navigatorWidth, setNavigatorWidth] = useState(() => (
    readStoredPanelWidth(NAVIGATOR_WIDTH_STORAGE_KEY, NAVIGATOR_PANEL)
  ));
  const [chatWidths, setChatWidths] = useState(() => ({
    default: readStoredPanelWidth(CHAT_WIDTH_STORAGE_KEYS.default, CHAT_PANEL_DEFAULT),
    storyboard: readStoredPanelWidth(CHAT_WIDTH_STORAGE_KEYS.storyboard, CHAT_PANEL_STORYBOARD),
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    writeStoredPanelWidth(NAVIGATOR_WIDTH_STORAGE_KEY, navigatorWidth);
  }, [navigatorWidth]);

  useEffect(() => {
    writeStoredPanelWidth(CHAT_WIDTH_STORAGE_KEYS.default, chatWidths.default);
  }, [chatWidths.default]);

  useEffect(() => {
    writeStoredPanelWidth(CHAT_WIDTH_STORAGE_KEYS.storyboard, chatWidths.storyboard);
  }, [chatWidths.storyboard]);

  useEffect(() => {
    setIsChatPaneRestored(false);
  }, [activeView]);

  const activeChatWidth = chatMode === "storyboard"
    ? chatWidths.storyboard
    : chatWidths.default;
  const fittedLayout = useMemo(
    () => fitPanelWidths({
      viewportWidth,
      navigatorWidth,
      chatWidth: activeChatWidth,
      view: activeView,
    }),
    [activeChatWidth, activeView, navigatorWidth, viewportWidth],
  );

  const setChatWidthForMode = useCallback((mode: "default" | "storyboard", nextWidth: number) => {
    const bounds = chatPanelBoundsForMode(mode);
    setChatWidths((prev) => ({
      ...prev,
      [mode]: clampPanelWidth(nextWidth, bounds),
    }));
  }, []);

  const updatePanelWidth = useCallback((panel: "navigator" | "chat", nextWidth: number) => {
    if (panel === "navigator") {
      setNavigatorWidth(clampPanelWidth(nextWidth, NAVIGATOR_PANEL));
      return;
    }
    setChatWidthForMode(chatMode, nextWidth);
  }, [chatMode, setChatWidthForMode]);

  const handleResizeStart = useCallback((
    panel: "navigator" | "chat",
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = panel === "navigator"
      ? fittedLayout.navigatorWidth
      : fittedLayout.chatWidth;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const nextWidth = panel === "navigator"
        ? startWidth + deltaX
        : startWidth - deltaX;
      updatePanelWidth(panel, nextWidth);
    };

    const stopResizing = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
  }, [fittedLayout.chatWidth, fittedLayout.navigatorWidth, updatePanelWidth]);

  const handleResizeKey = useCallback((
    panel: "navigator" | "chat",
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const step = event.shiftKey ? 48 : 24;
    const currentWidth = panel === "navigator"
      ? fittedLayout.navigatorWidth
      : fittedLayout.chatWidth;
    const bounds = panel === "navigator" ? NAVIGATOR_PANEL : chatBounds;

    let nextWidth: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = panel === "navigator" ? currentWidth - step : currentWidth + step;
        break;
      case "ArrowRight":
        nextWidth = panel === "navigator" ? currentWidth + step : currentWidth - step;
        break;
      case "Home":
        nextWidth = bounds.min;
        break;
      case "End":
        nextWidth = bounds.max;
        break;
      default:
        return;
    }

    event.preventDefault();
    updatePanelWidth(panel, nextWidth);
  }, [chatBounds, fittedLayout.chatWidth, fittedLayout.navigatorWidth, updatePanelWidth]);

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
          <ProjectSwitcher selected={name} onSelect={setName} onCreateNew={() => setName(null)} />
          <div
            className="flex items-center"
            role="status"
            aria-live="polite"
            aria-label={`连接状态：${statusLabel}`}
            title={statusLabel}
          >
            <span
              className="w-[6px] h-[6px]"
              style={{ backgroundColor: statusColor }}
              aria-hidden
            />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-w-0 shrink-0 flex flex-col overflow-hidden"
          style={{ width: `${fittedLayout.navigatorWidth}px` }}
        >
          <Navigator />
        </div>
        <ResizeHandle
          label="调整左侧导航宽度"
          onPointerDown={(event) => handleResizeStart("navigator", event)}
          onKeyDown={(event) => handleResizeKey("navigator", event)}
        />
        <div className="min-w-0 flex-1 overflow-hidden">
          <Viewer />
        </div>
        {autoHideChatPane && !showChatPane && (
          <button
            type="button"
            aria-label="打开右侧对话"
            title="打开右侧对话"
            onClick={() => setIsChatPaneRestored(true)}
            className="group flex w-10 shrink-0 items-center justify-center border-l border-[var(--color-rule)] bg-[var(--color-paper-muted)] text-[12px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)] focus:outline-none focus-visible:bg-[var(--color-paper)] focus-visible:text-[var(--color-ink)]"
          >
            <span className="[writing-mode:vertical-rl]">对话</span>
          </button>
        )}
        {showChatPane && (
          <>
            <ResizeHandle
              label="调整右侧对话宽度"
              onPointerDown={(event) => handleResizeStart("chat", event)}
              onKeyDown={(event) => handleResizeKey("chat", event)}
            />
            <div
              className="relative min-w-0 shrink-0 flex flex-col overflow-hidden"
              style={{ width: `${fittedLayout.chatWidth}px` }}
            >
              {autoHideChatPane && (
                <button
                  type="button"
                  aria-label="收起右侧对话"
                  title="收起右侧对话"
                  onClick={() => setIsChatPaneRestored(false)}
                  className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center border border-[var(--color-rule)] bg-[var(--color-paper)] text-[14px] leading-none text-[var(--color-ink-muted)] shadow-[0_6px_18px_rgba(0,0,0,0.06)] hover:text-[var(--color-ink)] focus:outline-none focus-visible:border-[var(--color-accent)] focus-visible:text-[var(--color-ink)]"
                >
                  ×
                </button>
              )}
              <ChatPane
                messages={messages}
                isStreaming={isStreaming}
                isConnected={isConnected}
                onSend={handleSend}
                onStop={stop}
                suggestions={suggestions}
                slashCommands={slashCommands}
                productionObject={activeProductionObject}
              />
            </div>
          </>
        )}
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
