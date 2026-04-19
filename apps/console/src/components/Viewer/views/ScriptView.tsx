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
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (!data) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;
  const eps = data.episodes ?? [];
  return (
    <div className="px-10 py-10 max-w-[72ch]">
      {data.title && (
        <h1 className="font-serif text-[32px] leading-tight text-[var(--color-ink)] mb-2">{data.title}</h1>
      )}
      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider mb-10">
        {eps.length} {eps.length === 1 ? "episode" : "episodes"}
      </div>
      <div className="space-y-3">
        {eps.map((ep, i) => {
          const id = ep.episode_id ?? `ep${i + 1}`;
          const open = openEp === id;
          const scenes = ep.scenes ?? [];
          const shotCount = scenes.reduce((s, sc) => s + (sc.shots?.length ?? 0), 0);
          return (
            <article key={id} className="border-t border-[var(--color-rule)] pt-3">
              <button
                onClick={() => setOpenEp(open ? null : id)}
                className="w-full text-left flex items-baseline gap-4 group"
              >
                <span className="font-mono text-[11px] text-[var(--color-ink-faint)] w-12">{id}</span>
                {ep.title && (
                  <span className="font-serif text-[20px] text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors">
                    {ep.title}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
                  {scenes.length} sc · {shotCount} sh
                </span>
              </button>
              {open && (
                <div className="mt-4 pl-12 space-y-4 text-[14px]">
                  {ep.logline && (
                    <p className="font-serif italic text-[var(--color-ink-muted)] leading-relaxed">
                      {ep.logline}
                    </p>
                  )}
                  {scenes.map((sc, j) => (
                    <div key={sc.scene_id ?? j} className="space-y-0.5">
                      <div className="text-[var(--color-ink)]">
                        <span className="font-mono text-[11px] text-[var(--color-ink-faint)] mr-2 uppercase tracking-wider">
                          {sc.scene_id ?? `scn${j + 1}`}
                        </span>
                        {sc.title}
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
                        {sc.shots?.length ?? 0} shots
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
