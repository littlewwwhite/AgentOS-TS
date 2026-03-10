"use client";

import { useEffect } from "react";
import { LoaderIcon } from "lucide-react";
import type { ChatMessage } from "@/lib/to-chat-messages";

export function Chat({
  messages,
  isLoading,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
}) {
  useEffect(() => {
    const chatContainer = document.getElementById("chat-container");
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }, [messages]);

  return (
    <div id="chat-container" className="flex max-h-full flex-col gap-2 overflow-y-auto pb-12">
      {messages.map((message, index) => (
        <div
          className={`flex flex-col whitespace-pre-wrap px-4 shadow-sm ${
            message.role !== "user"
              ? "w-full gap-4 rounded-2xl border bg-accent py-4 font-serif text-accent-foreground dark:bg-white/5 dark:text-muted-foreground"
              : "w-fit gap-2 rounded-xl bg-gradient-to-b from-black/5 to-black/10 py-2 font-serif dark:from-black/30 dark:to-black/50"
          }`}
          key={`${message.role}-${index}`}
        >
          {message.content.map((content, contentIndex) => {
            if (content.type === "text") {
              return <span key={`${index}-${contentIndex}`}>{content.text}</span>;
            }
            return null;
          })}
        </div>
      ))}
      {isLoading ? (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <LoaderIcon strokeWidth={2} className="h-4 w-4 animate-spin" />
          <span>Generating...</span>
        </div>
      ) : null}
    </div>
  );
}
