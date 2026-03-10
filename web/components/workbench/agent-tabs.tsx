"use client";

import { cn } from "@/lib/utils";

export interface AgentTabsProps {
  agents: string[];
  activeAgent: string | null;
  selectedAgent: string;
  onSelect(agent: string): void;
}

export function AgentTabs({
  agents,
  activeAgent,
  selectedAgent,
  onSelect,
}: AgentTabsProps) {
  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto">
      {agents.map((agent) => {
        const isSelected = selectedAgent === agent;
        const isActive = activeAgent === agent;
        return (
          <button
            key={agent}
            type="button"
            onClick={() => onSelect(agent)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              isSelected && "border-muted bg-muted text-foreground",
            )}
          >
            <span
              className={cn(
                "inline-flex h-1.5 w-1.5 rounded-full bg-border",
                isActive && "bg-[#ff8800]",
              )}
            />
            {agent}
          </button>
        );
      })}
    </div>
  );
}
