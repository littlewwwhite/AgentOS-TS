// input: active production object
// output: compact scope summary for scoped agent commands
// pos: visible contract between selected workbench object and ChatPane instructions

import {
  getProductionObjectLabel,
  getProductionObjectScope,
  type ProductionObject,
} from "../../lib/productionObject";

interface Props {
  object: ProductionObject;
}

export function ScopeSummary({ object }: Props) {
  const scope = getProductionObjectScope(object);
  return (
    <section className="border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-3">
      <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
        Current scope
      </div>
      <div className="mt-1 font-serif text-[20px] leading-tight text-[var(--color-ink)]">
        {getProductionObjectLabel(object)}
      </div>
      <div className="mt-2 space-y-1 font-sans text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        <div><span className="text-[var(--color-ink-subtle)]">默认作用域</span> {scope.defaultScope}</div>
        <div><span className="text-[var(--color-ink-subtle)]">会影响</span> {scope.affects.join(" / ") || "—"}</div>
        <div><span className="text-[var(--color-ink-subtle)]">不会影响</span> {scope.preserves.join(" / ") || "—"}</div>
      </div>
    </section>
  );
}
