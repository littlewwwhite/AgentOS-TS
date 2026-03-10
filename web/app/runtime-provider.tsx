"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type FileTreeNode, useFileTree } from "@/hooks/use-file-tree";
import {
  getServerBaseUrl,
  useSandboxConnection,
  type TransportState,
} from "@/hooks/use-sandbox-connection";
import type { SandboxCommand } from "@/lib/protocol";
import {
  createInitialUiState,
  reduceSandboxEvent,
  type TimelineItem,
  type UiState,
} from "@/lib/reduce-sandbox-event";
import { toChatMessages, type ChatMessage } from "@/lib/to-chat-messages";

type AgentOsContextValue = {
  projectId: string;
  uiState: UiState;
  selectedPreviewPath: string | null;
  setSelectedPreviewPath(path: string | null): void;
  setSelectedAgent(agent: string): void;
  fileTree: FileTreeNode[];
  fileTreeLoading: boolean;
  fileTreeError: string | null;
  refreshFiles(): Promise<void>;
  transportState: TransportState;
  sendCommand(cmd: SandboxCommand): Promise<void>;
  currentTimeline: TimelineItem[];
  serverBaseUrl: string;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  submitPrompt(text: string): Promise<void>;
  stopPrompt(): Promise<void>;
};

const AgentOsContext = createContext<AgentOsContextValue | null>(null);

export function AgentOsRuntimeProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const [uiState, setUiState] = useState<UiState>(createInitialUiState);
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const serverBaseUrl = getServerBaseUrl();

  const { transportState, sendCommand } = useSandboxConnection({
    projectId,
    onEvent: (event) => {
      setUiState((current) => reduceSandboxEvent(current, event));
    },
    onStateChange: (nextState) => {
      setUiState((current) => {
        if (nextState === "connected") {
          return current;
        }
        return {
          ...current,
          connection: nextState === "error" ? "error" : nextState,
        };
      });
    },
  });

  const { tree, loading, error, refresh } = useFileTree(
    projectId,
    uiState.connection === "ready",
    "/home/user/app/workspace",
  );

  const resultCount = useMemo(
    () =>
      Object.values(uiState.sessions).reduce(
        (count, session) =>
          count + session.messages.filter((message) => message.kind === "result").length,
        0,
      ),
    [uiState.sessions],
  );

  useEffect(() => {
    if (uiState.connection !== "ready") {
      return;
    }
    void refresh();
  }, [uiState.connection, refresh, resultCount]);

  const currentSession = uiState.sessions[uiState.selectedAgent] ?? {
    messages: [],
    status: "idle" as const,
  };
  const currentTimeline = currentSession.messages;
  const chatMessages = useMemo(() => toChatMessages(currentTimeline), [currentTimeline]);

  const appendUserMessage = useCallback((text: string) => {
    setUiState((current) => {
      const sessionKey = current.selectedAgent;
      const session = current.sessions[sessionKey] ?? {
        messages: [],
        status: "idle" as const,
      };

      return {
        ...current,
        nextId: current.nextId + 1,
        sessions: {
          ...current.sessions,
          [sessionKey]: {
            ...session,
            status: "busy",
            messages: [
              ...session.messages,
              {
                kind: "user",
                id: `user-${sessionKey}-${current.nextId}`,
                text,
                createdAt: Date.now(),
              },
            ],
          },
        },
      };
    });
  }, []);

  const submitPrompt = useCallback(
    async (text: string) => {
      const nextText = text.trim();
      if (!nextText) {
        return;
      }

      appendUserMessage(nextText);

      try {
        await sendCommand({
          cmd: "chat",
          message: nextText,
          ...(uiState.selectedAgent !== "main"
            ? { target: uiState.selectedAgent }
            : {}),
        });
      } catch (submitError) {
        setUiState((current) => ({
          ...current,
          connection: "error",
          lastError:
            submitError instanceof Error ? submitError.message : String(submitError),
        }));
      }
    },
    [appendUserMessage, sendCommand, uiState.selectedAgent],
  );

  const stopPrompt = useCallback(async () => {
    try {
      await sendCommand({ cmd: "interrupt" });
    } catch (stopError) {
      setUiState((current) => ({
        ...current,
        connection: "error",
        lastError: stopError instanceof Error ? stopError.message : String(stopError),
      }));
    }
  }, [sendCommand]);

  const value = useMemo<AgentOsContextValue>(
    () => ({
      projectId,
      uiState,
      selectedPreviewPath,
      setSelectedPreviewPath,
      setSelectedAgent: (agent: string) => {
        setUiState((current) => ({
          ...current,
          selectedAgent: agent,
        }));
      },
      fileTree: tree,
      fileTreeLoading: loading,
      fileTreeError: error,
      refreshFiles: refresh,
      transportState,
      sendCommand,
      currentTimeline,
      serverBaseUrl,
      chatMessages,
      isChatLoading: currentSession.status === "busy",
      submitPrompt,
      stopPrompt,
    }),
    [
      chatMessages,
      currentSession.status,
      currentTimeline,
      error,
      loading,
      projectId,
      refresh,
      selectedPreviewPath,
      sendCommand,
      serverBaseUrl,
      stopPrompt,
      submitPrompt,
      transportState,
      tree,
      uiState,
    ],
  );

  return <AgentOsContext.Provider value={value}>{children}</AgentOsContext.Provider>;
}

export function useAgentOsRuntime(): AgentOsContextValue {
  const context = useContext(AgentOsContext);
  if (!context) {
    throw new Error("useAgentOsRuntime must be used within AgentOsRuntimeProvider");
  }
  return context;
}
