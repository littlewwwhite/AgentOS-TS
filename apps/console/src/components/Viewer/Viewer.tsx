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
import type { ViewKind } from "../../types";

function renderView(kind: ViewKind, projectName: string, path: string) {
  switch (kind) {
    case "json": return <JsonView projectName={projectName} path={path} />;
    case "text": return <TextView projectName={projectName} path={path} />;
    case "image": return <ImageView projectName={projectName} path={path} />;
    case "video": return <VideoView projectName={projectName} path={path} />;
    case "asset-gallery": return <AssetGalleryView projectName={projectName} path={path} />;
    case "video-grid": return <VideoGridView projectName={projectName} path={path} />;
    default: return <FallbackView projectName={projectName} path={path} />;
  }
}

export function Viewer() {
  const { tabs, activeId } = useTabs();
  const { name } = useProject();
  const active = tabs.find((t) => t.id === activeId);
  if (!name) return <div className="h-full flex items-center justify-center text-sm text-[oklch(42%_0_0)]">请从顶部选择项目</div>;
  if (!active) return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 flex items-center justify-center text-sm text-[oklch(42%_0_0)]">在左侧导航中单击节点以查看内容</div>
    </div>
  );
  return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 overflow-auto">
        {renderView(active.view, name, active.path)}
      </div>
    </div>
  );
}
