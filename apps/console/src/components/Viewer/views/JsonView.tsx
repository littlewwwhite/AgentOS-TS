import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

export function JsonView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (text == null) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  let pretty: string;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); }
  catch { pretty = text; }
  return <pre className="p-4 text-[12px] text-[oklch(75%_0_0)] font-mono whitespace-pre-wrap">{pretty}</pre>;
}
