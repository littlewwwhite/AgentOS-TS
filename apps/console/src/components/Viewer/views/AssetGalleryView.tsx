// input: project asset directory path (output/actors|locations|props)
// output: structured gallery driven by *.json + script.json occurrence counts
// pos: production-truth view of every actor/location/prop with full asset coverage

import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { useFileJson } from "../../../hooks/useFile";
import { fileUrl } from "../../../lib/fileUrl";
import type { ScriptJson } from "../../../lib/fountain";
import type { TreeNode } from "../../../types";

interface Props {
  projectName: string;
  path: string;
}

type AssetKind = "actor" | "location" | "prop" | "unknown";

interface ActorStateAssets {
  state: string;
  face?: { src: string };
  side?: { src: string };
  back?: { src: string };
  threeView?: { src: string };
  headCloseup?: { src: string };
}

interface ActorEntry {
  id: string;
  name: string;
  count: number;
  states: ActorStateAssets[];
}

interface SimpleEntry {
  id: string;
  name: string;
  count: number;
  primary?: { src: string; label: string };
  secondary?: { src: string; label: string };
}

const KIND_TITLE: Record<Exclude<AssetKind, "unknown">, string> = {
  actor: "演员素材",
  location: "场景素材",
  prop: "道具素材",
};

function detectKind(path: string): AssetKind {
  if (path.endsWith("/actors") || path === "output/actors") return "actor";
  if (path.endsWith("/locations") || path === "output/locations") return "location";
  if (path.endsWith("/props") || path === "output/props") return "prop";
  return "unknown";
}

function imageSrc(
  projectName: string,
  urlField: string | undefined,
  pathField: string | undefined,
  fallbackPrefix: string,
): string | null {
  if (urlField && /^https?:\/\//.test(urlField)) return urlField;
  if (!pathField) return null;
  const stripped = pathField.replace(/^workspace\/[^/]+\//, "");
  const rel = stripped.startsWith("output/") ? stripped : `${fallbackPrefix}${stripped}`;
  return fileUrl(projectName, rel);
}

function compareEntries<T extends { count: number; name: string; id: string }>(a: T, b: T): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.name && b.name) return a.name.localeCompare(b.name, "zh-Hans-CN");
  return a.id.localeCompare(b.id);
}

function countOccurrences(script: ScriptJson | null): {
  actor: Map<string, number>;
  location: Map<string, number>;
  prop: Map<string, number>;
} {
  const actor = new Map<string, number>();
  const location = new Map<string, number>();
  const prop = new Map<string, number>();
  for (const ep of script?.episodes ?? []) {
    for (const scene of ep.scenes ?? []) {
      for (const a of scene.actors ?? []) {
        if (a.actor_id) actor.set(a.actor_id, (actor.get(a.actor_id) ?? 0) + 1);
      }
      for (const l of scene.locations ?? []) {
        if (l.location_id) location.set(l.location_id, (location.get(l.location_id) ?? 0) + 1);
      }
      for (const p of scene.props ?? []) {
        if (p.prop_id) prop.set(p.prop_id, (prop.get(p.prop_id) ?? 0) + 1);
      }
    }
  }
  return { actor, location, prop };
}

function buildActorEntries(
  json: Record<string, unknown> | null,
  counts: Map<string, number>,
  projectName: string,
): ActorEntry[] {
  if (!json) return [];
  const entries: ActorEntry[] = [];
  for (const [id, raw] of Object.entries(json)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : id;
    const states: ActorStateAssets[] = [];
    for (const [stateKey, stateValue] of Object.entries(record)) {
      if (stateKey === "name" || stateKey === "voice" || stateKey === "voice_url") continue;
      if (!stateValue || typeof stateValue !== "object") continue;
      const s = stateValue as Record<string, unknown>;
      const stateAssets: ActorStateAssets = { state: stateKey };
      const pickField = (urlKey: string, pathKey: string) => {
        const url = typeof s[urlKey] === "string" ? (s[urlKey] as string) : undefined;
        const p = typeof s[pathKey] === "string" ? (s[pathKey] as string) : undefined;
        const src = imageSrc(projectName, url, p, "output/actors/");
        return src ? { src } : undefined;
      };
      stateAssets.face = pickField("face_view_url", "face_view");
      stateAssets.side = pickField("side_view_url", "side_view");
      stateAssets.back = pickField("back_view_url", "back_view");
      stateAssets.threeView = pickField("three_view_url", "three_view");
      stateAssets.headCloseup = pickField("head_closeup_url", "head_closeup");
      const hasAny =
        stateAssets.face ||
        stateAssets.side ||
        stateAssets.back ||
        stateAssets.threeView ||
        stateAssets.headCloseup;
      if (hasAny) states.push(stateAssets);
    }
    states.sort((a, b) => {
      if (a.state === "default") return -1;
      if (b.state === "default") return 1;
      return a.state.localeCompare(b.state, "zh-Hans-CN");
    });
    entries.push({ id, name, count: counts.get(id) ?? 0, states });
  }
  return entries.sort(compareEntries);
}

