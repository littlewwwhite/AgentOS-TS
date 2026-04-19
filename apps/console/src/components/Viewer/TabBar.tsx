import { useTabs } from "../../contexts/TabsContext";

export function TabBar() {
  const { tabs, activeId, activate, closeTab } = useTabs();
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-0 border-b border-[oklch(20%_0_0)] overflow-x-auto shrink-0">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => activate(t.id)}
            className={
              "flex items-center gap-2 px-3 py-2 text-[12px] border-r border-[oklch(20%_0_0)] cursor-pointer whitespace-nowrap " +
              (active ? "bg-[oklch(18%_0_0)] text-[oklch(85%_0_0)]" : "text-[oklch(55%_0_0)] hover:text-[oklch(75%_0_0)]")
            }
          >
            <span className={t.pinned ? "" : "italic"}>{t.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              className="text-[oklch(42%_0_0)] hover:text-[oklch(75%_0_0)]"
              aria-label="关闭"
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
