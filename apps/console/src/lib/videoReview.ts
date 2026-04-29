// input: episode video directory, project tree paths, and optional state storyboard artifact
// output: best storyboard path for video review workbench or null fallback
// pos: bridges raw episode video directories to structured storyboard review

function episodeIdFromVideoDir(videoDir: string): string | null {
  const match = videoDir.match(/(?:^|\/)(ep\d+)(?:\/)?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function resolveVideoReviewStoryboardPath(input: {
  videoDir: string;
  treePaths: ReadonlySet<string>;
  stateStoryboardPath?: string | null;
}): string | null {
  const episodeId = episodeIdFromVideoDir(input.videoDir);
  if (!episodeId) return null;

  const candidates = [
    `${input.videoDir.replace(/\/+$/, "")}/${episodeId}_storyboard.json`,
    input.stateStoryboardPath ?? null,
    `output/storyboard/approved/${episodeId}_storyboard.json`,
    `output/storyboard/draft/${episodeId}_storyboard.json`,
  ];

  for (const candidate of candidates) {
    if (candidate && input.treePaths.has(candidate)) return candidate;
  }

  return null;
}
