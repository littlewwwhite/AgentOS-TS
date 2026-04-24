import { useFileText } from "../../../hooks/useFile";
import { getEditPolicy } from "../../../lib/editPolicy";
import { useProject } from "../../../contexts/ProjectContext";
import { RawFileEditor } from "../../common/RawFileEditor";

interface Props { projectName: string; path: string; }

export function TextView({ projectName, path }: Props) {
  const { refresh } = useProject();
  const policy = getEditPolicy(path);
  if (policy?.contentKind === "text") {
    return <RawFileEditor projectName={projectName} path={path} contentKind="text" onSaved={refresh} />;
  }

  const { text, error } = useFileText(projectName, path);
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">加载失败：{error}</div>;
  if (text == null) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">加载中…</div>;
  return (
    <div className="px-10 py-10 bg-[var(--color-paper-sunk)] min-h-full">
      <pre className="max-w-[72ch] font-sans text-[15px] leading-[1.6] text-[var(--color-ink)] whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}
