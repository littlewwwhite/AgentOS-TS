import type { TimelineItem } from "@/lib/reduce-sandbox-event";

export type ChatMessage = {
  role: "user" | "assistant";
  content: Array<{
    type: "text";
    text: string;
  }>;
};

export function toChatMessages(items: TimelineItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const item of items) {
    if (item.kind === "user") {
      messages.push({
        role: "user",
        content: [{ type: "text", text: item.text }],
      });
      continue;
    }

    if (item.kind === "assistant") {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: item.text }],
      });
    }
  }

  return messages;
}
