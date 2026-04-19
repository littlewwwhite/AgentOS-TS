import { useProject } from "../../../contexts/ProjectContext";
import { StatusBadge } from "../../Navigator/StatusBadge";
import type { StageStatus } from "../../../types";

const STAGES = ["INSPIRATION", "SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"] as const;

export function OverviewView() {
  const { name, state, tree } = useProject();
  if (!name) return null;
  if (!state) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">加载中…</div>;

  const epCount = Object.keys(state.episodes ?? {}).length;
  const assetCount = tree.filter((n) => n.type === "file" && /^output\/(actors|locations|props)/.test(n.path)).length;
  const videoCount = tree.filter((n) => n.type === "file" && /\.(mp4|webm|mov)$/i.test(n.name)).length;

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

      <section>
        <h2 className="font-sans text-[10px] font-semibold tracking-[0.04em] text-[var(--color-ink-subtle)] mb-6">
          流水线
        </h2>
        <dl className="space-y-5">
          {STAGES.map((s) => {
            const status = (state.stages?.[s]?.status ?? "not_started") as StageStatus;
            const artifacts = state.stages?.[s]?.artifacts ?? [];
            return (
              <div key={s} className="flex items-baseline gap-6 border-t border-[var(--color-rule)] pt-4">
                <dt className="font-serif text-[20px] text-[var(--color-ink)] w-48 shrink-0">{s.toLowerCase()}</dt>
                <dd className="flex-1 flex items-center gap-4">
                  <StatusBadge status={status} />
                  <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] tracking-[0.04em]">
                    {artifacts.length} 个产物
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="grid grid-cols-3 gap-10 border-t border-[var(--color-rule)] pt-8">
        <Stat label="分集" value={epCount} />
        <Stat label="素材" value={assetCount} />
        <Stat label="视频" value={videoCount} />
      </section>
    </div>
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
