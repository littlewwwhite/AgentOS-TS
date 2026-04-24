import type { StageStatus } from "../types";

export const STAGE_ORDER = [
  "SCRIPT",
  "VISUAL",
  "STORYBOARD",
  "VIDEO",
  "EDITING",
  "MUSIC",
  "SUBTITLE",
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

export const MVP_STAGE_ORDER = [
  "SCRIPT",
  "VISUAL",
  "STORYBOARD",
  "VIDEO",
] as const satisfies ReadonlyArray<StageName>;

export const STAGE_OWNER: Record<StageName, string> = {
  SCRIPT: "writer",
  VISUAL: "visual",
  STORYBOARD: "director",
  VIDEO: "production",
  EDITING: "post",
  MUSIC: "post",
  SUBTITLE: "post",
};

export function isStageName(stage: string): stage is StageName {
  return (STAGE_ORDER as ReadonlyArray<string>).includes(stage);
}

const TERMINAL_STAGE_STATUSES: ReadonlyArray<StageStatus> = [
  "completed",
  "validated",
  "approved",
  "locked",
  "superseded",
];

export function nextStageName(stage: StageName): StageName | null {
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0 || index >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[index + 1];
}

export function isTerminalStageStatus(status: StageStatus | undefined): boolean {
  return !!status && TERMINAL_STAGE_STATUSES.includes(status);
}
