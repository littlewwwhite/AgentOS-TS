// apps/console/src/components/Navigator/ProjectSwitcher.tsx
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
    <select
      value={selected ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="bg-transparent border border-[oklch(20%_0_0)] rounded px-2 py-1 text-[12px] text-[oklch(75%_0_0)]"
    >
      <option value="">选择项目</option>
      {projects.map((p) => (
        <option key={p.name} value={p.name}>{p.name}</option>
      ))}
    </select>
  );
}
