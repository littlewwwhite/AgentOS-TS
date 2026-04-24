import { useState } from "react";
import { useTabs } from "../../contexts/TabsContext";
import { useProject } from "../../contexts/ProjectContext";
import { TabBar } from "./TabBar";
import { FallbackView } from "./views/FallbackView";
import { JsonView } from "./views/JsonView";
import { TextView } from "./views/TextView";
import { ImageView } from "./views/ImageView";
import { VideoView } from "./views/VideoView";
import { AssetGalleryView } from "./views/AssetGalleryView";
import { VideoGridView } from "./views/VideoGridView";
import { ScriptView } from "./views/ScriptView";
import { StoryboardView } from "./views/StoryboardView";
import { OverviewView } from "./views/OverviewView";
import { ProjectOnboardingView } from "./views/ProjectOnboardingView";
import type { ViewKind } from "../../types";

function renderView(kind: ViewKind, projectName: string, path: string) {
  switch (kind) {
    case "json": return <JsonView projectName={projectName} path={path} />;
    case "text": return <TextView projectName={projectName} path={path} />;
    case "image": return <ImageView projectName={projectName} path={path} />;
    case "video": return <VideoView projectName={projectName} path={path} />;
    case "asset-gallery": return <AssetGalleryView projectName={projectName} path={path} />;
    case "video-grid": return <VideoGridView projectName={projectName} path={path} />;
    case "script": return <ScriptView projectName={projectName} path={path} />;
    case "storyboard": return <StoryboardView projectName={projectName} path={path} />;
    case "overview": return <OverviewView />;
    default: return <FallbackView projectName={projectName} path={path} />;
  }
}

function kindLabel(kind: ViewKind): string {
  switch (kind) {
    case "json": return "JSON";
    case "text": return "TEXT";
    case "image": return "IMAGE";
    case "video": return "VIDEO";
    case "asset-gallery": return "GALLERY";
    case "video-grid": return "VIDEO GRID";
    case "script": return "SCRIPT";
    case "storyboard": return "STORYBOARD";
    case "overview": return "OVERVIEW";
    default: return "FILE";
  }
}

export function Viewer() {
  const { tabs, activeId, openPath } = useTabs();
  const { name, setName, refresh } = useProject();
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const active = tabs.find((t) => t.id === activeId);
  if (!name) {
    return (
      <ProjectOnboardingView
        isSubmitting={isBootstrapping}
        errorMessage={bootstrapError}
        onCreate={async ({ projectName, file }) => {
          if (!projectName.trim() || !file) return;
          setIsBootstrapping(true);
          setBootstrapError(null);
          try {
            const body = new FormData();
            body.set("projectName", projectName.trim());
            body.set("file", file);

            const response = await fetch("/api/projects/bootstrap", {
              method: "POST",
              body,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(typeof payload.error === "string" ? payload.error : `bootstrap failed: ${response.status}`);
            }
            if (typeof payload.project === "string") {
              setName(payload.project);
              refresh();
              openPath("", "overview", "总览", { pinned: true });
            }
          } catch (err) {
            setBootstrapError(err instanceof Error ? err.message : String(err));
          } finally {
            setIsBootstrapping(false);
          }
        }}
      />
    );
  }
  if (!active) {
    return (
      <div className="h-full flex flex-col">
        <TabBar />
        <FallbackView projectName={name} path="" />
      </div>
    );
  }
  const displayPath = active.path ? `workspace/${name}/${active.path}` : `workspace/${name}`;
  const contentClass =
    active.view === "storyboard"
      ? "flex-1 min-h-0 overflow-hidden overscroll-none"
      : "flex-1 overflow-auto";

  return (
    <div className="h-full min-h-0 flex flex-col">
      <TabBar />
      <div className="flex items-center justify-between px-6 py-2 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] shrink-0">
        <span className="font-mono text-[11px] text-[var(--color-ink-muted)] truncate">
          {displayPath}
        </span>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)] shrink-0 ml-4">
          {kindLabel(active.view)}
        </span>
      </div>
      <div className={contentClass}>
        {renderView(active.view, name, active.path)}
      </div>
    </div>
  );
}
