import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Storyboard { episode_id?: string; title?: string; scenes?: Scene[]; }

export function StoryboardView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Storyboard>(projectName, path);
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (!data) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;
  const scenes = data.scenes ?? [];
  return (
    <div className="px-10 py-10 max-w-[72ch] space-y-10">
      <header>
        <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider mb-1">
          {data.episode_id ?? "storyboard"}
        </div>
        {data.title && (
          <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">{data.title}</h1>
        )}
      </header>
      {scenes.map((sc, si) => (
        <section key={sc.scene_id ?? si} className="border-t border-[var(--color-rule)] pt-6 space-y-4">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wider w-12">
              {sc.scene_id ?? `scn${si + 1}`}
            </span>
            {sc.title && (
              <h2 className="font-serif text-[20px] italic text-[var(--color-ink)]">{sc.title}</h2>
            )}
          </div>
          <div className="space-y-4 pl-16">
            {(sc.shots ?? []).map((sh, i) => (
              <div key={sh.shot_id ?? i} className="space-y-1">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-[var(--color-accent)] uppercase tracking-wider">
                    {sh.shot_id ?? `shot${i + 1}`}
                  </span>
                  {sh.duration != null && (
                    <span className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                      {sh.duration}s
                    </span>
                  )}
                </div>
                {sh.prompt && (
                  <div className="font-serif italic text-[14px] leading-relaxed text-[var(--color-ink-muted)] whitespace-pre-wrap">
                    {sh.prompt}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
