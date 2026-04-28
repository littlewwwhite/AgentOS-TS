// input: raw episode id keys from pipeline-state.json (mixed formats)
// output: canonical episode id + merged EpisodeState across format variants
// pos: bridges legacy `ep_NNN` storyboard keys with new `epNNN` video keys
//      so the Navigator surfaces one node per real episode

import type { EpisodeState } from "../types";

/**
 * Collapse format variants like `ep_001` / `EP001` / `ep001` to canonical `ep001`.
 * Anything that doesn't match the prefix pattern is returned unchanged.
 */
export function canonicalEpisodeId(raw: string): string {
  const match = raw.match(/^(ep)[_\-\s]*(\d+)$/i);
  if (!match) return raw;
  return `ep${match[2]}`;
}

/**
 * Merge multiple raw episode entries into a single canonical map.
 *
 * When two raw keys collapse to the same canonical id (e.g. `ep_001` carrying
 * `storyboard` and `ep001` carrying `video`), their stage nodes are unioned.
 * If both sides define the same stage, the first occurrence wins — this
 * preserves historical "first seen" semantics for migrated state files.
 */
export function mergeEpisodesByCanonicalId(
  episodes: Record<string, EpisodeState> | undefined,
): Record<string, EpisodeState> {
  const merged: Record<string, EpisodeState> = {};
  for (const [rawId, ep] of Object.entries(episodes ?? {})) {
    if (!ep) continue;
    const canon = canonicalEpisodeId(rawId);
    const existing = merged[canon] ?? {};
    merged[canon] = {
      storyboard: existing.storyboard ?? ep.storyboard,
      video: existing.video ?? ep.video,
      editing: existing.editing ?? ep.editing,
      music: existing.music ?? ep.music,
      subtitle: existing.subtitle ?? ep.subtitle,
    };
  }
  return merged;
}
