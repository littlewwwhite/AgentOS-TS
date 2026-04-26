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
import { ObjectHeader } from "./ObjectHeader";
import type { ViewKind } from "../../types";
import { getEditPolicy } from "../../lib/editPolicy";
import { resolveProductionObjectFromPath } from "../../lib/productionObject";

export function shouldShowObjectHeader(kind: ViewKind, path: string): boolean {
  const policy = getEditPolicy(path);
  if (kind === "text" && policy?.contentKind === "text") return false;
  if (kind === "json" && policy?.contentKind === "json") return false;
  if (kind === "storyboard") return false;
  return true;
}

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
  const contentClass =
    active.view === "storyboard"
      ? "flex-1 min-h-0 overflow-hidden overscroll-none"
      : "flex-1 overflow-auto";

  return (
    <div className="h-full min-h-0 flex flex-col">
      <TabBar />
      {shouldShowObjectHeader(active.view, active.path) && (
        <ObjectHeader
          object={resolveProductionObjectFromPath(active.path, { projectId: name })}
          viewKind={active.view}
        />
      )}
      <div className={contentClass}>
        {renderView(active.view, name, active.path)}
      </div>
    </div>
  );
}
