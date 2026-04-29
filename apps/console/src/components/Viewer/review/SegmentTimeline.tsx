// input: storyboard editor clips, current selection, and project media paths
// output: XiaoYunque-style horizontal segment timeline
// pos: shared timeline strip for storyboard and video review workbenches

import { fileUrl } from "../../../lib/fileUrl";
import type { StoryboardEditorClip } from "../../../lib/storyboard";

interface Props {
  projectName: string;
  clips: StoryboardEditorClip[];
  currentClipKey: string;
  availablePaths: Set<string>;
  episodeTime: number;
  totalDuration: number;
  onSelectClip: (clipKey: string) => void;
}

function timecodeLabel(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function durationLabel(duration: number): string {
  return timecodeLabel(duration);
}

export function SegmentTimeline({
  projectName,
  clips,
  currentClipKey,
  availablePaths,
  episodeTime,
  totalDuration,
  onSelectClip,
}: Props) {
  return (
    <section
      aria-label="视频片段轨"
      className="min-h-0 overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-3"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center text-[var(--color-ink)]"
            aria-label="按时间线播放"
          >
            <span aria-hidden>▶</span>
          </button>
          <span className="font-[Geist,sans-serif] text-[13px] text-[var(--color-ink-muted)]">
            {timecodeLabel(episodeTime)} / {timecodeLabel(totalDuration)}
          </span>
        </div>
        <button
          type="button"
          disabled
          className="font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
        >
          多选
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max items-stretch gap-3">
          {clips.map((clip, index) => {
            const active = clip.key === currentClipKey;
            const exists = availablePaths.has(clip.videoPath);
            const width = Math.max(128, Math.min(172, Math.round(clip.totalDuration * 12)));

            return (
              <button
                key={clip.key}
                type="button"
                onClick={() => onSelectClip(clip.key)}
                title={clip.displayText || `${clip.sceneId} ${clip.clipId}`}
                aria-current={active ? "true" : undefined}
                className={
                  "relative h-[82px] shrink-0 overflow-hidden border bg-[var(--color-paper-sunk)] text-left transition-colors " +
                  (active
                    ? "border-[var(--color-ink)] ring-1 ring-[var(--color-ink)]"
                    : "border-[var(--color-rule)] hover:border-[var(--color-accent)]")
                }
                style={{ width: `${width}px` }}
              >
                {exists ? (
                  <video
                    src={`${fileUrl(projectName, clip.videoPath)}#t=0.5`}
                    preload="metadata"
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[var(--color-paper-sunk)] font-mono text-[10px] text-[var(--color-ink-faint)]">
                    片段 {index + 1}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_0%,rgba(0,0,0,0.38)_100%)]" />
                <span className="absolute left-1.5 top-1.5 inline-flex h-5 min-w-5 items-center justify-center bg-black/55 px-1.5 font-mono text-[10px] text-white">
                  {index + 1}
                </span>
                <span className="sr-only">片段 {index + 1}</span>
                <span className="absolute bottom-1.5 left-1.5 bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {durationLabel(clip.totalDuration)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
