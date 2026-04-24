import type { EpisodeState, StageStatus } from "../types";

const SUCCESS_STATUSES: StageStatus[] = [
  "locked",
  "approved",
  "validated",
  "completed",
  "superseded",
];

export function rollupEpisodeStatus(ep: EpisodeState | undefined): StageStatus {
  if (!ep) return "not_started";

  const statuses = [ep.storyboard, ep.video, ep.editing, ep.music, ep.subtitle]
    .map((node) => node?.status)
    .filter((status): status is StageStatus => !!status);

  if (statuses.length === 0) return "not_started";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("change_requested")) return "change_requested";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("in_review")) return "in_review";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("partial")) return "partial";

  const hasStarted = statuses.some((status) => status !== "not_started");
  const hasPending = statuses.includes("not_started");
  if (hasStarted && hasPending) return "partial";

  for (const status of SUCCESS_STATUSES) {
    if (statuses.includes(status)) return status;
  }

  return "not_started";
}
