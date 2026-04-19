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
    return <div className="p-6 text-sm text-[oklch(42%_0_0)]">未发现视频文件</div>;
  }

  return (
    <div className="p-4">
      <div className="text-[12px] text-[oklch(55%_0_0)] mb-2">{videos.length} 个视频</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {videos.map((v) => (
          <button
            key={v.path}
            onClick={() => setLightbox(v.path)}
            className="aspect-video rounded overflow-hidden bg-black hover:ring-1 hover:ring-[oklch(65%_0.18_270)] text-left"
          >
            <video src={fileUrl(projectName, v.path) + "#t=0.5"} preload="metadata" muted className="w-full h-full object-cover" />
            <div className="px-2 py-1 text-[11px] text-[oklch(55%_0_0)] truncate">{v.path}</div>
          </button>
        ))}
      </div>
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 cursor-zoom-out p-8"
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
