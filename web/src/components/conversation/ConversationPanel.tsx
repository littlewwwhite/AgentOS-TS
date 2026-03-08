// input: Chat messages and user input from conversation store
// output: Streaming chat panel with agent status indicator
// pos: Right panel — conversation interface and agent activity log

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PaperPlaneRight,
  Robot,
  User,
  Info,
  SidebarSimple,
  CircleNotch,
} from "@phosphor-icons/react";
import { useStudioStore } from "@/stores/studio";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

function MessageBubble({ message }: { message: ChatMessage }) {
  const roleStyles: Record<ChatMessage["role"], string> = {
    user: "bg-secondary",
    agent: "bg-brand-surface border-l-2 border-ring",
    system: "bg-transparent border border-border",
  };

  const roleIcons: Record<ChatMessage["role"], React.ReactNode> = {
    user: <User weight="bold" className="size-3.5" />,
    agent: <Robot weight="bold" className="size-3.5" />,
    system: <Info weight="bold" className="size-3.5" />,
  };

  const timeStr = new Date(message.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn("rounded-lg px-3 py-2.5", roleStyles[message.role])}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-muted-foreground">{roleIcons[message.role]}</span>
        {message.agent && (
          <span className="font-mono text-[11px] font-medium text-primary">
            {message.agent}
          </span>
        )}
        {message.role === "user" && (
          <span className="text-[11px] font-medium text-muted-foreground">You</span>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
          {timeStr}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/70">
        {message.content}
      </p>
    </motion.div>
  );
}

function ActiveAgentBar() {
  const agents = useStudioStore((s) => s.agents);
  const activeAgent = agents.find((a) => a.state === "working");

  return (
    <AnimatePresence>
      {activeAgent && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-border bg-brand-surface px-3 py-1.5">
            <CircleNotch weight="bold" className="size-3.5 animate-spin text-primary" />
            <span className="font-mono text-[12px] font-medium text-primary">
              {activeAgent.name}
            </span>
            {activeAgent.progress && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {activeAgent.progress}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConversationPanel() {
  const messages = useStudioStore((s) => s.messages);
  const inputValue = useStudioStore((s) => s.inputValue);
  const isStreaming = useStudioStore((s) => s.isStreaming);
  const setInput = useStudioStore((s) => s.setInput);
  const sendMessage = useStudioStore((s) => s.sendMessage);
  const toggleConversation = useStudioStore((s) => s.toggleConversation);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Conversation
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={toggleConversation}>
              <SidebarSimple weight="bold" className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle Panel</TooltipContent>
        </Tooltip>
      </div>

      <ActiveAgentBar />

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="flex flex-col gap-2.5 px-2.5 py-3">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isStreaming && (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
              <CircleNotch weight="bold" className="size-3.5 animate-spin" />
              <span className="text-[12px]">Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2 transition-colors focus-within:border-ring/50">
          <textarea
            value={inputValue}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            className={cn(
              "max-h-32 min-h-[20px] flex-1 resize-none bg-transparent text-[13px]",
              "text-foreground placeholder:text-muted-foreground outline-none"
            )}
          />
          <Button
            type="submit"
            size="icon-xs"
            disabled={!inputValue.trim() || isStreaming}
          >
            <PaperPlaneRight weight="fill" className="size-3.5" />
          </Button>
        </div>
      </form>
    </div>
  );
}
