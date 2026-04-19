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
    return <div className="p-6 font-serif italic text-[13px] text-[var(--color-ink-faint)]">Select a project to begin.</div>;
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
        label="Overview"
        status={anyRunning ? "running" : undefined}
        onClick={() => open("", "Overview")}
      />
      {has("output/inspiration.json") && (
        <StageNode
          label="Inspiration"
          status={state?.stages?.INSPIRATION?.status}
          unread={unread.get("output/inspiration.json")}
          onClick={() => { open("output/inspiration.json", "Inspiration"); markSeen("output/inspiration.json"); }}
        />
      )}
      {has("output/script.json") && (
        <StageNode
          label="Script"
          status={state?.stages?.SCRIPT?.status}
          unread={unread.get("output/script.json")}
          onClick={() => { open("output/script.json", "Script"); markSeen("output/script.json"); }}
        />
      )}
      {(hasPrefix("output/actors") || hasPrefix("output/locations") || hasPrefix("output/props")) && (
        <StageNode label="Assets" status={state?.stages?.VISUAL?.status} expandable defaultOpen>
          {hasPrefix("output/actors") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/actors", "Actors"); markSeen("output/actors"); }}
            >Actors</div>
          )}
          {hasPrefix("output/locations") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/locations", "Locations"); markSeen("output/locations"); }}
            >Locations</div>
          )}
          {hasPrefix("output/props") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/props", "Props"); markSeen("output/props"); }}
            >Props</div>
          )}
        </StageNode>
      )}
      {epIds.length > 0 && (
        <StageNode label="Episodes" expandable defaultOpen>
          {epIds.map((id) => (
            <EpisodeNode key={id} epId={id} ep={state?.episodes?.[id]} unread={unread} markSeen={markSeen} />
          ))}
        </StageNode>
      )}
      {has("draft") && (
        <StageNode
          label="Draft"
          unread={unread.get("draft")}
          onClick={() => { open("draft", "Draft"); markSeen("draft"); }}
        />
      )}
    </div>
  );
}
