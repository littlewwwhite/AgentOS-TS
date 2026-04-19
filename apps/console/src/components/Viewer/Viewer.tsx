import { useTabs } from "../../contexts/TabsContext";
import { useProject } from "../../contexts/ProjectContext";
import { TabBar } from "./TabBar";
import { FallbackView } from "./views/FallbackView";

export function Viewer() {
  const { tabs, activeId } = useTabs();
  const { name } = useProject();
  const active = tabs.find((t) => t.id === activeId);

  if (!name) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[oklch(42%_0_0)]">
        请从顶部选择项目
      </div>
    );
  }
  if (!active) {
    return (
      <div className="h-full flex flex-col">
        <TabBar />
        <div className="flex-1 flex items-center justify-center text-sm text-[oklch(42%_0_0)]">
          在左侧导航中单击节点以查看内容
        </div>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 overflow-auto">
        <FallbackView projectName={name} path={active.path} />
      </div>
    </div>
  );
}
