import type { ChatMessage, MessageRole } from "../types";

const CHAT_KEY_PREFIX = "agentos:chat:";

function isRole(value: unknown): value is MessageRole {
  return value === "user" || value === "assistant";
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ChatMessage>;
  if (typeof candidate.id !== "string") return null;
  if (!isRole(candidate.role)) return null;
  if (typeof candidate.content !== "string") return null;
  if (typeof candidate.timestamp !== "number" || !Number.isFinite(candidate.timestamp)) return null;

  return {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    isStreaming: false,
    toolName: typeof candidate.toolName === "string" ? candidate.toolName : undefined,
    toolInput: candidate.toolInput,
    toolOutput: typeof candidate.toolOutput === "string" ? candidate.toolOutput : undefined,
    timestamp: candidate.timestamp,
  };
}

export function buildChatHistoryKey(project: string, sessionId: string): string {
  return `${CHAT_KEY_PREFIX}${project}:${sessionId}`;
}

export function sanitizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({ ...message, isStreaming: false }));
}

export function parseStoredChatMessages(raw: string | null): ChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeChatMessage).filter((message): message is ChatMessage => message !== null);
  } catch {
    return [];
  }
}

export function resolveRestoredChatMessages(
  previous: ChatMessage[],
  restored: ChatMessage[],
  options: {
    sameKey: boolean;
    projectChanged: boolean;
    sessionChanged: boolean;
    bootstrappingSession: boolean;
  },
): ChatMessage[] {
  if (restored.length > 0) return restored;
  if (options.sameKey) return previous;
  if (options.bootstrappingSession) return previous;
  if (options.projectChanged || options.sessionChanged) return [];
  return previous;
}

export function readStoredChatMessages(project?: string | null, sessionId?: string | null): ChatMessage[] {
  if (typeof window === "undefined" || !project || !sessionId) return [];
  try {
    const raw = window.localStorage.getItem(buildChatHistoryKey(project, sessionId));
    return parseStoredChatMessages(raw);
  } catch {
    return [];
  }
}

export function writeStoredChatMessages(
  project: string | null | undefined,
  sessionId: string | null | undefined,
  messages: ChatMessage[],
) {
  if (typeof window === "undefined" || !project || !sessionId) return;
  try {
    const key = buildChatHistoryKey(project, sessionId);
    const sanitized = sanitizeChatMessages(messages);
    if (sanitized.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(sanitized));
  } catch {
    // ignore storage quota and privacy mode failures; in-memory chat still works
  }
}
