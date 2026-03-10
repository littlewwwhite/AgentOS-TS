"use client";

import type { TimelineItem } from "@/lib/reduce-sandbox-event";

export interface ActivityFeedProps {
  items: TimelineItem[];
}

function formatDetail(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) {
    return null;
  }

  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return null;
  }
}

function getLabel(item: TimelineItem): string {
  if (item.kind === "tool_use") {
    return item.tool;
  }
  if (item.kind === "tool_log") {
    return `${item.tool} · ${item.phase}`;
  }
  if (item.kind === "result") {
    return item.isError ? "Failed" : "Completed";
  }
  return "System";
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  const activityItems = items.filter(
    (item) => item.kind !== "user" && item.kind !== "assistant",
  );

  return (
    <section className="flex h-full min-h-0 flex-col px-4 py-4">
      {activityItems.length === 0 ? (
        <div className="px-2 py-6 text-sm text-muted-foreground">
          No tool or system activity yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-2">
            {activityItems.map((item) => {
              const detail = item.kind === "tool_log" ? formatDetail(item.detail) : null;

              return (
                <div key={item.id} className="rounded-lg border px-3 py-3">
                  <div className="text-xs text-muted-foreground">{item.kind}</div>
                  <div className="mt-1 text-sm text-foreground">{getLabel(item)}</div>
                  {item.kind === "tool_use" ? (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {item.toolCallId}
                    </div>
                  ) : null}
                  {item.kind === "result" ? (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      ${item.cost.toFixed(2)} · {item.durationMs}ms
                    </div>
                  ) : null}
                  {item.kind === "system" ? (
                    <div className="mt-1 text-sm text-muted-foreground">{item.text}</div>
                  ) : null}
                  {detail ? (
                    <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-3 text-xs leading-6 text-muted-foreground">
                      {detail}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
