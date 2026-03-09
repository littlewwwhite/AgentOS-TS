// input: Agent file policy definitions from backend
// output: TypeScript types and constants for the frontend
// pos: Shared type definitions bridging backend agent model to UI

export type FileStatus = "done" | "active" | "error" | "pending";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  status: FileStatus;
  children?: FileNode[];
}

export interface PipelineStage {
  id: string;
  label: string;
  agents: string[];
  folders: string[];
  icon: "draft" | "assets" | "production" | "output";
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  agent?: string;
  timestamp: number;
}

export interface AgentStatus {
  name: string;
  state: "idle" | "working" | "done" | "error";
  progress?: string;
}

// Maps directly from src/agents.ts filePolicy
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "draft",
    label: "Draft",
    agents: ["script-writer", "script-adapt"],
    folders: ["draft", "source.txt", "design.json", "catalog.json"],
    icon: "draft",
  },
  {
    id: "assets",
    label: "Assets",
    agents: ["image-create", "image-edit"],
    folders: ["assets"],
    icon: "assets",
  },
  {
    id: "production",
    label: "Production",
    agents: ["video-create", "video-review"],
    folders: ["production", "storyboard"],
    icon: "production",
  },
  {
    id: "output",
    label: "Output",
    agents: ["music-finder", "music-matcher"],
    folders: ["editing", "audio", "output"],
    icon: "output",
  },
];

// ---------- Sandbox Events (SSE → frontend) ----------

export type SandboxEvent =
  | { type: "ready"; skills: string[] }
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string; id: string }
  | { type: "result"; cost: number; duration_ms: number; session_id: string; is_error: boolean }
  | { type: "error"; message: string }
  | { type: "status"; state: "idle" | "busy" | "disconnected"; session_id?: string }
  | { type: "skills"; skills: Record<string, string> };

export type SandboxConnectionState = "disconnected" | "connecting" | "ready" | "error";

// ---------- Content ----------

export type ContentType = "markdown" | "json" | "image" | "video" | "audio" | "text" | "unknown";

export function inferContentType(filename: string): ContentType {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md") return "markdown";
  if (ext === "json") return "json";
  if (["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";
  if (["txt", "log"].includes(ext)) return "text";
  return "unknown";
}
