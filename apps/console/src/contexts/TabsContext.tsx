import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";
import type { Tab, ViewKind } from "../types";

interface OpenOpts {
  pinned?: boolean;
}

interface TabsContextValue {
  tabs: Tab[];
  activeId: string | null;
  openPath: (path: string, view: ViewKind, title: string, opts?: OpenOpts) => void;
  pinActive: () => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
}

const Ctx = createContext<TabsContextValue | null>(null);

export function reduceSingleWorkbenchTabs(_prev: Tab[], next: Tab): Tab[] {
  return [next];
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const openPath = useCallback((path: string, view: ViewKind, title: string, opts: OpenOpts = {}) => {
    const next: Tab = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path,
      title,
      view,
      pinned: opts.pinned ?? false,
    };
    setTabs((prev) => reduceSingleWorkbenchTabs(prev, next));
    setActiveId(next.id);
  }, []);

  const pinActive = useCallback(() => {
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, pinned: true } : t)));
  }, [activeId]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        const fallback = next[Math.min(idx, next.length - 1)] ?? null;
        setActiveId(fallback?.id ?? null);
      }
      return next;
    });
  }, [activeId]);

  const activate = useCallback((id: string) => setActiveId(id), []);

  const value = useMemo(() => ({ tabs, activeId, openPath, pinActive, closeTab, activate }),
    [tabs, activeId, openPath, pinActive, closeTab, activate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): TabsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTabs must be inside TabsProvider");
  return v;
}
