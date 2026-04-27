import { useMemo } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { StageNode } from "./StageNode";
import { EpisodeNode } from "./EpisodeNode";
import { buildNavigatorSections } from "../../lib/navigatorSections";
import type { NavigatorGroup, NavigatorSection } from "../../lib/navigatorSections";
import { STAGE_ORDER } from "../../lib/workflowModel";

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
  const sourcePaths = tree
    .filter((node) => node.type === "file" && (node.path === "source.txt" || node.path.startsWith("input/")))
    .map((node) => node.path)
    .sort();
  const draftEpisodePaths = tree
    .filter((node) => node.type === "file" && /^draft\/episodes\/ep\d+\.md$/i.test(node.path))
    .map((node) => node.path)
    .sort();

  function open(path: string, title: string) {
    openPath(path, resolveView(path), title, { pinned: true });
  }

  const epIds = Object.keys(state?.episodes ?? {}).sort();
  const anyRunning = STAGE_ORDER.some((stage) => state?.stages?.[stage]?.status === "running");
  const sections = buildNavigatorSections({
    hasSource: sourcePaths.length > 0,
    hasCatalog: has("draft/catalog.json"),
    hasScript: has("output/script.json") || has("draft/design.json") || draftEpisodePaths.length > 0,
    hasAssets: hasPrefix("output/actors") || hasPrefix("output/locations") || hasPrefix("output/props"),
    episodeIds: epIds,
  });

  function renderSection(section: NavigatorSection): React.ReactNode {
    if (section.key === "overview") {
      return (
        <StageNode
          key={section.key}
          label={section.label}
          status={anyRunning ? "running" : undefined}
          onClick={() => open("", "总览")}
        />
      );
    }

    if (section.key === "inputs") {
      return (
        <StageNode
          key={section.key}
          label={section.label}
          unread={unread.get("input") ?? unread.get("source.txt")}
          expandable
          defaultOpen
          disabled={!section.available}
        >
          {sourcePaths.map((path) => (
            <div
              key={path}
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open(path, path === "source.txt" ? "源文档" : path); markSeen(path); }}
            >
              {path === "source.txt" ? "源文档" : path.replace(/^input\//, "")}
            </div>
          ))}
        </StageNode>
      );
    }

    if (section.key === "catalog") {
      return (
        <StageNode
          key={section.key}
          label={section.label}
          unread={unread.get("draft/catalog.json")}
          disabled={!section.available}
          pendingLabel="待生成角色、场景、道具"
          onClick={section.available ? () => { open("draft/catalog.json", "视觉设定"); markSeen("draft/catalog.json"); } : undefined}
        />
      );
    }

    if (section.key === "script") {
      return (
        <StageNode
          key={section.key}
          label={section.label}
          status={state?.stages?.SCRIPT?.status}
          unread={unread.get("output/script.json") ?? unread.get("draft")}
          expandable
          defaultOpen
          disabled={!section.available}
        >
          {has("output/script.json") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("output/script.json", "正式剧本"); markSeen("output/script.json"); }}
            >
              正式剧本
            </div>
          )}
          {has("draft/design.json") && (
            <div
              className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
              onClick={() => { open("draft/design.json", "创作设计"); markSeen("draft/design.json"); }}
            >
              创作设计
            </div>
          )}
          {draftEpisodePaths.length > 0 && (
            <StageNode label="分集草稿" unread={unread.get("draft/episodes")} expandable defaultOpen>
              {draftEpisodePaths.map((path) => {
                const episodeId = path.match(/(ep\d+)/i)?.[1]?.toLowerCase() ?? path;
                return (
                  <div
                    key={path}
                    className="pl-6 pr-4 py-1 text-[12px] text-[var(--color-ink-subtle)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
                    onClick={() => { open(path, `${episodeId}/分集草稿`); markSeen(path); }}
                  >
                    {episodeId}
                  </div>
                );
              })}
            </StageNode>
          )}
        </StageNode>
      );
    }

    if (section.key === "assets") {
      return (
        <StageNode key={section.key} label={section.label} status={state?.stages?.VISUAL?.status} expandable defaultOpen disabled={!section.available}>
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
      );
    }

    return (
      <StageNode key={section.key} label={section.label} expandable defaultOpen disabled={!section.available}>
        {epIds.map((id) => (
          <EpisodeNode key={id} epId={id} ep={state?.episodes?.[id]} unread={unread} markSeen={markSeen} />
        ))}
      </StageNode>
    );
  }

  let lastGroup: NavigatorGroup | null = null;
  return (
    <div className="py-4 overflow-y-auto h-full">
      {sections.map((section) => {
        const dividerNeeded = lastGroup === "cross_episode" && section.group === "per_episode" && section.available;
        lastGroup = section.group;
        const node = renderSection(section);
        return (
          <div key={section.key}>
            {dividerNeeded && (
              <div className="my-2 border-t border-[var(--color-rule)]" aria-hidden />
            )}
            {node}
          </div>
        );
      })}
    </div>
  );
}
