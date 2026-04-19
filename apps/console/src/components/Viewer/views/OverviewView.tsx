import { useProject } from "../../../contexts/ProjectContext";

const STAGES = ["INSPIRATION", "SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"] as const;

const COLOR: Record<string, string> = {
  completed: "oklch(70% 0.18 145)",
  validated: "oklch(70% 0.18 145)",
  running: "oklch(75% 0.18 260)",
  partial: "oklch(78% 0.18 80)",
  failed: "oklch(65% 0.22 25)",
  not_started: "oklch(30% 0 0)",
};

export function OverviewView() {
  const { name, state, tree } = useProject();
  if (!name) return null;
  if (!state) return <div className="p-4 text-sm text-[oklch(42%_0_0)]">加载中…</div>;

  const epCount = Object.keys(state.episodes ?? {}).length;
  const assetCount = tree.filter((n) => n.type === "file" && /^output\/(actors|locations|props)/.test(n.path)).length;
  const videoCount = tree.filter((n) => n.type === "file" && /\.(mp4|webm|mov)$/i.test(n.name)).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[oklch(85%_0_0)]">{name}</h1>
        <div className="text-[12px] text-[oklch(55%_0_0)] mt-1">
          当前阶段 {state.current_stage} · 下一步 {state.next_action}
        </div>
        {state.last_error && <div className="text-[12px] text-red-400 mt-1">上次错误：{state.last_error}</div>}
      </div>
      <div>
        <div className="text-[12px] text-[oklch(55%_0_0)] mb-2">阶段状态</div>
        <table className="w-full text-[12px]">
          <tbody>
            {STAGES.map((s) => {
              const status = state.stages?.[s]?.status ?? "not_started";
              const artifacts = state.stages?.[s]?.artifacts ?? [];
              return (
                <tr key={s} className="border-t border-[oklch(20%_0_0)]">
                  <td className="py-2 text-[oklch(75%_0_0)] w-40">{s}</td>
                  <td className="py-2">
                    <span
                      className="px-2 py-0.5 rounded text-[11px]"
                      style={{ color: COLOR[status] ?? "inherit", backgroundColor: "oklch(14% 0 0)" }}
                    >{status}</span>
                  </td>
                  <td className="py-2 text-[oklch(42%_0_0)]">{artifacts.length} 产物</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-3 gap-4 text-[12px]">
        <Stat label="集数" value={epCount} />
        <Stat label="资产图片" value={assetCount} />
        <Stat label="视频文件" value={videoCount} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[oklch(20%_0_0)] rounded p-3">
      <div className="text-[oklch(55%_0_0)]">{label}</div>
      <div className="text-2xl text-[oklch(85%_0_0)] font-semibold">{value}</div>
    </div>
  );
}
