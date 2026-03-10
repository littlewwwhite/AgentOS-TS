// input: Session IDs + project paths from sandbox orchestrator
// output: Formatted history messages for UI rendering
// pos: Shared utility — bridges SDK session API and orchestrator display layer

import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

export const HISTORY_LIMIT_SANDBOX = 50;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Extract readable text from SDK SessionMessage.message (typed as unknown). */
export function extractText(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const obj = message as Record<string, unknown>;
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.content)) {
    return obj.content
      .filter(
        (b: unknown) =>
          typeof b === "object" &&
          b !== null &&
          (b as Record<string, unknown>).type === "text",
      )
      .map((b: unknown) => String((b as Record<string, unknown>).text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Fetch history from SDK. Never throws — returns [] on failure. */
export async function fetchHistory(
  sessionId: string,
  dir: string,
  limit: number,
): Promise<HistoryMessage[]> {
  try {
    const msgs = await getSessionMessages(sessionId, { dir, limit });
    return msgs
      .map((m) => ({
        role: m.type as "user" | "assistant",
        content: extractText(m.message),
      }))
      .filter((m) => m.content.length > 0);
  } catch {
    return [];
  }
}
