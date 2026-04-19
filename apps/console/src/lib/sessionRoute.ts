export interface ProjectRouteState {
  project: string | null;
  sessionId: string | null;
}

export function readProjectRoute(search?: string): ProjectRouteState {
  const params = new URLSearchParams(search ?? "");
  const project = params.get("project");
  const sessionId = params.get("session");
  return {
    project: project && project.trim() ? project : null,
    sessionId: sessionId && sessionId.trim() ? sessionId : null,
  };
}

export function buildProjectRouteSearch(
  search: string | undefined,
  route: ProjectRouteState,
): string {
  const params = new URLSearchParams(search ?? "");
  if (route.project) params.set("project", route.project);
  else params.delete("project");

  if (route.project && route.sessionId) params.set("session", route.sessionId);
  else params.delete("session");

  const next = params.toString();
  return next ? `?${next}` : "";
}
