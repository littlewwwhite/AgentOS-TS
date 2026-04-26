// input: active production object and resolved view kind
// output: object-first header for the central production workbench
// pos: shared identity and decision scope chrome above Viewer content

import type { ViewKind } from "../../types";
import {
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  type ProductionObject,
} from "../../lib/productionObject";

interface Props {
  object: ProductionObject;
  viewKind: ViewKind;
}

function viewKindLabel(kind: ViewKind): string {
  switch (kind) {
    case "overview": return "OVERVIEW";
    case "script": return "SCRIPT";
    case "storyboard": return "STORYBOARD";
    case "asset-gallery": return "GALLERY";
    case "video-grid": return "VIDEO GRID";
    case "image": return "IMAGE";
    case "video": return "VIDEO";
    case "text": return "TEXT";
    case "json": return "JSON";
    default: return "FILE";
  }
}

function objectPath(object: ProductionObject): string | null {
  if ("path" in object && object.path) return object.path;
  return null;
}

export function ObjectHeader({ object, viewKind }: Props) {
  const label = getProductionObjectLabel(object);
  const lineage = getProductionObjectLineage(object);
  const scope = getProductionObjectScope(object);
  const viewLabel = viewKindLabel(viewKind);
  const path = objectPath(object);

  return (
    <div className="shrink-0 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-3">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="font-serif text-[24px] leading-tight text-[var(--color-ink)] truncate">
            {label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
            <span>{viewLabel}</span>
            <span aria-hidden>·</span>
            <span>{lineage.join(" → ")}</span>
          </div>
        </div>
        <div className="shrink-0 text-right font-sans text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
          <div><span className="text-[var(--color-ink-subtle)]">默认作用域</span> {scope.defaultScope}</div>
          {scope.preserves.length > 0 && (
            <div><span className="text-[var(--color-ink-subtle)]">不会影响</span> {scope.preserves.join(" / ")}</div>
          )}
        </div>
      </div>
      {path && (
        <div className="mt-2 truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
          {path}
        </div>
      )}
    </div>
  );
}
