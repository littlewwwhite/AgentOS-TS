// input: File tree data from workspace store
// output: Collapsible tree view organized by pipeline stages
// pos: Left panel — navigation and status overview

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

function StatusDot({ status }: { status: FileStatus }) {
  const styles: Record<FileStatus, string> = {
    done: "text-[var(--color-status-done)]",
    active: "text-[var(--color-status-active)]",
    error: "text-[var(--color-status-error)]",
    pending: "text-[var(--color-status-pending)]",
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
  const { selectedPath, expandedDirs, selectFile, toggleDir } = useStudioStore();
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
        className={`
          group flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px]
          leading-tight outline-none transition-colors duration-100
          focus-visible:outline-1 focus-visible:outline-[var(--color-accent)]
          ${isSelected ? "bg-[var(--color-surface-2)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"}
        `}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isDir ? (
          <CaretRight
            weight="bold"
            className={`size-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-100 ${isExpanded ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {isDir ? (
          isExpanded ? (
            <FolderOpen weight="duotone" className="size-4 shrink-0 text-[var(--color-accent-dim)]" />
          ) : (
            <Folder weight="duotone" className="size-4 shrink-0 text-[var(--color-text-muted)]" />
          )
        ) : (
          <File weight="duotone" className="size-4 shrink-0 text-[var(--color-text-muted)]" />
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
  const { activeStage, setActiveStage } = useStudioStore();
  const isExpanded = activeStage !== stage.id || true; // all expanded by default in MVP

  const agentCount = stage.agents.length;
  const stageAgents = useStudioStore((s) =>
    s.agents.filter((a) => stage.agents.includes(a.name)),
  );
  const hasActive = stageAgents.some((a) => a.state === "working");
  const allDone = stageAgents.every((a) => a.state === "done");

  return (
    <div className="border-b border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
      >
        <span
          className={`size-1.5 rounded-full ${
            hasActive
              ? "bg-[var(--color-status-active)] animate-pulse"
              : allDone
                ? "bg-[var(--color-status-done)]"
                : "bg-[var(--color-status-pending)]"
          }`}
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

  // Group files by stage
  const stageNodes = PIPELINE_STAGES.map((stage) => ({
    stage,
    nodes: files.filter((f) =>
      stage.folders.some((folder) => f.path === folder || f.path.startsWith(folder + "/")),
    ),
  }));

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface-1)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Pipeline
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {stageNodes.map(({ stage, nodes }) => (
          <StageSection key={stage.id} stage={stage} nodes={nodes} />
        ))}
      </div>
    </div>
  );
}
