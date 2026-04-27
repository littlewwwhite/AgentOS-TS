// input: episode id + EpisodeState slice
// output: ordered rows describing each per-episode sub-stage in MVP scope
// pos: pure mapper used by EpisodeNode to render its expanded children

import type { EpisodeState, StageStatus } from "../types";

export interface EpisodeSubStageRow {
  stage: "STORYBOARD" | "VIDEO";
  label: string;
  status: StageStatus;
  path: string;
  title: string;
}

const PER_EPISODE_MVP_STAGES = ["STORYBOARD", "VIDEO"] as const;

export function buildEpisodeSubStages(
  epId: string,
  ep: EpisodeState | undefined,
): EpisodeSubStageRow[] {
  return PER_EPISODE_MVP_STAGES.map((stage) => {
    if (stage === "STORYBOARD") {
      return {
        stage,
        label: "故事板",
        status: ep?.storyboard?.status ?? "not_started",
        path: ep?.storyboard?.artifact ?? `output/storyboard/draft/${epId}_storyboard.json`,
        title: `${epId}/故事板`,
      };
    }
    return {
      stage: "VIDEO",
      label: "视频",
      status: ep?.video?.status ?? "not_started",
      path: `output/${epId}`,
      title: `${epId}/视频`,
    };
  });
}
