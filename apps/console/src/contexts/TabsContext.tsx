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

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const openPath = useCallback((path: string, view: ViewKind, title: string, opts: OpenOpts = {}) => {
    const pinned = opts.pinned ?? false;
    setTabs((prev) => {
      const existing = prev.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        if (pinned && !existing.pinned) {
          return prev.map((t) => (t.id === existing.id ? { ...t, pinned: true } : t));
        }
        return prev;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: Tab = { id, path, title, view, pinned };
      // Replace existing unpinned preview tab when new tab is also unpinned
      if (!pinned) {
        const previewIdx = prev.findIndex((t) => !t.pinned);
        if (previewIdx >= 0) {
          const copy = [...prev];
          copy[previewIdx] = next;
          setActiveId(id);
          return copy;
        }
      }
      setActiveId(id);
      return [...prev, next];
    });
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
        const fallback = next[idx] ?? next[idx - 1] ?? null;
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
