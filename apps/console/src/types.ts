export type StageStatus =
  | "not_started"
  | "running"
  | "partial"
  | "completed"
  | "validated"
  | "failed";

export interface StageState {
  status: StageStatus;
  artifacts: string[];
}

export interface EpisodeState {
  video?: { status: StageStatus; generated?: number; failed?: number };
  storyboard?: { status: StageStatus; artifact?: string };
  editing?: { status: StageStatus };
  music?: { status: StageStatus };
  subtitle?: { status: StageStatus };
}

export interface PipelineState {
  version: number;
  updated_at: string;
  current_stage: string;
  next_action: string;
  last_error: string | null;
  stages: Record<string, StageState>;
  episodes: Record<string, EpisodeState>;
}

export interface Project {
  name: string;
  state: PipelineState;
}

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
