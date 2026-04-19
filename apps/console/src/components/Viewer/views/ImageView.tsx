import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function ImageView({ projectName, path }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-10 bg-[var(--color-paper-sunk)] gap-4">
      <div className="border border-[var(--color-rule)] p-2 bg-[var(--color-paper)]">
        <img
          src={fileUrl(projectName, path)}
          alt={path}
          className="max-w-[80vw] max-h-[70vh] object-contain block"
        />
      </div>
      <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">{path}</div>
    </div>
  );
}
