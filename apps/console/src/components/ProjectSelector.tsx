// apps/console/src/components/ProjectSelector.tsx
import { useEffect, useState } from "react";
import type { Project } from "../types";

interface Props {
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function ProjectSelector({ selected, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="bg-[oklch(18%_0_0)] border border-[oklch(25%_0_0)] rounded-lg px-3 py-1.5 text-sm text-[oklch(78%_0_0)] focus:outline-none focus:border-[oklch(65%_0.18_270)] transition-colors"
    >
      <option value="">选择项目…</option>
      {projects.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name} · {p.state.current_stage}
        </option>
      ))}
    </select>
  );
}
