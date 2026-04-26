// input: active production object
// output: compact scope summary for scoped agent commands
// pos: visible contract between selected workbench object and ChatPane instructions

import type { ProductionObject } from "../../lib/productionObject";
import { getProductionObjectUiTitle } from "../../lib/productionObjectUi";

interface Props {
  object: ProductionObject;
}

export function ScopeSummary({ object }: Props) {
  return (
    <section className="border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-2 font-sans text-[11px] text-[var(--color-ink-muted)]">
      <span className="font-semibold text-[var(--color-ink-subtle)]">指令对象</span>
      <span className="mx-2 text-[var(--color-ink-faint)]" aria-hidden>·</span>
      <span className="text-[var(--color-ink)]">{getProductionObjectUiTitle(object)}</span>
    </section>
  );
}
