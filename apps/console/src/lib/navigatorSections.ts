// input: project production progress flags
// output: stable director/producer navigation sections
// pos: keeps the sidebar centered on production structure instead of raw workspace folders

export type NavigatorGroup = "cross_episode" | "per_episode";

export interface NavigatorSection {
  key: "overview" | "inputs" | "catalog" | "script" | "assets" | "storyboard" | "episodes";
  label: string;
  available: boolean;
  group: NavigatorGroup;
}

export function buildNavigatorSections(input: {
  hasSource: boolean;
  hasCatalog: boolean;
  hasScript: boolean;
  hasAssets: boolean;
  hasStoryboard: boolean;
  episodeIds: string[];
}): NavigatorSection[] {
  return [
    { key: "overview", label: "总览", available: true, group: "cross_episode" },
    { key: "inputs", label: "输入源", available: input.hasSource, group: "cross_episode" },
    { key: "catalog", label: "视觉设定", available: input.hasCatalog, group: "cross_episode" },
    { key: "script", label: "剧本开发", available: input.hasScript, group: "cross_episode" },
    { key: "assets", label: "素材", available: input.hasAssets, group: "cross_episode" },
    { key: "storyboard", label: "故事板", available: input.hasStoryboard, group: "per_episode" },
    { key: "episodes", label: "分集视频", available: input.episodeIds.length > 0, group: "per_episode" },
  ];
}
