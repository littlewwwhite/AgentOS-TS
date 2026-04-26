interface Props {
  projectName: string;
  path: string;
}

export function FallbackView({ projectName }: Props) {
  return (
    <div className="h-full flex items-center px-10 py-16">
      <div className="max-w-md">
        <div className="font-serif text-[clamp(32px,3.5vw,44px)] leading-[1.15] text-[var(--color-ink)]">
          从制作总览开始。
        </div>
        <p className="mt-4 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
          左侧按短剧制作对象组织入口。先查看当前待拍板事项，再进入剧本、素材、分镜或分集视频继续推进。
        </p>
        <div className="mt-12 pt-6 border-t border-[var(--color-rule)] font-sans text-[11px] text-[var(--color-ink-subtle)] space-y-1.5">
          <div><span className="inline-block w-16 tracking-[0.04em]">项目</span>{projectName}</div>
          <div><span className="inline-block w-16 tracking-[0.04em]">默认入口</span>制作总览</div>
        </div>
      </div>
    </div>
  );
}
