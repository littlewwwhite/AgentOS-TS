// input: production asset rail model and project name
// output: read-only grouped asset rail for episode review workbenches
// pos: local context panel inside storyboard/video review surfaces

import { fileUrl } from "../../../lib/fileUrl";
import type {
  ProductionAssetKind,
  ProductionAssetRailItem,
  ProductionAssetRailModel,
  ProductionAssetScope,
} from "../../../lib/storyboard";

interface Props {
  projectName: string;
  model: ProductionAssetRailModel;
  selectedAssetId?: string | null;
  replacementKind?: ProductionAssetKind | null;
  replacementLabel?: string | null;
  onSelectAsset?: (item: ProductionAssetRailItem) => void;
}

function scopeLabel(scope: ProductionAssetScope): string {
  if (scope === "current") return "当前片段";
  if (scope === "episode") return "本集";
  return "项目";
}

function AssetThumb({
  projectName,
  item,
}: {
  projectName: string;
  item: ProductionAssetRailItem;
}) {
  if (item.thumbnailPath) {
    return (
      <img
        src={fileUrl(projectName, item.thumbnailPath)}
        alt={item.label}
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[var(--color-paper-sunk)] px-2 text-center font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
      {item.id}
    </div>
  );
}

function AssetCard({
  projectName,
  item,
  selected,
  replacementKind,
  replacementLabel,
  onSelect,
}: {
  projectName: string;
  item: ProductionAssetRailItem;
  selected: boolean;
  replacementKind?: ProductionAssetKind | null;
  replacementLabel?: string | null;
  onSelect?: (item: ProductionAssetRailItem) => void;
}) {
  const active = item.scope === "current";
  const inReplacementMode = Boolean(replacementKind);
  const compatibleReplacement = !replacementKind || item.kind === replacementKind;
  const selectable = typeof onSelect === "function" && compatibleReplacement;
  const replacementTarget = replacementLabel ?? "当前引用";
  const shellClass =
    "grid w-full grid-cols-[52px_minmax(0,1fr)] gap-2.5 border bg-[var(--color-paper-soft)] p-2 text-left transition-colors " +
    (selected
      ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]"
      : active
        ? "border-[var(--color-ink)]"
        : "border-[var(--color-rule)]") +
    (selectable ? " hover:border-[var(--color-accent)]" : "") +
    (!compatibleReplacement ? " opacity-45" : "");
  const content = (
    <>
      <div className="h-[52px] overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)]">
        <AssetThumb projectName={projectName} item={item} />
      </div>
      <div className="min-w-0 self-center">
        <div className="truncate font-[Geist,sans-serif] text-[12px] font-semibold text-[var(--color-ink)]">
          {item.label}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="inline-flex border border-[var(--color-rule)] bg-[var(--color-paper)] px-1.5 py-0.5 font-[Geist,sans-serif] text-[10px] text-[var(--color-ink-subtle)]">
            {scopeLabel(item.scope)}
          </span>
          {inReplacementMode && compatibleReplacement && (
            <span className="inline-flex border border-[var(--color-accent)] bg-[var(--color-paper)] px-1.5 py-0.5 font-[Geist,sans-serif] text-[10px] font-semibold text-[var(--color-accent)]">
              选择替换
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <li>
      {typeof onSelect === "function" ? (
        <button
          type="button"
          aria-label={compatibleReplacement
            ? inReplacementMode
              ? `用 ${item.label} 替换 ${replacementTarget}`
              : `选择 ${item.label}`
            : `${item.label} 不是同类型资产`}
          aria-pressed={selected}
          aria-disabled={!compatibleReplacement}
          disabled={!compatibleReplacement}
          className={shellClass}
          onClick={() => onSelect?.(item)}
        >
          {content}
        </button>
      ) : (
        <div className={shellClass}>{content}</div>
      )}
    </li>
  );
}

export function ProductionAssetRail({
  projectName,
  model,
  selectedAssetId,
  replacementKind,
  replacementLabel,
  onSelectAsset,
}: Props) {
  const groups = [model.groups.actor, model.groups.location, model.groups.prop];
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  const canSelectAssets = totalItems > 0 && typeof onSelectAsset === "function";

  return (
    <aside className="min-h-0 w-[220px] shrink-0 overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-3">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-[Geist,sans-serif] text-[14px] font-semibold text-[var(--color-ink)]">
            资产库
          </h2>
          {replacementKind && replacementLabel && (
            <div className="mt-1 truncate font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-muted)]">
              替换 {replacementLabel}
            </div>
          )}
        </div>
        <div className="group relative">
          <button
            type="button"
            aria-label="选择已有资产"
            title="选择已有资产"
            disabled={!canSelectAssets}
            className="flex h-7 w-7 cursor-pointer list-none items-center justify-center border border-transparent font-mono text-[22px] leading-none text-[var(--color-ink)] transition-colors hover:border-[var(--color-rule)] hover:bg-[var(--color-paper-soft)] focus:outline-none focus-visible:border-[var(--color-accent)]"
          >
            +
          </button>
          {canSelectAssets && (
            <div className="absolute right-0 top-8 z-20 hidden max-h-[360px] w-52 overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper)] py-2 shadow-[0_14px_34px_rgba(0,0,0,0.10)] group-hover:block group-focus-within:block">
              {groups.map((group) => (
                group.items.length > 0 && (
                  <section key={group.label} className="px-2 py-1">
                    <div className="mb-1 px-1 font-[Geist,sans-serif] text-[10px] font-semibold text-[var(--color-ink-faint)]">
                      {group.label}
                    </div>
                    <div className="grid gap-1">
                      {group.items.map((item) => (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onClick={() => onSelectAsset?.(item)}
                          className="grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 px-1 py-1.5 text-left transition-colors hover:bg-[var(--color-paper-soft)] focus:outline-none focus-visible:bg-[var(--color-paper-soft)]"
                        >
                          <span className="h-7 overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunk)]">
                            <AssetThumb projectName={projectName} item={item} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-[Geist,sans-serif] text-[12px] font-semibold text-[var(--color-ink)]">
                              {item.label}
                            </span>
                            <span className="block truncate font-[Geist,sans-serif] text-[10px] text-[var(--color-ink-faint)]">
                              {scopeLabel(item.scope)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )
              ))}
            </div>
          )}
        </div>
      </div>

      {totalItems === 0 ? (
        <div className="border border-dashed border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-8 text-center font-[Geist,sans-serif] text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
          暂无可用资产
        </div>
      ) : (
      <div className="grid gap-5">
        {groups.map((group) => (
          <section key={group.label} className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-[Geist,sans-serif] text-[12px] font-semibold text-[var(--color-ink-muted)]">
                {group.label}
              </h3>
              <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                {group.items.length}
              </span>
            </div>
            {group.items.length > 0 ? (
              <ul className="grid gap-2">
                {group.items.map((item) => (
                  <AssetCard
                    key={`${item.kind}-${item.id}`}
                    projectName={projectName}
                    item={item}
                    selected={selectedAssetId === item.id}
                    replacementKind={replacementKind}
                    replacementLabel={replacementLabel}
                    onSelect={onSelectAsset}
                  />
                ))}
              </ul>
            ) : (
              <div className="border border-dashed border-[var(--color-rule)] px-3 py-5 text-center font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-faint)]">
                暂无资产
              </div>
            )}
          </section>
        ))}
      </div>
      )}
    </aside>
  );
}
