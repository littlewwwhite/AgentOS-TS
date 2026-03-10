"use client";

import { Button } from "@/components/ui/button";
import type { FileTreeNode } from "@/hooks/use-file-tree";
import { cn } from "@/lib/utils";

export interface FileBrowserProps {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  onSelectPath(path: string): void;
  onRefresh(): void;
  loading: boolean;
  error: string | null;
}

function countFiles(nodes: FileTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === "file") {
      return count + 1;
    }
    return count + countFiles(node.children);
  }, 0);
}

function FileNode({
  node,
  selectedPath,
  onSelectPath,
}: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelectPath(path: string): void;
}) {
  const isSelected = selectedPath === node.path;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (node.type === "file") {
            onSelectPath(node.path);
          }
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
          node.type === "dir"
            ? "cursor-default border-transparent text-muted-foreground"
            : "border-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
          isSelected && "border-input bg-muted text-foreground",
        )}
      >
        <span className="inline-flex min-w-10 justify-center rounded-md border bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {node.type}
        </span>
        <span className="truncate font-mono text-[12px]">{node.name}</span>
      </button>
      {node.children.length > 0 ? (
        <ul className="ml-4 mt-1 space-y-1 border-l pl-3">
          {node.children.map((child) => (
            <FileNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FileBrowser({
  nodes,
  selectedPath,
  onSelectPath,
  onRefresh,
  loading,
  error,
}: FileBrowserProps) {
  const fileCount = countFiles(nodes);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 px-2">
        <div className="text-sm text-muted-foreground">{fileCount} files</div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="rounded-xl border bg-background px-4 py-6 text-sm text-muted-foreground">
          Loading workspace tree...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive-foreground">
          {error}
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-background px-4 py-6 text-sm text-muted-foreground">
          No workspace files available yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-background px-3 py-3">
          <ul className="space-y-1">
            {nodes.map((node) => (
              <FileNode
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelectPath={onSelectPath}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
