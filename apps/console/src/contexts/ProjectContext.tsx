import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { PipelineState, TreeNode } from "../types";

interface ProjectContextValue {
  name: string | null;
  state: PipelineState | null;
  tree: TreeNode[];
  isLoading: boolean;
  unread: Map<string, number>;
  setName: (name: string | null) => void;
  refresh: () => void;
  noteToolPath: (path: string) => void;
  markSeen: (path: string) => void;
}

const Ctx = createContext<ProjectContextValue | null>(null);

async function loadFor(name: string, signal: AbortSignal): Promise<{ state: PipelineState; tree: TreeNode[] }> {
  const [sRes, tRes] = await Promise.all([
    fetch(`/api/projects/${encodeURIComponent(name)}`, { signal }),
    fetch(`/api/projects/${encodeURIComponent(name)}/tree`, { signal }),
  ]);
  if (!sRes.ok) throw new Error(`state ${sRes.status}`);
  if (!tRes.ok) throw new Error(`tree ${tRes.status}`);
  const [state, tree] = await Promise.all([sRes.json(), tRes.json()]);
  return { state, tree: Array.isArray(tree) ? tree : [] };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<PipelineState | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!name) {
      setState(null);
      setTree([]);
      unreadRef.current.clear();
      setUnreadTick((t) => t + 1);
      return;
    }
    abortRef.current?.abort();
    unreadRef.current.clear();
    setUnreadTick((t) => t + 1);
    const ac = new AbortController();
    abortRef.current = ac;
    setIsLoading(true);
    loadFor(name, ac.signal)
      .then(({ state: s, tree: t }) => {
        if (ac.signal.aborted) return;
        setState(s);
        setTree(t);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        console.error("[ProjectContext] load failed", err);
      })
      .finally(() => {
        if (!ac.signal.aborted) setIsLoading(false);
      });
    return () => ac.abort();
  }, [name]);

  useEffect(() => () => {
    if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  const refresh = useCallback(() => {
    if (!name) return;
    if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setIsLoading(true);
      loadFor(name, ac.signal)
        .then(({ state: s, tree: t }) => {
          if (ac.signal.aborted) return;
          setState(s);
          setTree(t);
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          console.error("[ProjectContext] refresh failed", err);
        })
        .finally(() => {
          if (!ac.signal.aborted) setIsLoading(false);
        });
    }, 500);
  }, [name]);

  const [unreadTick, setUnreadTick] = useState(0);
  const unreadRef = useRef<Map<string, number>>(new Map());

  const noteToolPath = useCallback((path: string) => {
    const m = unreadRef.current;
    m.set(path, (m.get(path) ?? 0) + 1);
    const parts = path.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const pre = parts.slice(0, i).join("/");
      m.set(pre, (m.get(pre) ?? 0) + 1);
    }
    setUnreadTick((t) => t + 1);
  }, []);

  const markSeen = useCallback((path: string) => {
    const m = unreadRef.current;
    const count = m.get(path) ?? 0;
    if (count === 0) return;
    m.delete(path);
    const parts = path.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const pre = parts.slice(0, i).join("/");
      const c = m.get(pre) ?? 0;
      if (c <= count) m.delete(pre);
      else m.set(pre, c - count);
    }
    setUnreadTick((t) => t + 1);
  }, []);

  const value = useMemo(
    () => ({ name, state, tree, isLoading, unread: unreadRef.current, setName, refresh, noteToolPath, markSeen }),
    [name, state, tree, isLoading, refresh, noteToolPath, markSeen, unreadTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be inside ProjectProvider");
  return v;
}
