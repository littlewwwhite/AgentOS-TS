import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import { resolveVideoReviewStoryboardPath } from "../../../lib/videoReview";
import type { TreeNode } from "../../../types";
import { StoryboardView } from "./StoryboardView";

interface Props { projectName: string; path: string; }

function isVideo(name: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(name);
}

function episodeIdFromDir(path: string): string | null {
  return path.match(/(?:^|\/)(ep_?\d+)(?:\/)?$/i)?.[1]?.toLowerCase().replace(/_/g, "") ?? null;
}

export function VideoGridView({ projectName, path }: Props) {
  const { tree, state } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const treePaths = useMemo(() => new Set(tree.map((node) => node.path)), [tree]);
  const episodeId = episodeIdFromDir(path);
  const storyboardPath = useMemo(
    () => resolveVideoReviewStoryboardPath({
      videoDir: path,
      treePaths,
      stateStoryboardPath: episodeId ? state?.episodes?.[episodeId]?.storyboard?.artifact : null,
    }),
    [episodeId, path, state?.episodes, treePaths],
  );

  const videos: TreeNode[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    return tree
      .filter((n) => n.type === "file" && isVideo(n.name) && n.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [tree, path]);

  if (storyboardPath) {
    return <StoryboardView projectName={projectName} path={storyboardPath} />;
  }

  if (videos.length === 0) {
    return (
      <div className="h-full overflow-auto px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">
        暂无视频文件。
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-10 py-8">
      {episodeId && (
        <div className="mb-4 border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-2 font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-muted)]">
          未找到分镜结构，按文件展示视频
        </div>
      )}
      <header className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] tracking-[0.04em]">
          {videos.length} 个片段
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
