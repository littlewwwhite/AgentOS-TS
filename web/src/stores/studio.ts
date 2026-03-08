// input: UI events (file selection, messages, agent state changes)
// output: Reactive state for all three panels
// pos: Central state management — single zustand store with slices

import { create } from "zustand";
import type { FileNode, ChatMessage, AgentStatus } from "@/lib/types";
import { MOCK_FILE_TREE, MOCK_MESSAGES, MOCK_AGENTS } from "@/lib/mock-data";

interface WorkspaceSlice {
  files: FileNode[];
  selectedPath: string | null;
  expandedDirs: Set<string>;
  selectFile: (path: string | null) => void;
  toggleDir: (path: string) => void;
}

interface ConversationSlice {
  messages: ChatMessage[];
  inputValue: string;
  isStreaming: boolean;
  setInput: (value: string) => void;
  sendMessage: (content: string) => void;
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

type StudioStore = WorkspaceSlice & ConversationSlice & PipelineSlice & PanelSlice;

export const useStudioStore = create<StudioStore>((set) => ({
  // Workspace
  files: MOCK_FILE_TREE,
  selectedPath: null,
  expandedDirs: new Set(["draft", "draft/episodes", "assets", "assets/characters"]),
  selectFile: (path) => set({ selectedPath: path }),
  toggleDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { expandedDirs: next };
    }),

  // Conversation
  messages: MOCK_MESSAGES,
  inputValue: "",
  isStreaming: false,
  setInput: (value) => set({ inputValue: value }),
  sendMessage: (content) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, msg],
      inputValue: "",
      isStreaming: true,
    }));
    // Simulate agent response after delay
    setTimeout(() => {
      const reply: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        agent: "script-writer",
        content: `Processing: "${content.slice(0, 60)}..."`,
        timestamp: Date.now(),
      };
      set((state) => ({
        messages: [...state.messages, reply],
        isStreaming: false,
      }));
    }, 1500);
  },

  // Pipeline
  agents: MOCK_AGENTS,
  activeStage: null,
  setActiveStage: (stage) => set({ activeStage: stage }),

  // Panels
  conversationCollapsed: false,
  toggleConversation: () =>
    set((state) => ({ conversationCollapsed: !state.conversationCollapsed })),
}));
