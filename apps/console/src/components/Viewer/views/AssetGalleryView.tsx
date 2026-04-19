import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import type { TreeNode } from "../../../types";

interface Props { projectName: string; path: string; }

interface Group {
  id: string;
  files: TreeNode[];
}

function isImage(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function AssetGalleryView({ projectName, path }: Props) {
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    const byGroup = new Map<string, TreeNode[]>();
    for (const node of tree) {
      if (node.type !== "file") continue;
      if (!node.path.startsWith(prefix)) continue;
      if (!isImage(node.name)) continue;
      const rel = node.path.slice(prefix.length);
      const group = rel.split("/")[0] ?? "(root)";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(node);
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, files]) => ({ id, files: files.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [tree, path]);

  if (groups.length === 0) {
    return <div className="p-6 text-sm text-[oklch(42%_0_0)]">未发现图片资产</div>;
  }

  return (
    <div className="p-4 space-y-6">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="text-[12px] text-[oklch(55%_0_0)] mb-2">{g.id} · {g.files.length}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {g.files.map((f) => (
              <button
                key={f.path}
                onClick={() => setLightbox(f.path)}
                className="aspect-square overflow-hidden rounded bg-[oklch(14%_0_0)] hover:ring-1 hover:ring-[oklch(65%_0.18_270)]"
              >
                <img src={fileUrl(projectName, f.path)} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 cursor-zoom-out"
        >
          <img src={fileUrl(projectName, lightbox)} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}
