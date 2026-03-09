// input: File tree data from workspace store
// output: Collapsible tree view organized by pipeline stages
// pos: Left panel — navigation and status overview

import { useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Loader2,
  AlertTriangle,
  Minus,
  CloudOff,
  FolderOpen,
} from "lucide-react";
import { useStudioStore } from "@/stores/studio";
import { PIPELINE_STAGES, type FileNode, type FileStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileTree,
  FileTreeFolder,
  FileTreeFile,
  FileTreeIcon,
  FileTreeName,
  FileTreeActions,
} from "@/components/ai-elements/file-tree";

function StatusDot({ status }: { status: FileStatus }) {
  const styles: Record<FileStatus, string> = {
    done: "text-status-done",
    active: "text-status-active",
    error: "text-status-error",
    pending: "text-status-pending",
  };
  const icons: Record<FileStatus, React.ReactNode> = {
    done: <Check className="size-3" strokeWidth={3} />,
    active: <Loader2 className="size-3 animate-spin" strokeWidth={3} />,
    error: <AlertTriangle className="size-3" strokeWidth={3} />,
    pending: <Minus className="size-3" strokeWidth={3} />,
  };
  return <span className={styles[status]}>{icons[status]}</span>;
}

function RenderNode({ node }: { node: FileNode }) {
  if (node.type === "directory") {
    return (
      <FileTreeFolder path={node.path} name={node.name}>
        {node.children?.map((child) => (
          <RenderNode key={child.path} node={child} />
        ))}
      </FileTreeFolder>
    );
  }

  return (
    <FileTreeFile path={node.path} name={node.name}>
      {/* Spacer for chevron alignment */}
      <span className="size-4" />
      <FileTreeIcon>
        <span className="size-4" />
      </FileTreeIcon>
      <FileTreeName className="flex-1 font-mono text-xs">
        {node.name}
      </FileTreeName>
      <FileTreeActions>
        <StatusDot status={node.status} />
      </FileTreeActions>
    </FileTreeFile>
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

  const hasFiles = nodes.length > 0;
  const isExpanded = activeStage !== stage.id || true; // all expanded by default in MVP

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors",
          "text-muted-foreground hover:text-foreground"
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            hasFiles ? "bg-status-done" : "bg-status-pending"
          )}
        />
        <span className="flex-1">{stage.label}</span>
        <span className="font-mono text-[10px] font-normal tabular-nums">
          {nodes.length}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="stage-content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-1">
              {nodes.map((node) => (
                <RenderNode key={node.path} node={node} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PipelineExplorer() {
  const files = useStudioStore((s) => s.files);
  const sandboxState = useStudioStore((s) => s.sandboxState);
  const expandedDirs = useStudioStore((s) => s.expandedDirs);
  const selectedPath = useStudioStore((s) => s.selectedPath);
  const selectFile = useStudioStore((s) => s.selectFile);

  const handleSelect = useCallback(
    (path: string) => selectFile(path),
    [selectFile],
  );

  const handleExpandedChange = useCallback(
    (newExpanded: Set<string>) => {
      useStudioStore.setState({ expandedDirs: newExpanded });
    },
    [],
  );

  const stageNodes = useMemo(() => {
    const nodeMap = new Map<string, FileNode[]>();
    const allMatched = new Set<string>();
    for (const stage of PIPELINE_STAGES) {
      const matched = files.filter((f) => stage.folders.includes(f.name));
      nodeMap.set(stage.id, matched);
      for (const f of matched) allMatched.add(f.path);
    }
    // Workspace fallback — files not matching any pipeline stage
    const unmatched = files.filter((f) => !allMatched.has(f.path));
    nodeMap.set("__workspace__", unmatched);
    return nodeMap;
  }, [files]);

  if (files.length === 0) {
    const isConnected = sandboxState === "ready";
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pipeline
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {isConnected ? (
            <>
              <FolderOpen className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No files in workspace yet
              </p>
            </>
          ) : (
            <>
              <CloudOff className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                Connect sandbox to browse files
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const workspaceFiles = stageNodes.get("__workspace__") ?? [];

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pipeline
        </span>
      </div>
      <ScrollArea className="flex-1">
        <FileTree
          expanded={expandedDirs}
          selectedPath={selectedPath ?? undefined}
          onSelect={handleSelect}
          onExpandedChange={handleExpandedChange}
          className="border-0 rounded-none bg-transparent shadow-none [&>div]:p-0"
        >
          {PIPELINE_STAGES.map((stage) => (
            <StageSection
              key={stage.id}
              stage={stage}
              nodes={stageNodes.get(stage.id) ?? []}
            />
          ))}
          {workspaceFiles.length > 0 && (
            <div className="border-b border-border">
              <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FolderOpen className="size-3.5" strokeWidth={2} />
                <span className="flex-1">Workspace</span>
                <span className="font-mono text-[10px] font-normal tabular-nums">
                  {workspaceFiles.length}
                </span>
              </div>
              <div className="pb-1">
                {workspaceFiles.map((node) => (
                  <RenderNode key={node.path} node={node} />
                ))}
              </div>
            </div>
          )}
        </FileTree>
      </ScrollArea>
    </div>
  );
}
