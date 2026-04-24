import type { StageName } from "./lib/workflowModel";

export type StageStatus =
  | "not_started"
  | "running"
  | "partial"
  | "completed"
  | "validated"
  | "failed"
  | "in_review"
  | "approved"
  | "locked"
  | "change_requested"
  | "stale"
  | "superseded";

export type ArtifactKind = "source" | "canonical" | "derived" | "control";

export type ChangeRequestStatus = "open" | "accepted" | "rejected" | "resolved";

export interface StageState {
  status: StageStatus;
  artifacts: string[];
  updated_at?: string | null;
  notes?: string | null;
  owner_role?: string;
  revision?: number;
  locked?: boolean;
}

export interface EpisodeState {
  video?: { status: StageStatus; generated?: number; failed?: number };
  storyboard?: { status: StageStatus; artifact?: string };
  editing?: { status: StageStatus };
  music?: { status: StageStatus };
  subtitle?: { status: StageStatus };
}

export interface ArtifactState {
  kind: ArtifactKind;
  owner_role: string;
  status: StageStatus;
  editable: boolean;
  revision: number;
  depends_on: string[];
  invalidates: string[];
  updated_at?: string | null;
  notes?: string | null;
}

export interface ChangeRequest {
  id: string;
  target_artifact: string;
  requested_by_role: string;
  reason: string;
  created_at: string;
  status: ChangeRequestStatus;
}

export interface PipelineState {
  version: number;
  updated_at: string;
  current_stage: StageName | string;
  next_action: string;
  last_error: string | null;
  stages: Record<string, StageState>;
  episodes: Record<string, EpisodeState>;
  artifacts?: Record<string, ArtifactState>;
  change_requests?: ChangeRequest[];
}

export interface Project {
  name: string;
  state: PipelineState;
}

// WebSocket 事件（服务端 → 前端）
export type WsEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "slash_commands"; commands: string[] }
  | { type: "tool_use"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; tool: string; output: string; path?: string }
  | { type: "result"; exitCode: number; duration: number }
  | { type: "system"; subtype: string; data: unknown }
  | { type: "error"; message: string };

// 对话消息（前端渲染用）
export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  kind?: "text" | "thinking";
  isStreaming?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  timestamp: number;
}

// Navigator tree node (from server tree endpoint)
export interface TreeNode {
  path: string;
  name: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
}

// Viewer tab state
export type ViewKind =
  | "overview"
  | "script"
  | "storyboard"
  | "asset-gallery"
  | "video-grid"
  | "image"
  | "video"
  | "text"
  | "json"
  | "fallback";

export interface Tab {
  id: string;           // unique
  path: string;         // project-relative; "" means project root
  title: string;        // display in tab bar
  view: ViewKind;       // resolved kind
  pinned: boolean;      // true = user-pinned; false = preview tab
}

// Weak-follow signal from WS tool_result
export interface FollowSignal {
  path: string;         // project-relative
  timestamp: number;
}
