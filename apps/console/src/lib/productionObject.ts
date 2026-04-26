// input: project-relative workspace paths and optional project identity
// output: production object identity, labels, lineage, decision scope, and action hints
// pos: domain translation layer between storage artifacts and director/producer UI

export type AssetType = "actor" | "location" | "prop";
export type EpisodeArtifactRole = "storyboard" | "video" | "editing" | "music" | "subtitle" | "delivery";

export type ProductionObject =
  | { type: "project"; projectId: string | null }
  | { type: "script"; path: string }
  | { type: "episode"; episodeId: string; artifactRole?: EpisodeArtifactRole; path?: string }
  | { type: "scene"; episodeId: string; sceneId: string; path?: string }
  | { type: "shot"; episodeId: string; sceneId?: string; shotId: string; path?: string }
  | { type: "asset"; assetType: AssetType; assetId?: string; path: string }
  | { type: "artifact"; path: string };

export interface DecisionScope {
  defaultScope: string;
  affects: string[];
  preserves: string[];
}

interface ResolveOptions {
  projectId?: string | null;
}

const ASSET_SEGMENT_TO_TYPE: Record<string, AssetType> = {
  actors: "actor",
  locations: "location",
  props: "prop",
};

const ASSET_TYPE_TO_SEGMENT: Record<AssetType, string> = {
  actor: "actors",
  location: "locations",
  prop: "props",
};

const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  actor: "Actor",
  location: "Location",
  prop: "Prop",
};

const EPISODE_ROLE_LABEL: Record<EpisodeArtifactRole, string> = {
  storyboard: "Storyboard",
  video: "Video",
  editing: "Editing",
  music: "Music",
  subtitle: "Subtitle",
  delivery: "Delivery",
};

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function normalizeEpisodeId(value: string): string {
  const digits = value.match(/\d+/)?.[0] ?? value;
  return `ep${digits.padStart(3, "0")}`;
}

export function storyboardEpisodeIdFromPath(path: string): string | null {
  const match = path.match(/(?:^|\/)(ep_?\d+)(?:_storyboard|\.shots)\.json$/i);
  return match ? normalizeEpisodeId(match[1]) : null;
}

export function isStoryboardArtifactPath(path: string): boolean {
  return storyboardEpisodeIdFromPath(path) !== null && (
    /^output\/storyboard\/(draft|approved)\//i.test(path) ||
    /^draft\/storyboard\//i.test(path)
  );
}

function episodeRoleFromPath(path: string): EpisodeArtifactRole | undefined {
  if (path.includes("/storyboard/") || path.endsWith("_storyboard.json") || path.endsWith(".shots.json")) return "storyboard";
  if (path.includes("/edited/") || path.includes("/editing/")) return "editing";
  if (path.includes("/music/") || path.includes("/scored/")) return "music";
  if (path.includes("/subtitle") || path.includes("/final/")) return "subtitle";
  if (path.endsWith("_delivery.json")) return "delivery";
  if (/\.(mp4|webm|mov)$/i.test(path) || /\/raw(?:\/|$)/.test(path)) return "video";
  return undefined;
}

export function resolveProductionObjectFromPath(path: string, options: ResolveOptions = {}): ProductionObject {
  if (!path) return { type: "project", projectId: options.projectId ?? null };
  if (path === "output/script.json") return { type: "script", path };

  const segments = path.split("/").filter(Boolean);
  const assetIndex = segments.findIndex((segment) => segment in ASSET_SEGMENT_TO_TYPE);
  if (assetIndex >= 0) {
    const assetSegment = segments[assetIndex];
    const assetType = ASSET_SEGMENT_TO_TYPE[assetSegment];
    const assetId = segments[assetIndex + 1];
    const isManifest = assetId === `${ASSET_TYPE_TO_SEGMENT[assetType]}.json`;
    return assetId && !isManifest ? { type: "asset", assetType, assetId, path } : { type: "asset", assetType, path };
  }

  const shotMatch = path.match(/(?:^|\/)(ep\d+)\/(scn\d+)\/(clip\d+)(?:\/|$)/);
  if (shotMatch) {
    return { type: "shot", episodeId: shotMatch[1], sceneId: shotMatch[2], shotId: shotMatch[3], path };
  }

  const filenameShotMatch = path.match(/(?:^|\/)(ep\d+)\/(scn\d+)\/[^/]*?(clip\d+)[^/]*\.(?:mp4|webm|mov)$/i);
  if (filenameShotMatch) {
    return {
      type: "shot",
      episodeId: filenameShotMatch[1],
      sceneId: filenameShotMatch[2],
      shotId: filenameShotMatch[3],
      path,
    };
  }

  const sceneMatch = path.match(/(?:^|\/)(ep\d+)\/(scn\d+)(?:\/|$)/);
  if (sceneMatch) return { type: "scene", episodeId: sceneMatch[1], sceneId: sceneMatch[2], path };

  const storyboardEpisodeId = storyboardEpisodeIdFromPath(path);
  if (storyboardEpisodeId) return { type: "episode", episodeId: storyboardEpisodeId, artifactRole: "storyboard", path };

  const draftEpisodeMatch = path.match(/^draft\/episodes\/(ep\d+)\.md$/i);
  if (draftEpisodeMatch) return { type: "episode", episodeId: draftEpisodeMatch[1].toLowerCase(), path };

  const episodeMatch = path.match(/(?:^|\/)(ep\d+)(?:\/|$)/);
  if (episodeMatch) return { type: "episode", episodeId: episodeMatch[1], artifactRole: episodeRoleFromPath(path), path };

  return { type: "artifact", path };
}

