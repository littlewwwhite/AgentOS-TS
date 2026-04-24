import { useState, type ChangeEvent } from "react";

interface CreateInput {
  projectName: string;
  file: File | null;
}

export function ProjectOnboardingView({
  onCreate,
  isSubmitting,
  errorMessage,
}: {
  onCreate: (input: CreateInput) => void;
  isSubmitting: boolean;
  errorMessage?: string | null;
}) {
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  return (
    <div className="h-full overflow-auto px-10 py-10">
      <section className="max-w-[76ch] space-y-10">
        <div className="space-y-4">
          <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
            一步一步开始
          </div>
          <h1 className="font-serif text-[44px] leading-tight text-[var(--color-ink)]">
            新建项目
          </h1>
          <p className="max-w-[56ch] font-[Geist,sans-serif] text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
            先创建工作区，再上传源文档。系统会把文本材料整理进 <code>workspace/{"{项目名}"}</code>
            ，并把后续流程都挂到同一个项目状态上。
          </p>
        </div>

        <section className="grid gap-8 border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-6 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="space-y-5">
            <label className="block space-y-2">
              <span className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
                项目名
              </span>
              <input
                aria-label="项目名"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="例如：千金归来-demo"
                className="w-full bg-[var(--color-paper)] px-4 py-3 text-[14px] text-[var(--color-ink)] outline-none ring-1 ring-[var(--color-rule)] placeholder:text-[var(--color-ink-faint)] focus:ring-[var(--color-accent)]"
              />
            </label>

            <label className="block space-y-2">
              <span className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
                上传源文档
              </span>
              <input
                aria-label="上传源文档"
                type="file"
                accept=".txt,.md,.markdown,.doc,.docx,.pdf"
                onChange={handleFileChange}
                className="block w-full text-[13px] text-[var(--color-ink-muted)] file:mr-4 file:border-0 file:bg-[var(--color-ink)] file:px-3 file:py-2 file:text-[11px] file:font-semibold file:text-[var(--color-paper)] hover:file:bg-[var(--color-accent)]"
              />
              {file && (
                <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
                  已选择：{file.name}
                </div>
              )}
            </label>

            <button
              type="button"
              onClick={() => onCreate({ projectName, file })}
              disabled={isSubmitting || !projectName.trim() || !file}
              className="bg-[var(--color-ink)] px-4 py-3 font-[Geist,sans-serif] text-[12px] font-semibold text-[var(--color-paper)] disabled:cursor-not-allowed disabled:bg-[var(--color-ink-faint)]"
            >
              {isSubmitting ? "正在初始化…" : "开始"}
            </button>
            {errorMessage && (
              <div className="font-[Geist,sans-serif] text-[12px] text-[var(--color-err)]">
                {errorMessage}
              </div>
            )}
          </div>

          <div className="space-y-4 border-t border-[var(--color-rule)] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
              流程
            </div>
            <ol className="space-y-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>1. 输入项目名</li>
              <li>2. 上传源文档</li>
              <li>3. 初始化工作区与 `pipeline-state.json`</li>
              <li>4. 进入总览并继续推进剧本 / 分镜 / 视频</li>
            </ol>
          </div>
        </section>
      </section>
    </div>
  );
}
