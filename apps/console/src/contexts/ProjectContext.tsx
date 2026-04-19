import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { PipelineState, TreeNode } from "../types";
import { buildProjectRouteSearch, readProjectRoute } from "../lib/sessionRoute";

interface ProjectContextValue {
  name: string | null;
  state: PipelineState | null;
  tree: TreeNode[];
  isLoading: boolean;
  unread: Map<string, number>;
  sessionId: string | null;
  setName: (name: string | null) => void;
  refresh: () => void;
  noteToolPath: (path: string) => void;
  markSeen: (path: string) => void;
  setSessionId: (id: string | null) => void;
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

const SESSION_KEY_PREFIX = "agentos:session:";

function readStoredSession(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY_PREFIX + name);
  } catch {
    return null;
  }
}

function writeStoredSession(name: string, id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY_PREFIX + name, id);
    else window.localStorage.removeItem(SESSION_KEY_PREFIX + name);
  } catch {
    // private mode or quota — fall through; in-memory state still works
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const routeRef = useRef(readProjectRoute(typeof window === "undefined" ? "" : window.location.search));
  const [name, setNameState] = useState<string | null>(routeRef.current.project);
  const [sessionId, setSessionIdState] = useState<string | null>(routeRef.current.sessionId);
  const [state, setState] = useState<PipelineState | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!name) {
      setState(null);
      setTree([]);
      setSessionIdState(null);
      unreadRef.current.clear();
      setUnreadTick((t) => t + 1);
      return;
    }
    abortRef.current?.abort();
    unreadRef.current.clear();
    setUnreadTick((t) => t + 1);
    const route = readProjectRoute(typeof window === "undefined" ? "" : window.location.search);
    const nextSessionId = route.project === name && route.sessionId
      ? route.sessionId
      : readStoredSession(name);
    setSessionIdState(nextSessionId);
    writeStoredSession(name, nextSessionId);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const route = readProjectRoute(window.location.search);
      setNameState(route.project);
      setSessionIdState(route.sessionId);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextSearch = buildProjectRouteSearch(window.location.search, {
      project: name,
      sessionId,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [name, sessionId]);

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

  const setName = useCallback((nextName: string | null) => {
    setNameState(nextName);
    setSessionIdState((current) => (nextName === name ? current : null));
  }, [name]);

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

  const setSessionId = useCallback(
    (id: string | null) => {
      setSessionIdState(id);
      if (name) writeStoredSession(name, id);
    },
    [name],
  );

  const value = useMemo(
    () => ({
      name,
      state,
      tree,
      isLoading,
      unread: unreadRef.current,
      sessionId,
      setName,
      refresh,
      noteToolPath,
      markSeen,
      setSessionId,
    }),
    [name, state, tree, isLoading, sessionId, refresh, noteToolPath, markSeen, setSessionId, unreadTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be inside ProjectProvider");
  return v;
}
