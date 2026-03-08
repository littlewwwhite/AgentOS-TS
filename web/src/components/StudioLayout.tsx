// input: Three panel components
// output: Resizable three-column layout
// pos: Root layout — orchestrates panel arrangement and resize behavior

import { Panel, Group, Separator } from "react-resizable-panels";
import { PipelineExplorer } from "@/components/explorer/PipelineExplorer";
import { ContentCanvas } from "@/components/canvas/ContentCanvas";
import { ConversationPanel } from "@/components/conversation/ConversationPanel";
import { useStudioStore } from "@/stores/studio";

function ResizeHandle() {
  return (
    <Separator className="group relative w-px bg-[var(--color-border)] transition-colors data-[resize-handle-active]:bg-[var(--color-accent-dim)] hover:bg-[var(--color-accent-dim)]">
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  );
}

export function StudioLayout() {
  const conversationCollapsed = useStudioStore((s) => s.conversationCollapsed);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Top bar */}
      <header className="flex h-10 shrink-0 items-center border-b border-[var(--color-border)] bg-[var(--color-surface-1)] px-4">
        <span className="font-mono text-[13px] font-semibold tracking-tight text-[var(--color-text-secondary)]">
          AgentOS
        </span>
        <span className="ml-2 font-mono text-[11px] text-[var(--color-text-muted)]">Studio</span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
          v0.1.0
        </span>
      </header>

      {/* Three-panel workspace */}
      <Group direction="horizontal" className="flex-1">
        {/* Left: Pipeline Explorer */}
        <Panel defaultSize={18} min={14} max={30}>
          <PipelineExplorer />
        </Panel>

        <ResizeHandle />

        {/* Center: Content Canvas */}
        <Panel defaultSize={conversationCollapsed ? 62 : 52} min={30}>
          <ContentCanvas />
        </Panel>

        <ResizeHandle />

        {/* Right: Conversation */}
        <Panel
          defaultSize={conversationCollapsed ? 5 : 30}
          min={conversationCollapsed ? 3 : 20}
          max={45}
          collapsible
          collapsedSize={0}
        >
          <ConversationPanel />
        </Panel>
      </Group>
    </div>
  );
}
