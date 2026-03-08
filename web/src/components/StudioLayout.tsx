// input: Three panel components
// output: Resizable three-column layout
// pos: Root layout — orchestrates panel arrangement and resize behavior

import { Panel, Group, Separator } from "react-resizable-panels";
import { PipelineExplorer } from "@/components/explorer/PipelineExplorer";
import { ContentCanvas } from "@/components/canvas/ContentCanvas";
import { ConversationPanel } from "@/components/conversation/ConversationPanel";
import { cn } from "@/lib/utils";

function ResizeHandle() {
  return (
    <Separator
      className={cn(
        "group relative w-px bg-border transition-colors",
        "data-[resize-handle-active]:bg-ring hover:bg-ring",
      )}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  );
}

export function StudioLayout() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-10 shrink-0 items-center border-b border-border bg-card px-4">
        <span className="font-mono text-[13px] font-semibold tracking-tight text-foreground">
          AgentOS Studio
        </span>
      </header>
      <Group orientation="horizontal" className="flex-1">
        <Panel minSize={15} maxSize={30} defaultSize={20}>
          <PipelineExplorer />
        </Panel>
        <ResizeHandle />
        <Panel minSize={30}>
          <ContentCanvas />
        </Panel>
        <ResizeHandle />
        <Panel minSize={15} maxSize={35} defaultSize={25}>
          <ConversationPanel />
        </Panel>
      </Group>
    </div>
  );
}