export function getProductionObjectLabel(object: ProductionObject): string {
  switch (object.type) {
    case "project": return object.projectId ?? "Project";
    case "script": return "Script";
    case "episode": return object.artifactRole ? `${object.episodeId} · ${EPISODE_ROLE_LABEL[object.artifactRole]}` : object.episodeId;
    case "scene": return `${object.episodeId} · ${object.sceneId}`;
    case "shot": return [object.episodeId, object.sceneId, object.shotId].filter(Boolean).join(" · ");
    case "asset": return object.assetId ? `${ASSET_TYPE_LABEL[object.assetType]} · ${object.assetId}` : `${titleCase(object.assetType)}s`;
    case "artifact": return basename(object.path);
  }
}

export function getProductionObjectLineage(object: ProductionObject): string[] {
  switch (object.type) {
    case "project": return ["project"];
    case "script": return ["source", "script"];
    case "asset": return ["script entities", "visual assets"];
    case "episode": return ["script", object.artifactRole ?? "episode"];
    case "scene": return ["script", "storyboard", "scene"];
    case "shot": return ["script", "storyboard", "video shot"];
    case "artifact": return ["workspace artifact"];
  }
}

export function getProductionObjectScope(object: ProductionObject): DecisionScope {
  switch (object.type) {
    case "project": return {
      defaultScope: "entire project",
      affects: ["pipeline state", "all episodes"],
      preserves: [],
    };
    case "script": return {
      defaultScope: "canonical script",
      affects: ["story structure", "downstream assets/storyboards/videos"],
      preserves: ["source material"],
    };
    case "asset": return {
      defaultScope: object.assetId ? "current asset" : `${object.assetType} library`,
      affects: ["visual identity", "downstream storyboard/video consistency"],
      preserves: ["script text"],
    };
    case "episode": return {
      defaultScope: object.artifactRole ? `current episode ${object.artifactRole}` : "current episode",
      affects: object.artifactRole === "storyboard" ? ["storyboard", "downstream video"] : ["current episode artifact"],
      preserves: ["other episodes", "source material"],
    };
    case "scene": return {
      defaultScope: "current scene",
      affects: ["scene pacing", "scene shots"],
      preserves: ["other scenes", "source material"],
    };
    case "shot": return {
      defaultScope: "current shot",
      affects: ["shot video candidate"],
      preserves: ["script", "storyboard", "registered assets"],
    };
    case "artifact": return {
      defaultScope: "current artifact",
      affects: ["selected file"],
      preserves: ["unrelated artifacts"],
    };
  }
}

export function getProductionObjectAvailableActions(object: ProductionObject): string[] {
  switch (object.type) {
    case "project": return ["continue production", "inspect blockers", "open decision inbox"];
    case "script": return ["approve script", "request script revision", "lock script"];
    case "asset": return ["approve asset", "request visual revision", "compare references"];
    case "episode": return ["approve episode artifact", "request episode revision", "rerun downstream stage"];
    case "scene": return ["approve scene", "request scene revision", "inspect scene shots"];
    case "shot": return ["approve shot", "request shot revision", "regenerate shot variants"];
    case "artifact": return ["inspect artifact", "open raw file"];
  }
}
