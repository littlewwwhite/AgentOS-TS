import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Storyboard { episode_id?: string; title?: string; scenes?: Scene[]; }

export function StoryboardView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Storyboard>(projectName, path);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (!data) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  const scenes = data.scenes ?? [];
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[oklch(85%_0_0)]">{data.episode_id ?? "分镜"}</h2>
        {data.title && <div className="text-[12px] text-[oklch(55%_0_0)]">{data.title}</div>}
      </div>
      {scenes.map((sc, si) => (
        <div key={sc.scene_id ?? si} className="space-y-2">
          <div className="text-[13px] text-[oklch(75%_0_0)]">
            {sc.scene_id ?? `scn${si + 1}`}{sc.title ? ` · ${sc.title}` : ""}
          </div>
          <div className="pl-3 border-l border-[oklch(20%_0_0)] space-y-2">
            {(sc.shots ?? []).map((sh, i) => (
              <div key={sh.shot_id ?? i} className="text-[12px]">
                <div className="text-[oklch(65%_0.18_270)]">{sh.shot_id ?? `shot${i + 1}`}{sh.duration != null ? ` · ${sh.duration}s` : ""}</div>
                {sh.prompt && <div className="text-[oklch(65%_0_0)] mt-1 whitespace-pre-wrap">{sh.prompt}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
