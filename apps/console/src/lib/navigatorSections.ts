export interface NavigatorSection {
  key: "overview" | "inputs" | "catalog" | "script" | "assets" | "episodes";
  label: string;
}

export function buildNavigatorSections(input: {
  hasSource: boolean;
  hasCatalog: boolean;
  hasScript: boolean;
  hasAssets: boolean;
  episodeIds: string[];
}): NavigatorSection[] {
  const sections: NavigatorSection[] = [{ key: "overview", label: "总览" }];
  if (input.hasSource) sections.push({ key: "inputs", label: "输入源" });
  if (input.hasCatalog) sections.push({ key: "catalog", label: "设定目录" });
  if (input.hasScript) sections.push({ key: "script", label: "剧本开发" });
  if (input.hasAssets) sections.push({ key: "assets", label: "素材" });
  if (input.episodeIds.length > 0) sections.push({ key: "episodes", label: "分集视频" });
  return sections;
}