function buildSimpleEntries(
  json: Record<string, unknown> | null,
  counts: Map<string, number>,
  projectName: string,
  fallbackPrefix: string,
  primaryKey: string = "main",
  secondaryKey: string = "auxiliary",
  primaryLabel: string = "主图",
  secondaryLabel: string = "特写",
): SimpleEntry[] {
  if (!json) return [];
  const entries: SimpleEntry[] = [];
  for (const [id, raw] of Object.entries(json)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : id;
    const primaryUrl = typeof record[`${primaryKey}_url`] === "string" ? (record[`${primaryKey}_url`] as string) : undefined;
    const primaryPath = typeof record[primaryKey] === "string" ? (record[primaryKey] as string) : undefined;
    const secondaryUrl = typeof record[`${secondaryKey}_url`] === "string" ? (record[`${secondaryKey}_url`] as string) : undefined;
    const secondaryPath = typeof record[secondaryKey] === "string" ? (record[secondaryKey] as string) : undefined;
    const primarySrc = imageSrc(projectName, primaryUrl, primaryPath, fallbackPrefix);
    const secondarySrc = imageSrc(projectName, secondaryUrl, secondaryPath, fallbackPrefix);
    entries.push({
      id,
      name,
      count: counts.get(id) ?? 0,
      primary: primarySrc ? { src: primarySrc, label: primaryLabel } : undefined,
      secondary: secondarySrc ? { src: secondarySrc, label: secondaryLabel } : undefined,
    });
  }
  return entries.sort(compareEntries);
}

export function AssetGalleryView({ projectName, path }: Props) {
  const kind = detectKind(path);
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const jsonPath =
    kind === "actor"
      ? "output/actors/actors.json"
      : kind === "location"
        ? "output/locations/locations.json"
        : kind === "prop"
          ? "output/props/props.json"
          : null;

  const { data: assetJson } = useFileJson<Record<string, unknown>>(
    projectName,
    jsonPath ?? "output/__nope__.json",
  );
  const { data: scriptJson } = useFileJson<ScriptJson>(projectName, "output/script.json");

  const counts = useMemo(() => countOccurrences(scriptJson), [scriptJson]);

  const actorEntries = useMemo(
    () => (kind === "actor" ? buildActorEntries(assetJson, counts.actor, projectName) : []),
    [kind, assetJson, counts.actor, projectName],
  );
  const locationEntries = useMemo(
    () =>
      kind === "location"
        ? buildSimpleEntries(assetJson, counts.location, projectName, "output/locations/", "main", "auxiliary", "主图", "特写")
        : [],
    [kind, assetJson, counts.location, projectName],
  );
  const propEntries = useMemo(
    () =>
      kind === "prop"
        ? buildSimpleEntries(assetJson, counts.prop, projectName, "output/props/", "main", "auxiliary", "主图", "特写")
        : [],
    [kind, assetJson, counts.prop, projectName],
  );

  const fallbackGroups = useMemo(
    () => (jsonPath && assetJson ? null : buildTreeFallback(tree, path)),
    [jsonPath, assetJson, tree, path],
  );

  if (kind === "unknown") {
    return renderTreeFallback(projectName, fallbackGroups, setLightbox, lightbox);
  }

  const hasStructured =
    (kind === "actor" && actorEntries.length > 0) ||
    (kind === "location" && locationEntries.length > 0) ||
    (kind === "prop" && propEntries.length > 0);

  if (!hasStructured && fallbackGroups && fallbackGroups.length > 0) {
    return renderTreeFallback(projectName, fallbackGroups, setLightbox, lightbox);
  }

  if (!hasStructured) {
    return (
      <div className="px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">
        暂无 {KIND_TITLE[kind]}。等待 visual 阶段产出 {jsonPath}。
      </div>
    );
  }

  return (
    <div className="px-10 py-8 space-y-10">
      <header className="flex items-baseline gap-3">
        <h2 className="font-serif text-[22px] italic text-[var(--color-ink)]">{KIND_TITLE[kind]}</h2>
        <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
          按出现次数排序
        </span>
      </header>

      {kind === "actor" && (
        <div className="space-y-8">
          {actorEntries.map((entry) => (
            <ActorCard key={entry.id} entry={entry} onZoom={setLightbox} />
          ))}
        </div>
      )}

      {kind === "location" && <SimpleGrid entries={locationEntries} onZoom={setLightbox} />}
      {kind === "prop" && <SimpleGrid entries={propEntries} onZoom={setLightbox} />}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-[var(--color-ink)]/90"
        >
          <img src={lightbox} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </div>
  );
}

