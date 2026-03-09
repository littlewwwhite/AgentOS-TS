// input: UI events, SSE events from API layer
// output: Reactive state for all panels + sandbox lifecycle
// pos: Central state management — Zustand store bridging API and UI

import { create } from "zustand";
import type {
  FileNode,
  ChatMessage,
  AgentStatus,
  SandboxEvent,
  SandboxConnectionState,
} from "@/lib/types";
import * as api from "@/lib/api";

// ---------- Slice interfaces ----------

interface WorkspaceSlice {
  files: FileNode[];
  selectedPath: string | null;
  expandedDirs: Set<string>;
  fileContent: string | null;
  fileLoading: boolean;
  selectFile: (path: string | null) => void;
  toggleDir: (path: string) => void;
  loadFiles: () => Promise<void>;
  loadFileContent: (path: string) => Promise<void>;
}

interface ConversationSlice {
  messages: ChatMessage[];
  inputValue: string;
  isStreaming: boolean;
  streamingContent: string;
  streamingMessageId: string | null;
  streamingTimer: ReturnType<typeof setTimeout> | null;
  setInput: (value: string) => void;
  sendMessage: (content: string) => void;
}

interface SandboxSlice {
  sandboxId: string | null;
  sandboxState: SandboxConnectionState;
  startSandbox: () => Promise<void>;
  destroySandbox: () => Promise<void>;
  dispatchEvent: (event: SandboxEvent) => void;
}

interface PipelineSlice {
  agents: AgentStatus[];
  activeStage: string | null;
  setActiveStage: (stage: string | null) => void;
}

interface PanelSlice {
  conversationCollapsed: boolean;
  toggleConversation: () => void;
}

type StudioStore = WorkspaceSlice &
  ConversationSlice &
  SandboxSlice &
  PipelineSlice &
  PanelSlice;

// ---------- Store ----------

export const useStudioStore = create<StudioStore>((set, get) => ({
  // ── Workspace ──────────────────────────────────────────────
  files: [],
  selectedPath: null,
  expandedDirs: new Set<string>(),
  fileContent: null,
  fileLoading: false,

  selectFile: (path) => {
    set({ selectedPath: path, fileContent: null });
    if (path) {
      get().loadFileContent(path);
    }
  },

  toggleDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs);
      next.has(path) ? next.delete(path) : next.add(path);
      return { expandedDirs: next };
    }),

  loadFiles: async () => {
    const files = await api.fetchFileTree();
    set({ files });
  },

  loadFileContent: async (path) => {
    set({ fileLoading: true });
    try {
      const { content } = await api.fetchFileContent(path);
      if (get().selectedPath === path) {
        set({ fileContent: content, fileLoading: false });
      }
    } catch {
      set({ fileLoading: false });
    }
  },

  // ── Conversation ───────────────────────────────────────────
  messages: [],
  inputValue: "",
  isStreaming: false,
  streamingContent: "",
  streamingMessageId: null,
  streamingTimer: null,
  setInput: (value) => set({ inputValue: value }),

  sendMessage: (content) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    // Clear any existing streaming timeout
    const prevTimer = get().streamingTimer;
    if (prevTimer) clearTimeout(prevTimer);
    // Set a 90s timeout to recover from missing result/error events
    const timer = setTimeout(() => {
      if (get().isStreaming) {
        const { streamingMessageId: smId, streamingContent: sc } = get();
        if (smId) {
          set({
            messages: get().messages.map((m) =>
              m.id === smId ? { ...m, content: sc || "(No response received)" } : m,
            ),
            streamingContent: "",
            streamingMessageId: null,
            isStreaming: false,
            streamingTimer: null,
          });
        } else {
          set({ isStreaming: false, streamingTimer: null });
        }
      }
    }, 90_000);
    set((state) => ({
      messages: [...state.messages, msg],
      inputValue: "",
      isStreaming: true,
      streamingTimer: timer,
    }));
    api.sendChat(content).catch((err) => {
      if (timer) clearTimeout(timer);
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: crypto.randomUUID(),
            role: "system" as const,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          },
        ],
        isStreaming: false,
        streamingTimer: null,
      }));
    });
  },

  // ── Sandbox ────────────────────────────────────────────────
  sandboxId: null,
  sandboxState: "disconnected",

  startSandbox: async () => {
    set({ sandboxState: "connecting" });
    try {
      const { sandboxId } = await api.startSandbox();
      set({ sandboxId, sandboxState: "connecting" });
    } catch (err) {
      set({
        sandboxState: "error",
        messages: [
          ...get().messages,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Failed to start sandbox: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          },
        ],
      });
    }
  },

  destroySandbox: async () => {
    await api.destroySandbox();
    set({ sandboxId: null, sandboxState: "disconnected" });
  },

  dispatchEvent: (event) => {
    const { messages } = get();

    switch (event.type) {
      case "text": {
        const { streamingMessageId } = get();
        if (!streamingMessageId) {
          // First chunk — create agent message shell + start streaming
          const id = crypto.randomUUID();
          set({
            messages: [
              ...messages,
              { id, role: "agent" as const, content: "", timestamp: Date.now() },
            ],
            streamingMessageId: id,
            streamingContent: event.text,
            isStreaming: true,
          });
        } else {
          // Subsequent chunks — only concat string, no array copy
          set((state) => ({
            streamingContent: state.streamingContent + event.text,
          }));
        }
        break;
      }

      case "result": {
        const { streamingMessageId: smId, streamingContent: sc, streamingTimer: rt } = get();
        if (rt) clearTimeout(rt);
        if (smId) {
          set({
            messages: get().messages.map((m) =>
              m.id === smId ? { ...m, content: sc } : m,
            ),
            streamingContent: "",
            streamingMessageId: null,
            isStreaming: false,
            streamingTimer: null,
          });
        } else {
          set({ isStreaming: false, streamingTimer: null });
        }
        get().loadFiles();
        break;
      }

      case "error": {
        const { streamingTimer: et } = get();
        if (et) clearTimeout(et);
        set({
          isStreaming: false,
          streamingContent: "",
          streamingMessageId: null,
          streamingTimer: null,
          messages: [
            ...messages,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              content: event.message,
              timestamp: Date.now(),
            },
          ],
        });
        break;
      }

      case "tool_use":
        set({
          messages: [
            ...messages,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Using tool: ${event.tool}`,
              timestamp: Date.now(),
            },
          ],
        });
        break;

      case "ready":
        set({ sandboxState: "ready" });
        get().loadFiles();
        break;

      case "status":
        if (event.state === "disconnected") {
          set({ sandboxState: "disconnected" });
        } else if (event.state === "idle" || event.state === "busy") {
          // SSE initial status or heartbeat — sandbox process is alive
          if (get().sandboxState !== "ready") {
            set({ sandboxState: "ready" });
            get().loadFiles();
          }
        }
        break;
    }
  },

  // ── Pipeline ───────────────────────────────────────────────
  agents: [],
  activeStage: null,
  setActiveStage: (stage) => set({ activeStage: stage }),

  // ── Panels ─────────────────────────────────────────────────
  conversationCollapsed: false,
  toggleConversation: () =>
    set((state) => ({ conversationCollapsed: !state.conversationCollapsed })),
}));
