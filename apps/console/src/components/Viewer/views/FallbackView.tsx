interface Props {
  projectName: string;
  path: string;
}

export function FallbackView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center px-10 py-16">
      <div className="max-w-md">
        <div className="font-serif text-[clamp(32px,3.5vw,44px)] leading-[1.15] text-[var(--color-ink)]">
          选择一个阶段以开始。
        </div>
        <p className="mt-4 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
          左侧导航栏列出了该项目已生成的所有产物，点击任意阶段即可查看，标签页会自动固定。
        </p>
        <div className="mt-12 pt-6 border-t border-[var(--color-rule)] font-mono text-[11px] text-[var(--color-ink-subtle)] space-y-1.5">
          <div><span className="inline-block w-16 tracking-[0.04em]">项目</span>{projectName}</div>
          <div><span className="inline-block w-16 tracking-[0.04em]">路径</span>{path || "(根目录)"}</div>
        </div>
      </div>
    </div>
  );
}
