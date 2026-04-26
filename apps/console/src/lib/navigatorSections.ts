// input: project production progress flags
// output: stable director/producer navigation sections
// pos: keeps the sidebar centered on production structure instead of raw workspace folders

export interface NavigatorSection {
  key: "overview" | "inputs" | "catalog" | "script" | "assets" | "storyboard" | "episodes";
  label: string;
  available: boolean;
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
    { key: "overview", label: "总览", available: true },
    { key: "inputs", label: "输入源", available: input.hasSource },
    { key: "catalog", label: "视觉设定", available: input.hasCatalog },
    { key: "script", label: "剧本开发", available: input.hasScript },
    { key: "assets", label: "素材", available: input.hasAssets },
    { key: "storyboard", label: "故事板", available: input.hasStoryboard },
    { key: "episodes", label: "分集视频", available: input.episodeIds.length > 0 },
  ];
}
