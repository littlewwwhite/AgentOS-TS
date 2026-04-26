// input: active production object and resolved view kind
// output: object-first header for the central production workbench
// pos: shared identity and decision scope chrome above Viewer content

import type { ViewKind } from "../../types";
import type { ProductionObject } from "../../lib/productionObject";
import { getProductionObjectUiTitle } from "../../lib/productionObjectUi";

interface Props {
  object: ProductionObject;
  viewKind: ViewKind;
}

export function ObjectHeader({ object }: Props) {
  const title = getProductionObjectUiTitle(object);

  return (
    <div className="shrink-0 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-3">
      <div className="min-w-0 font-serif text-[24px] leading-tight text-[var(--color-ink)] truncate">
        {title}
      </div>
    </div>
  );
}
