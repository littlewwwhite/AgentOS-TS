import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { PipelineState, TreeNode } from "../types";

interface ProjectContextValue {
  name: string | null;
  state: PipelineState | null;
  tree: TreeNode[];
  isLoading: boolean;
  setName: (name: string | null) => void;
  refresh: () => void;
}

const Ctx = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<PipelineState | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const load = useCallback(async (n: string) => {
    setIsLoading(true);
    try {
      const [s, t] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(n)}`).then((r) => r.json()),
        fetch(`/api/projects/${encodeURIComponent(n)}/tree`).then((r) => r.json()),
      ]);
      setState(s);
      setTree(Array.isArray(t) ? t : []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!name) {
      setState(null);
      setTree([]);
      return;
    }
    load(name);
  }, [name, load]);

  const refresh = useCallback(() => {
    if (!name) return;
    if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => load(name), 500);
  }, [name, load]);

  const value = useMemo(() => ({ name, state, tree, isLoading, setName, refresh }), [name, state, tree, isLoading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be inside ProjectProvider");
  return v;
}
