interface Props {
  projectName: string;
  path: string;
}

export function FallbackView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center px-10 py-16">
      <div className="max-w-md">
        <div className="font-serif text-[clamp(32px,3.5vw,44px)] leading-[1.15] text-[var(--color-ink)]">
          Select a stage to begin.
        </div>
        <p className="mt-4 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
          The navigator on the left lists every artifact this project has produced.
          Click a stage to read it; tabs pin automatically.
        </p>
        <div className="mt-12 pt-6 border-t border-[var(--color-rule)] font-mono text-[11px] text-[var(--color-ink-subtle)] space-y-1.5">
          <div><span className="inline-block w-16 uppercase tracking-wider">Project</span>{projectName}</div>
          <div><span className="inline-block w-16 uppercase tracking-wider">Path</span>{path || "(root)"}</div>
        </div>
      </div>
    </div>
  );
}