function ActorCard({
  entry,
  onZoom,
}: {
  entry: ActorEntry;
  onZoom: (src: string) => void;
}) {
  return (
    <article className="border border-[var(--color-rule)] bg-[var(--color-paper)] px-5 py-4">
      <header className="mb-4 flex items-baseline gap-3 border-b border-[var(--color-rule)] pb-2">
        <h3 className="font-serif text-[18px] text-[var(--color-ink)]">{entry.name}</h3>
        <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-faint)]">
          {entry.id}
        </span>
        <span className="ml-auto font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
          出现 {entry.count} 次 · {entry.states.length} 个状态
        </span>
      </header>
      {entry.states.length === 0 && (
        <div className="font-serif italic text-[13px] text-[var(--color-ink-faint)]">
          暂无视图素材
        </div>
      )}
      {entry.states.map((state) => (
        <div
          key={`${entry.id}::${state.state}`}
          className="mb-4 last:mb-0 grid gap-3"
          style={{ gridTemplateColumns: "minmax(80px, 100px) minmax(0, 1fr)" }}
        >
          <div className="self-start pt-1">
            <span className="font-serif text-[14px] text-[var(--color-ink)]">{state.state}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            <ViewCell label="正面" entry={state.face} onZoom={onZoom} />
            <ViewCell label="侧面" entry={state.side} onZoom={onZoom} />
            <ViewCell label="背面" entry={state.back} onZoom={onZoom} />
            <ViewCell label="三视图" entry={state.threeView} onZoom={onZoom} />
            {state.headCloseup && <ViewCell label="头部特写" entry={state.headCloseup} onZoom={onZoom} />}
          </div>
        </div>
      ))}
    </article>
  );
}

function ViewCell({
  label,
  entry,
  onZoom,
}: {
  label: string;
  entry: { src: string } | undefined;
  onZoom: (src: string) => void;
}) {
  return (
    <figure className="space-y-1.5">
      {entry ? (
        <button
          onClick={() => onZoom(entry.src)}
          className="block aspect-square w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)] transition-colors hover:border-[var(--color-accent)]"
        >
          <img
            src={entry.src}
            alt={label}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center border border-dashed border-[var(--color-rule)] bg-[var(--color-paper-sunk)] font-serif text-[12px] italic text-[var(--color-ink-faint)]">
          缺图
        </div>
      )}
      <figcaption className="font-mono text-[10px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
        {label}
      </figcaption>
    </figure>
  );
}

function SimpleGrid({
  entries,
  onZoom,
}: {
  entries: SimpleEntry[];
  onZoom: (src: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
      {entries.map((entry) => (
        <article
          key={entry.id}
          className="space-y-2 border border-[var(--color-rule)] bg-[var(--color-paper)] p-3"
        >
          <header className="flex items-baseline gap-2">
            <h3 className="font-serif text-[15px] text-[var(--color-ink)]">{entry.name}</h3>
            <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">{entry.id}</span>
          </header>
          <div className="grid grid-cols-2 gap-2">
            <ViewCell label={entry.primary?.label ?? "主图"} entry={entry.primary} onZoom={onZoom} />
            <ViewCell label={entry.secondary?.label ?? "特写"} entry={entry.secondary} onZoom={onZoom} />
          </div>
          <div className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
            出现 {entry.count} 次
          </div>
        </article>
      ))}
    </div>
  );
}

interface FallbackGroup {
  id: string;
  files: TreeNode[];
}

function buildTreeFallback(tree: TreeNode[], path: string): FallbackGroup[] {
  const prefix = path.endsWith("/") ? path : path + "/";
  const byGroup = new Map<string, TreeNode[]>();
  for (const node of tree) {
    if (node.type !== "file") continue;
    if (!node.path.startsWith(prefix)) continue;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(node.name)) continue;
    const rel = node.path.slice(prefix.length);
    const group = rel.split("/")[0] ?? "(root)";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(node);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, files]) => ({ id, files: files.sort((a, b) => a.name.localeCompare(b.name)) }));
}

function renderTreeFallback(
  projectName: string,
  groups: FallbackGroup[] | null,
  setLightbox: (src: string | null) => void,
  lightbox: string | null,
) {
  if (!groups || groups.length === 0) {
    return (
      <div className="px-10 py-10 font-serif italic text-[15px] text-[var(--color-ink-faint)]">
        暂无图片素材。
      </div>
    );
  }
  return (
    <div className="space-y-12 px-10 py-8">
      {groups.map((g) => (
        <section key={g.id}>
          <header className="mb-4 flex items-baseline gap-3">
            <h2 className="font-serif text-[20px] italic text-[var(--color-ink)]">{g.id}</h2>
            <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
              {g.files.length} 项
            </span>
          </header>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {g.files.map((f) => (
              <figure key={f.path} className="space-y-2">
                <button
                  onClick={() => setLightbox(fileUrl(projectName, f.path))}
                  className="block aspect-square w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)] transition-colors hover:border-[var(--color-accent)]"
                >
                  <img
                    src={fileUrl(projectName, f.path)}
                    alt={f.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
                <figcaption className="truncate font-mono text-[11px] text-[var(--color-ink-subtle)]">
                  {f.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-[var(--color-ink)]/90"
        >
          <img src={lightbox} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </div>
  );
}
