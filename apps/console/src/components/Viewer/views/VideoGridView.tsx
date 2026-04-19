import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import type { TreeNode } from "../../../types";

interface Props { projectName: string; path: string; }

function isVideo(name: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(name);
}

export function VideoGridView({ projectName, path }: Props) {
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const videos: TreeNode[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    return tree
      .filter((n) => n.type === "file" && isVideo(n.name) && n.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [tree, path]);

  if (videos.length === 0) {
    return <div className="px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">No video files found.</div>;
  }

  return (
    <div className="px-10 py-8">
      <header className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] uppercase tracking-wider">
          {videos.length} clips
        </span>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        {videos.map((v) => (
          <figure key={v.path} className="space-y-2">
            <button
              onClick={() => setLightbox(v.path)}
              className="block w-full aspect-video overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)] hover:border-[var(--color-accent)] transition-colors"
            >
              <video src={fileUrl(projectName, v.path) + "#t=0.5"} preload="metadata" muted className="w-full h-full object-cover" />
            </button>
            <figcaption className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{v.path}</figcaption>
          </figure>
        ))}
      </div>
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-[var(--color-ink)]/95 flex items-center justify-center z-50 cursor-zoom-out p-8"
        >
          <video
            src={fileUrl(projectName, lightbox)}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
