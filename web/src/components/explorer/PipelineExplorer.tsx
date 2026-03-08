// input: File tree data from workspace store
// output: Collapsible tree view organized by pipeline stages
// pos: Left panel — navigation and status overview

import { useMemo } from "react";
import {
  CaretRight,
  File,
  Folder,
  FolderOpen,
  Check,
  CircleNotch,
  Warning,
  Minus,
} from "@phosphor-icons/react";
import { useStudioStore } from "@/stores/studio";
import { PIPELINE_STAGES, type FileNode, type FileStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

function StatusDot({ status }: { status: FileStatus }) {
  const styles: Record<FileStatus, string> = {
    done: "text-status-done",
    active: "text-status-active",
    error: "text-status-error",
    pending: "text-status-pending",
  };
  const icons: Record<FileStatus, React.ReactNode> = {
    done: <Check weight="bold" className="size-3" />,
    active: <CircleNotch weight="bold" className="size-3 animate-spin" />,
    error: <Warning weight="bold" className="size-3" />,
    pending: <Minus weight="bold" className="size-3" />,
  };
  return <span className={styles[status]}>{icons[status]}</span>;
}

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const selectedPath = useStudioStore((s) => s.selectedPath);
  const expandedDirs = useStudioStore((s) => s.expandedDirs);
  const selectFile = useStudioStore((s) => s.selectFile);
  const toggleDir = useStudioStore((s) => s.toggleDir);

  const isDir = node.type === "directory";
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;

  const handleClick = () => {
    if (isDir) {
      toggleDir(node.path);
    } else {
      selectFile(node.path);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "group flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px] leading-tight outline-none transition-colors duration-100 focus-visible:outline-1 focus-visible:outline-primary",
          isSelected
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isDir ? (
          <CaretRight
            weight="bold"
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform duration-100",
              isExpanded && "rotate-90"
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {isDir ? (
          isExpanded ? (
            <FolderOpen weight="duotone" className="size-4 shrink-0 text-ring" />
          ) : (
            <Folder weight="duotone" className="size-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <File weight="duotone" className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{node.name}</span>
        <StatusDot status={node.status} />
      </button>
      {isDir && isExpanded && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function StageSection({
  stage,
  nodes,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  nodes: FileNode[];
}) {
  const activeStage = useStudioStore((s) => s.activeStage);
  const setActiveStage = useStudioStore((s) => s.setActiveStage);
  const agents = useStudioStore((s) => s.agents);

  const stageAgents = useMemo(
    () => agents.filter((a) => stage.agents.includes(a.name)),
    [agents, stage.agents],
  );
  const agentCount = stage.agents.length;
  const hasActive = stageAgents.some((a) => a.state === "working");
  const allDone = stageAgents.every((a) => a.state === "done");
  const isExpanded = activeStage !== stage.id || true; // all expanded by default in MVP

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            hasActive
              ? "bg-status-active animate-pulse"
              : allDone
                ? "bg-status-done"
                : "bg-status-pending"
          )}
        />
        <span className="flex-1">{stage.label}</span>
        <span className="font-mono text-[10px] font-normal tabular-nums">
          {agentCount}
        </span>
      </button>
      {isExpanded && (
        <div className="pb-1">
          {nodes.map((node) => (
            <TreeNode key={node.path} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PipelineExplorer() {
  const files = useStudioStore((s) => s.files);

  const stageNodes = useMemo(() => {
    const nodeMap = new Map<string, FileNode[]>();
    for (const stage of PIPELINE_STAGES) {
      const matched = files.filter((f) => stage.folders.includes(f.name));
      nodeMap.set(stage.id, matched);
    }
    return nodeMap;
  }, [files]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pipeline
        </span>
      </div>
      <ScrollArea className="flex-1">
        {PIPELINE_STAGES.map((stage) => (
          <StageSection
            key={stage.id}
            stage={stage}
            nodes={stageNodes.get(stage.id) ?? []}
          />
        ))}
      </ScrollArea>
    </div>
  );
}
