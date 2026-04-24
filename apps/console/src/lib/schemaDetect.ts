export type JsonSchemaKind = "script" | "storyboard" | "pipeline-state" | "generic";

export function detectSchema(data: unknown): JsonSchemaKind {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return "generic";
  const o = data as Record<string, unknown>;
  if ("stages" in o && "episodes" in o && "current_stage" in o) return "pipeline-state";
  if (!Array.isArray(o.episodes) && Array.isArray(o.scenes)) {
    const firstScene = (o.scenes as unknown[])[0];
    if (firstScene && typeof firstScene === "object") {
      const shots = (firstScene as Record<string, unknown>).shots;
      if (Array.isArray(shots) && shots.some((s) => s && typeof s === "object" && "prompt" in (s as object))) {
        return "storyboard";
      }
    }
  }
  if (Array.isArray(o.episodes) && o.episodes.length > 0) return "script";
  return "generic";
}
