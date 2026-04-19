import { useTabs } from "../../contexts/TabsContext";

export function TabBar() {
  const { tabs, activeId, activate, closeTab } = useTabs();
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-stretch border-b border-[var(--color-rule)] overflow-x-auto shrink-0 bg-[var(--color-paper)]">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => activate(t.id)}
            className="group flex items-center gap-2 px-4 h-9 cursor-pointer whitespace-nowrap relative"
          >
            <span
              className={
                "text-[12px] " +
                (active
                  ? "font-serif italic text-[13px] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-muted)] group-hover:text-[var(--color-ink)] " +
                    (t.pinned ? "" : "italic"))
              }
            >
              {t.title}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              className="font-mono text-[10px] text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-ink)] transition-opacity"
              aria-label="关闭"
            >×</button>
            {active && (
              <span
                className="absolute left-4 right-4 bottom-0 h-[2px]"
                style={{ backgroundColor: "var(--color-accent)" }}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
