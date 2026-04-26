// input: project pipeline state, workspace tree, and tab actions
// output: overview homepage with decision-first production inbox and supporting workflow/workspace panels
// pos: top-level console overview that prioritizes actionable production objects before passive status

import { useState, type ChangeEvent } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { useTabs } from "../../../contexts/TabsContext";
import { StatusBadge } from "../../Navigator/StatusBadge";
import type { StageStatus } from "../../../types";
import { buildProductionInbox, type ProductionInboxItem } from "../../../lib/productionInbox";
import { getResumeDecision, type ResumeDecision } from "../../../lib/resumePolicy";
import { buildOverviewWorkbench, type WorkbenchItem } from "../../../lib/overviewWorkbench";
import { buildWorkspaceSummary, type WorkspaceSummary } from "../../../lib/workspaceSummary";
import { buildWorkflowProgress, type WorkflowProgressItem } from "../../../lib/workflowProgress";
import { buildWorkflowStatus, type WorkflowStatus } from "../../../lib/workflowStatus";
import { resolveView } from "../resolveView";

export function ProductionInboxPanel({
  items,
  onOpen,
}: {
  items: ProductionInboxItem[];
  onOpen: (item: ProductionInboxItem) => void;
}) {
  return (
    <section className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
            Production Inbox
          </div>
          <p className="mt-2 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            先处理会阻塞交付或需要拍板的制作对象。
          </p>
        </div>
        <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
          {items.length} items
        </div>
      </div>
      {items.length === 0 ? (
        <div className="mt-4 border-t border-[var(--color-rule)] pt-4 font-[Geist,sans-serif] text-[13px] text-[var(--color-ink-subtle)]">
          当前没有需要导演/制片处理的事项。
        </div>
      ) : (
        <div className="mt-4 space-y-4 border-t border-[var(--color-rule)] pt-4">
          {items.map((item) => (
            <article key={item.key} className="border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                    {item.priority} · {item.stage}
                  </div>
                  <div className="font-serif text-[24px] leading-tight text-[var(--color-ink)]">
                    {item.title}
                  </div>
                  <p className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {item.reason}
                  </p>
                  {item.path && (
                    <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                      {item.path}
                    </div>
                  )}
                </div>
                {item.path ? (
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)]"
                  >
                    {item.cta}
                  </button>
                ) : (
                  <span className="font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-subtle)]">
                    等待产物入口
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function OverviewView() {
  const { name, state, tree, refresh } = useProject();
  const { openPath } = useTabs();
  const [uploadState, setUploadState] = useState<{
    status: "idle" | "uploading" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  if (!name) return null;
  if (!state) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">加载中…</div>;
  const projectName = name;

  const epCount = Object.keys(state.episodes ?? {}).length;
  const assetCount = tree.filter((n) => n.type === "file" && /^output\/(actors|locations|props)/.test(n.path)).length;
  const videoCount = tree.filter((n) => n.type === "file" && /\.(mp4|webm|mov)$/i.test(n.name)).length;
  const resumeDecision = getResumeDecision(state);
  const workbench = buildOverviewWorkbench(state);
  const inbox = buildProductionInbox(state);
  const workspaceSummary = buildWorkspaceSummary(name, tree);
  const workflowStatus = buildWorkflowStatus(state);
  const workflowProgress = buildWorkflowProgress({
    currentStage: state.current_stage,
    stageStatuses: {
      SCRIPT: state.stages?.SCRIPT?.status,
      VISUAL: state.stages?.VISUAL?.status,
      STORYBOARD: state.stages?.STORYBOARD?.status,
      VIDEO: state.stages?.VIDEO?.status,
    },
  });
  const resumeTargetPath = resumeDecision.targetArtifact
    ?? (resumeDecision.stage ? state.stages?.[resumeDecision.stage]?.artifacts?.[0] : undefined);

  function openWorkbenchPath(path: string, title: string) {
    openPath(path, resolveView(path), title, { pinned: true });
  }

  async function uploadSourceFile(file: File) {
    const body = new FormData();
    body.set("file", file);
    setUploadState({ status: "uploading", message: `正在上传 ${file.name}…` });

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/source-upload`, {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : `upload failed: ${response.status}`);
      }

      const sourceMessage = payload.sourceUpdated
        ? "并已同步为流程输入 source.txt"
        : "已作为原始文档保存，后续可让 Agent 转换为 source.txt";
      setUploadState({
        status: "success",
        message: `已上传到 ${payload.rawPath}，${sourceMessage}。`,
      });
      refresh();
    } catch (err) {
      setUploadState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleSourceUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadSourceFile(file);
  }

  return (
    <div className="px-10 py-10 max-w-[72ch] space-y-16">
      <section>
        <h1 className="font-serif text-[44px] leading-tight text-[var(--color-ink)]">{name}</h1>
        <div className="mt-3 font-mono text-[11px] text-[var(--color-ink-subtle)] tracking-[0.04em] space-x-4">
          <span>阶段 {state.current_stage ?? "—"}</span>
          <span>·</span>
          <span>下一步 {state.next_action ?? "—"}</span>
        </div>
        {state.last_error && (
          <div className="mt-4 font-mono text-[12px] text-[var(--color-err)]">
            最近错误：{state.last_error}
          </div>
        )}
      </section>

      <ProductionInboxPanel
        items={inbox.primaryItems}
        onOpen={(item) => item.path && openWorkbenchPath(item.path, item.title)}
      />

      <section className="grid grid-cols-3 gap-10 border-y border-[var(--color-rule)] py-8">
        <Stat label="需拍板" value={inbox.summary.decisions} />
        <Stat label="阻塞项" value={inbox.summary.blocked} />
        <Stat label="总事项" value={inbox.summary.total} />
      </section>

      <WorkflowStatusCard
        status={workflowStatus}
        decision={resumeDecision}
        targetPath={resumeTargetPath}
        onOpenTarget={resumeTargetPath ? () => openWorkbenchPath(resumeTargetPath, decisionTitle(resumeDecision, resumeTargetPath)) : undefined}
      />

      <WorkflowProgressStrip items={workflowProgress} />

      <section className="grid grid-cols-3 gap-10 border-y border-[var(--color-rule)] py-8">
        <Stat label="待审核" value={workbench.reviewItems.length} />
        <Stat label="待返修" value={workbench.changeRequestItems.length} />
        <Stat label="已失效" value={workbench.staleItems.length} />
      </section>

      <WorkbenchSection
        title="待审核"
        empty="当前没有待审核产物。"
        items={workbench.reviewItems}
        actionLabel="去审核"
        onOpen={(item) => item.path && openWorkbenchPath(item.path, item.title)}
      />

      <WorkbenchSection
        title="返修队列"
        empty="当前没有待返修任务。"
        items={workbench.changeRequestItems}
        actionLabel="去返修"
        onOpen={(item) => item.path && openWorkbenchPath(item.path, item.title)}
      />

      <WorkbenchSection
        title="失效队列"
        empty="当前没有已失效阶段。"
        items={workbench.staleItems}
        actionLabel="查看入口"
        onOpen={(item) => item.path && openWorkbenchPath(item.path, item.title)}
      />

      <WorkspaceCard
        summary={workspaceSummary}
        uploadState={uploadState}
        onUpload={handleSourceUpload}
        onOpen={(path) => openWorkbenchPath(path, path)}
      />

      <section className="grid grid-cols-3 gap-10 border-t border-[var(--color-rule)] pt-8">
        <Stat label="分集" value={epCount} />
        <Stat label="素材" value={assetCount} />
        <Stat label="视频" value={videoCount} />
      </section>
    </div>
  );
}

export function WorkflowProgressStrip({ items }: { items: WorkflowProgressItem[] }) {
  return (
    <section
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.key} className="space-y-2">
          <div
            className="h-1.5 w-full"
            style={{
              backgroundColor:
                item.state === "done"
                  ? "var(--color-ok)"
                  : item.state === "current"
                    ? "var(--color-accent)"
                    : item.state === "blocked"
                      ? "var(--color-err)"
                      : "var(--color-rule)",
            }}
          />
          <div className="space-y-1">
            <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
              {item.label}
            </div>
            <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">
              {progressLabel(item.state)}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function WorkflowStatusCard({
  status,
  decision,
  targetPath,
  onOpenTarget,
}: {
  status: WorkflowStatus;
  decision: ResumeDecision;
  targetPath?: string;
  onOpenTarget?: () => void;
}) {
  return (
    <section className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
            当前流程状态
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <div className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
              {status.title}
            </div>
            <span className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
              {status.currentStage}
            </span>
          </div>
        </div>
        <WorkflowTone tone={status.tone} />
      </div>
      <p className="mt-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
        {status.explanation}
      </p>
      <div className="mt-4 border-t border-[var(--color-rule)] pt-3">
        <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
          下一步
        </div>
        <div className="mt-1 font-[Geist,sans-serif] text-[14px] text-[var(--color-ink)]">
          {status.nextStep}
        </div>
      </div>
      {targetPath && onOpenTarget && decision.action !== "complete" && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenTarget}
            className="bg-[var(--color-ink)] px-4 py-2 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-paper)]"
          >
            打开处理入口
          </button>
          <span className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
            {decisionTitle(decision, targetPath)}
          </span>
        </div>
      )}
    </section>
  );
}

function progressLabel(state: WorkflowProgressItem["state"]): string {
  switch (state) {
    case "done": return "已完成";
    case "current": return "当前";
    case "blocked": return "阻塞";
    default: return "待开始";
  }
}

function WorkflowTone({ tone }: { tone: WorkflowStatus["tone"] }) {
  const label: Record<WorkflowStatus["tone"], string> = {
    error: "异常",
    blocked: "阻塞",
    review: "待审核",
    stale: "需重跑",
    running: "运行中",
    ready: "正常",
    complete: "完成",
  };

  return (
    <span className="border border-[var(--color-rule)] px-3 py-1 font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
      {label[tone]}
    </span>
  );
}

function WorkspaceCard({
  summary,
  uploadState,
  onUpload,
  onOpen,
}: {
  summary: WorkspaceSummary;
  uploadState: { status: "idle" | "uploading" | "success" | "error"; message: string };
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <section className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
            工作区
          </div>
          <div className="mt-2 font-mono text-[12px] text-[var(--color-ink)]">
            {summary.rootPath}
          </div>
        </div>
        <label className="cursor-pointer border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)]">
          上传文档
          <input
            type="file"
            className="sr-only"
            accept=".txt,.md,.markdown,.doc,.docx,.pdf"
            onChange={onUpload}
            disabled={uploadState.status === "uploading"}
          />
        </label>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-4 border-y border-[var(--color-rule)] py-4">
        <MiniStat label="源文件" value={summary.sourceFiles.length} />
        <MiniStat label="草稿" value={summary.draftCount} />
        <MiniStat label="产物" value={summary.outputCount} />
        <MiniStat label="全部文件" value={summary.totalFiles} />
      </div>

      <div className="mt-4">
        <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
          输入源
        </div>
        {summary.sourceFiles.length === 0 ? (
          <p className="mt-2 font-[Geist,sans-serif] text-[13px] text-[var(--color-ink-subtle)]">
            还没有 source.txt 或 input/ 原始文档。先上传小说、梗概或参考资料。
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {summary.sourceFiles.slice(0, 6).map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onOpen(file.path)}
                className="block w-full truncate text-left font-mono text-[11px] text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]"
              >
                {file.path}{file.size ? ` · ${formatBytes(file.size)}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {uploadState.message && (
        <div
          className={`mt-4 font-[Geist,sans-serif] text-[12px] ${
            uploadState.status === "error" ? "text-[var(--color-err)]" : "text-[var(--color-ink-muted)]"
          }`}
          role="status"
        >
          {uploadState.message}
        </div>
      )}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-sans text-[10px] font-semibold tracking-[0.04em] text-[var(--color-ink-subtle)]">{label}</div>
      <div className="mt-1 font-serif text-[24px] leading-none text-[var(--color-ink)]">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function decisionTitle(decision: ResumeDecision, path: string): string {
  const leaf = path.split("/").pop() ?? path;
  return `${decision.label} · ${leaf}`;
}

function WorkbenchSection({
  title,
  empty,
  items,
  actionLabel,
  onOpen,
}: {
  title: string;
  empty: string;
  items: WorkbenchItem[];
  actionLabel: string;
  onOpen: (item: WorkbenchItem) => void;
}) {
  return (
    <section>
      <h2 className="font-sans text-[10px] font-semibold tracking-[0.04em] text-[var(--color-ink-subtle)] mb-6">
        {title}
      </h2>
      {items.length === 0 ? (
        <div className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4 font-[Geist,sans-serif] text-[13px] text-[var(--color-ink-subtle)]">
          {empty}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.key} className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="font-serif text-[24px] leading-tight text-[var(--color-ink)]">
                      {item.title}
                    </div>
                    <StatusBadge status={item.status} />
                    <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                      {item.stage}
                    </div>
                  </div>
                  <p className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {item.reason}
                  </p>
                  {item.path && (
                    <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                      {item.path}
                    </div>
                  )}
                </div>
                {item.path && (
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)]"
                  >
                    {actionLabel}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-sans text-[10px] font-semibold tracking-[0.04em] text-[var(--color-ink-subtle)]">{label}</div>
      <div className="mt-2 font-serif text-[44px] leading-none text-[var(--color-ink)]">{value}</div>
    </div>
  );
}
