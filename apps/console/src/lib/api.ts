import type { PipelineState, Project } from "../types";

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(name: string): Promise<PipelineState> {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Project not found: ${name}`);
  return res.json();
}
