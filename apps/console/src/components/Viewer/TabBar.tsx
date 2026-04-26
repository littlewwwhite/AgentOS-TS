// input: open workbench tabs and tab actions
// output: optional reference-object switcher for multi-object work
// pos: secondary chrome that stays hidden for the default single-object workbench

import { useTabs } from "../../contexts/TabsContext";
import type { Tab } from "../../types";

interface Props {
  tabs: Tab[];
  activeId: string | null;
  activate: (id: string) => void;
  closeTab: (id: string) => void;
}

export function TabBar() {
  const { tabs, activeId, activate, closeTab } = useTabs();
  return <TabBarView tabs={tabs} activeId={activeId} activate={activate} closeTab={closeTab} />;
}

export function TabBarView({ tabs, activeId, activate, closeTab }: Props) {
  if (tabs.length <= 1) return null;
  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-rule)] overflow-x-auto shrink-0 bg-[var(--color-paper)] px-4 py-2">
      <div className="shrink-0 font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
        参考对象
      </div>
      <div className="flex items-stretch gap-2">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => activate(t.id)}
              className={
                "group flex h-7 cursor-pointer items-center gap-2 whitespace-nowrap border px-3 " +
                (active
                  ? "border-[var(--color-ink)] bg-[var(--color-paper-soft)]"
                  : "border-[var(--color-rule)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
              }
            >
              <span className="font-[Geist,sans-serif] text-[11px]">
                {t.title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                className="font-mono text-[10px] text-[var(--color-ink-faint)] opacity-0 transition-opacity hover:text-[var(--color-ink)] group-hover:opacity-100"
                aria-label="关闭参考对象"
              >×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
