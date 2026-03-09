// input: Three panel components, sandbox connection hook
// output: Resizable three-column layout with connection controls
// pos: Root layout — orchestrates panel arrangement, resize, and sandbox lifecycle

import { Panel, Group, Separator } from "react-resizable-panels";
import {
  CircleNotch,
  Plugs,
  PlugsConnected,
} from "@phosphor-icons/react";
import { PipelineExplorer } from "@/components/explorer/PipelineExplorer";
import { ContentCanvas } from "@/components/canvas/ContentCanvas";
import { ConversationPanel } from "@/components/conversation/ConversationPanel";
import { useSandboxConnection } from "@/hooks/useSandboxConnection";
import { useStudioStore } from "@/stores/studio";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

function SandboxControls() {
  const state = useStudioStore((s) => s.sandboxState);
  const start = useStudioStore((s) => s.startSandbox);
  const destroy = useStudioStore((s) => s.destroySandbox);

  if (state === "connecting") {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CircleNotch weight="bold" className="size-3.5 animate-spin" />
        <span className="text-[12px]">Connecting...</span>
      </div>
    );
  }

  if (state === "ready") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-primary">
          <PlugsConnected weight="bold" className="size-3.5" />
          <span className="text-[12px] font-medium">Connected</span>
        </div>
        <Button variant="ghost" size="sm" onClick={destroy}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-destructive">Connection failed</span>
        <Button variant="secondary" size="sm" onClick={start}>
          <Plugs weight="bold" className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={start}>
      <Plugs weight="bold" className="size-3.5" />
      Connect Sandbox
    </Button>
  );
}

export function StudioLayout() {
  useSandboxConnection();

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-11 shrink-0 items-center border-b border-border bg-card px-4">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-primary" />
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            AgentOS Studio
          </span>
        </div>
        <div className="flex-1" />
        <SandboxControls />
      </header>
      <Group orientation="horizontal" className="flex-1">
        <Panel minSize="15%" maxSize="30%" defaultSize="20%">
          <PipelineExplorer />
        </Panel>
        <ResizeHandle />
        <Panel minSize="30%">
          <ContentCanvas />
        </Panel>
        <ResizeHandle />
        <Panel minSize="15%" maxSize="35%" defaultSize="25%">
          <ConversationPanel />
        </Panel>
      </Group>
    </div>
  );
}
