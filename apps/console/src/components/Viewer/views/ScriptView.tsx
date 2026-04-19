import { useState } from "react";
import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Episode { episode_id?: string; title?: string; logline?: string; scenes?: Scene[]; }
interface Script { title?: string; episodes?: Episode[]; }

export function ScriptView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Script>(projectName, path);
  const [openEp, setOpenEp] = useState<string | null>(null);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (!data) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  const eps = data.episodes ?? [];
  return (
    <div className="p-4 space-y-3">
      {data.title && <h2 className="text-lg font-semibold text-[oklch(85%_0_0)]">{data.title}</h2>}
      <div className="text-[12px] text-[oklch(55%_0_0)]">{eps.length} 集</div>
      <div className="space-y-2">
        {eps.map((ep, i) => {
          const id = ep.episode_id ?? `ep${i + 1}`;
          const open = openEp === id;
          const scenes = ep.scenes ?? [];
          const shotCount = scenes.reduce((s, sc) => s + (sc.shots?.length ?? 0), 0);
          return (
            <div key={id} className="border border-[oklch(20%_0_0)] rounded">
              <button
                onClick={() => setOpenEp(open ? null : id)}
                className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-[oklch(14%_0_0)]"
              >
                <span className="text-[oklch(65%_0.18_270)] text-[12px]">{open ? "▾" : "▸"}</span>
                <span className="text-[13px] text-[oklch(85%_0_0)]">{id}</span>
                {ep.title && <span className="text-[12px] text-[oklch(55%_0_0)]">· {ep.title}</span>}
                <span className="ml-auto text-[11px] text-[oklch(42%_0_0)]">{scenes.length} 场景 · {shotCount} 镜头</span>
              </button>
              {open && (
                <div className="px-4 pb-3 text-[12px] text-[oklch(65%_0_0)] space-y-2">
                  {ep.logline && <p className="italic">{ep.logline}</p>}
                  {scenes.map((sc, j) => (
                    <div key={sc.scene_id ?? j} className="pl-2 border-l border-[oklch(20%_0_0)]">
                      <div className="text-[oklch(75%_0_0)]">{sc.scene_id ?? `scn${j + 1}`}{sc.title ? ` · ${sc.title}` : ""}</div>
                      <div className="text-[11px] text-[oklch(42%_0_0)]">{sc.shots?.length ?? 0} 镜头</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
