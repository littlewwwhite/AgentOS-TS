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

export function ActivityFeed({ items }: ActivityFeedProps) {
  const activityItems = items.filter(
    (item) => item.kind !== "user" && item.kind !== "assistant",
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-3 px-2 text-sm text-muted-foreground">
        {activityItems.length} events
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2">
          {activityItems.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-background px-4 py-6 text-sm text-muted-foreground">
              No tool or system activity yet.
            </div>
          ) : (
            activityItems.map((item) => {
              const detail = item.kind === "tool_log" ? formatDetail(item.detail) : null;

              if (item.kind === "tool_use") {
                return (
                  <div key={item.id} className="rounded-xl border bg-background px-4 py-3">
                    <div className="text-xs text-muted-foreground">Tool</div>
                    <div className="mt-1 text-sm text-foreground">{item.tool}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {item.toolCallId}
                    </div>
                  </div>
                );
              }

              if (item.kind === "tool_log") {
                return (
                  <div key={item.id} className="rounded-xl border bg-background px-4 py-3">
                    <div className="text-xs text-muted-foreground">Tool Log</div>
                    <div className="mt-1 text-sm text-foreground">
                      {item.tool} · {item.phase}
                    </div>
                    {detail ? (
                      <pre className="mt-3 overflow-x-auto rounded-md border bg-muted px-3 py-3 text-xs leading-6 text-muted-foreground">
                        {detail}
                      </pre>
                    ) : null}
                  </div>
                );
              }

              if (item.kind === "result") {
                return (
                  <div key={item.id} className="rounded-xl border bg-background px-4 py-3">
                    <div className="text-xs text-muted-foreground">Result</div>
                    <div className="mt-1 text-sm text-foreground">
                      {item.isError ? "Failed" : "Completed"}
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      ${item.cost.toFixed(2)} · {item.durationMs}ms
                    </div>
                  </div>
                );
              }

              return (
                <div key={item.id} className="rounded-xl border bg-background px-4 py-3">
                  <div className="text-xs text-muted-foreground">System</div>
                  <div className="mt-1 text-sm text-foreground">{item.text}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
