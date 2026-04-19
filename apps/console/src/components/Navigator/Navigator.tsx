import { useMemo } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { StageNode } from "./StageNode";
import { EpisodeNode } from "./EpisodeNode";

export function Navigator() {
  const { name, state, tree, unread, markSeen } = useProject();
  const { openPath } = useTabs();

  const paths = useMemo(() => new Set(tree.map((n) => n.path)), [tree]);
  const prefixes = useMemo(() => {
    const s = new Set<string>();
    for (const n of tree) {
      const segs = n.path.split("/");
      for (let i = 1; i < segs.length; i++) s.add(segs.slice(0, i).join("/"));
    }
    return s;
  }, [tree]);

  if (!name) {
    return <div className="p-6 font-serif italic text-[13px] text-[var(--color-ink-faint)]">选择一个项目以开始。</div>;
  }

  const has = (path: string) => paths.has(path);
  const hasPrefix = (prefix: string) => prefixes.has(prefix);

  function open(path: string, title: string) {
    openPath(path, resolveView(path), title, { pinned: true });
  }

  const epIds = Object.keys(state?.episodes ?? {}).sort();
  const anyRunning = Object.values(state?.stages ?? {}).some((s) => s.status === "running");

  return (
    <div className="py-4 overflow-y-auto h-full">
      <StageNode
        label="总览"
        status={anyRunning ? "running" : undefined}
        onClick={() => open("", "总览")}
      />
      {has("output/inspiration.json") && (
        <StageNode
          label="灵感"
          status={state?.stages?.INSPIRATION?.status}
          unread={unread.get("output/inspiration.json")}
          onClick={() => { open("output/inspiration.json", "灵感"); markSeen("output/inspiration.json"); }}
        />
      )}
      {has("output/script.json") && (
        <StageNode
          label="剧本"
          status={state?.stages?.SCRIPT?.status}
          unread={unread.get("output/script.json")}
          onClick={() => { open("output/script.json", "剧本"); markSeen("output/script.json"); }}
        />
      )}
      {(hasPrefix("output/actors") || hasPrefix("output/locations") || hasPrefix("output/props")) && (
        <StageNode label="素材" status={state?.stages?.VISUAL?.status} expandable defaultOpen>
          {hasPrefix("output/actors") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/actors", "演员"); markSeen("output/actors"); }}
            >演员</div>
          )}
          {hasPrefix("output/locations") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/locations", "场景"); markSeen("output/locations"); }}
            >场景</div>
          )}
          {hasPrefix("output/props") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/props", "道具"); markSeen("output/props"); }}
            >道具</div>
          )}
        </StageNode>
      )}
      {epIds.length > 0 && (
        <StageNode label="分集" expandable defaultOpen>
          {epIds.map((id) => (
            <EpisodeNode key={id} epId={id} ep={state?.episodes?.[id]} unread={unread} markSeen={markSeen} />
          ))}
        </StageNode>
      )}
      {has("draft") && (
        <StageNode
          label="草稿"
          unread={unread.get("draft")}
          onClick={() => { open("draft", "草稿"); markSeen("draft"); }}
        />
      )}
    </div>
  );
}
