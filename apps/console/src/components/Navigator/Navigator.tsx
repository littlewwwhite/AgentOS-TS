import { useMemo } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { StageNode } from "./StageNode";
import { EpisodeNode } from "./EpisodeNode";

export function Navigator() {
  const { name, state, tree } = useProject();
  const { openPath } = useTabs();

  const unread = useMemo(() => new Map<string, number>(), []);
  // weak-follow counters are mutated in Task 15; hold the map reference here.

  if (!name) {
    return <div className="p-3 text-[11px] text-[oklch(42%_0_0)]">请选择项目</div>;
  }

  const has = (path: string) => tree.some((n) => n.path === path);
  const hasPrefix = (prefix: string) => tree.some((n) => n.path.startsWith(prefix + "/"));

  function open(path: string, title: string, pinned: boolean) {
    openPath(path, resolveView(path), title, { pinned });
  }

  const epIds = Object.keys(state?.episodes ?? {}).sort();

  return (
    <div className="py-2 overflow-y-auto h-full text-[13px]">
      <StageNode
        label="Overview"
        status={state?.current_stage ? "running" : undefined}
        onClick={() => open("", "Overview", false)}
        onDoubleClick={() => open("", "Overview", true)}
      />
      {has("output/inspiration.json") && (
        <StageNode
          label="Inspiration"
          status={state?.stages?.INSPIRATION?.status}
          onClick={() => open("output/inspiration.json", "Inspiration", false)}
          onDoubleClick={() => open("output/inspiration.json", "Inspiration", true)}
        />
      )}
      {has("output/script.json") && (
        <StageNode
          label="Script"
          status={state?.stages?.SCRIPT?.status}
          onClick={() => open("output/script.json", "Script", false)}
          onDoubleClick={() => open("output/script.json", "Script", true)}
        />
      )}
      {(hasPrefix("output/actors") || hasPrefix("output/locations") || hasPrefix("output/props")) && (
        <StageNode label="Assets" status={state?.stages?.VISUAL?.status} expandable defaultOpen>
          {hasPrefix("output/actors") && (
            <div
              className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
              onClick={() => open("output/actors", "Actors", false)}
              onDoubleClick={() => open("output/actors", "Actors", true)}
            >Actors</div>
          )}
          {hasPrefix("output/locations") && (
            <div
              className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
              onClick={() => open("output/locations", "Locations", false)}
              onDoubleClick={() => open("output/locations", "Locations", true)}
            >Locations</div>
          )}
          {hasPrefix("output/props") && (
            <div
              className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
              onClick={() => open("output/props", "Props", false)}
              onDoubleClick={() => open("output/props", "Props", true)}
            >Props</div>
          )}
        </StageNode>
      )}
      {epIds.length > 0 && (
        <StageNode label="Episodes" expandable defaultOpen>
          {epIds.map((id) => (
            <EpisodeNode key={id} epId={id} ep={state?.episodes?.[id]} unread={unread} />
          ))}
        </StageNode>
      )}
      {has("draft") && (
        <StageNode
          label="Draft"
          onClick={() => open("draft", "Draft", false)}
          onDoubleClick={() => open("draft", "Draft", true)}
        />
      )}
    </div>
  );
}
