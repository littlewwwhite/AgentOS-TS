// apps/console/src/components/CanvasPane.tsx
import { useEffect, useState } from "react";
import type { CanvasView, PipelineState } from "../types";
import { PipelineTimeline } from "./PipelineTimeline";
import { StageCard } from "./StageCard";

const STAGES = ["SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"];

interface Props {
  view: CanvasView;
}

function PipelineView({ projectName }: { projectName: string }) {
  const [state, setState] = useState<PipelineState | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectName)}`)
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, [projectName]);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-[oklch(40%_0_0)] text-sm">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5 overflow-y-auto h-full">
      <div>
        <h2 className="text-sm font-semibold mb-1">{projectName}</h2>
        {state.next_action && (
          <p className="text-[12px] text-[oklch(42%_0_0)]">
            下一步：<span className="text-[oklch(65%_0_0)]">{state.next_action}</span>
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[oklch(22%_0_0)] bg-[oklch(16%_0_0)] p-4">
        <PipelineTimeline stages={state.stages} currentStage={state.current_stage} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {STAGES.map((stage) => (
          <StageCard
            key={stage}
            name={stage}
            stage={state.stages[stage] ?? { status: "not_started", artifacts: [] }}
          />
        ))}
      </div>
    </div>
  );
}

function IdleView() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <div className="text-4xl opacity-20">◎</div>
      <p className="text-sm text-[oklch(38%_0_0)]">
        发送指令后，<br />相关内容将在此处显示
      </p>
    </div>
  );
}

function TextView({ content, label }: { content: string; label: string }) {
  return (
    <div className="flex flex-col h-full p-5 gap-3">
      <span className="text-[11px] text-[oklch(42%_0_0)] uppercase tracking-widest">{label}</span>
      <pre className="flex-1 overflow-auto text-[12px] font-mono text-[oklch(72%_0_0)] whitespace-pre-wrap leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

export function CanvasPane({ view }: Props) {
  return (
    <div className="h-full bg-[oklch(13%_0_0)] overflow-hidden">
      {view.type === "idle" && <IdleView />}
      {view.type === "pipeline" && <PipelineView projectName={view.projectName} />}
      {view.type === "text" && <TextView content={view.content} label={view.label} />}
      {view.type === "images" && (
        <div className="p-5 text-sm text-[oklch(45%_0_0)]">
          图片预览：{view.paths.join(", ")}
        </div>
      )}
    </div>
  );
}
