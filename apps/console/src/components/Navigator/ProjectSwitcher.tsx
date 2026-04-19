import { useEffect, useState } from "react";
import type { Project } from "../../types";

interface Props {
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function ProjectSwitcher({ selected, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => { if (alive) setProjects(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, []);
  return (
    <label className="flex items-baseline gap-2 cursor-pointer">
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        className="bg-transparent border-0 border-b border-[var(--color-rule-strong)] rounded-none px-1 py-0.5 text-[12px] text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-accent)]"
      >
        <option value="">— 项目 —</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <span className="font-mono text-[10px] text-[var(--color-ink-subtle)] tracking-[0.04em]">
        {projects.length} 个项目
      </span>
    </label>
  );
}
