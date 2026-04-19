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
    return <div className="px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">暂无图片素材。</div>;
  }

  return (
    <div className="px-10 py-8 space-y-12">
      {groups.map((g) => (
        <section key={g.id}>
          <header className="flex items-baseline gap-3 mb-4">
            <h2 className="font-serif text-[20px] italic text-[var(--color-ink)]">{g.id}</h2>
            <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] tracking-[0.04em]">
              {g.files.length} 项
            </span>
          </header>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {g.files.map((f) => (
              <figure key={f.path} className="space-y-2">
                <button
                  onClick={() => setLightbox(f.path)}
                  className="block w-full aspect-square overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)] hover:border-[var(--color-accent)] transition-colors"
                >
                  <img src={fileUrl(projectName, f.path)} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
                </button>
                <figcaption className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{f.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-[var(--color-ink)]/90 flex items-center justify-center z-50 cursor-zoom-out"
        >
          <img src={fileUrl(projectName, lightbox)} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}
