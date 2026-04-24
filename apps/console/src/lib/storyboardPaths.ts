function normalizeEpisodeId(episodeId: string): string {
  return episodeId.trim().toLowerCase().replace(/_/g, "");
}

export function episodeIdFromStoryboardPath(path: string): string | null {
  const match =
    path.match(/(?:^|\/)(ep_?\d+)(?=_storyboard\.json$|\.shots\.json$|\.json$)/i) ??
    path.match(/(?:^|\/)(ep_?\d+)(?=\/)/i);
  return match ? normalizeEpisodeId(match[1]) : null;
}

export function approvedStoryboardPathForEpisode(episodeId: string): string {
  const normalized = normalizeEpisodeId(episodeId);
  return `output/storyboard/approved/${normalized}_storyboard.json`;
}

export function approvedStoryboardPathFromAnyPath(path: string): string | null {
  const episodeId = episodeIdFromStoryboardPath(path);
  return episodeId ? approvedStoryboardPathForEpisode(episodeId) : null;
}

export function isApprovedStoryboardPath(path: string): boolean {
  return /^output\/storyboard\/approved\/ep\d+_storyboard\.json$/i.test(path);
}

export function episodeRuntimeDirForStoryboardPath(path: string): string {
  const episodeId = episodeIdFromStoryboardPath(path);
  if (!episodeId) {
    const slash = path.lastIndexOf("/");
    return slash >= 0 ? path.slice(0, slash) : "";
  }
  if (isApprovedStoryboardPath(path)) {
    return `output/${episodeId}`;
  }
  if (new RegExp(`^output/${episodeId}/${episodeId}_storyboard\\.json$`, "i").test(path)) {
    return `output/${episodeId}`;
  }
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}
