// input: projectName + relPath → GET /files/<project>/<path>
// output: parsed JSON data + patch(dotPath, value) with 600ms debounce PUT /api/file
// pos: wraps useFileJson (read-only) pattern with editable + auto-save semantics

import { useCallback, useEffect, useRef, useState } from "react";
import { fileUrl } from "../lib/fileUrl";

// ---------------------------------------------------------------------------
// setAtPath — immutable dot-path setter
// Exported for unit-testing; not part of the public hook surface.
// ---------------------------------------------------------------------------

export function getAtPath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let node: unknown = obj;
  for (const seg of segments) {
    if (node === null || node === undefined) return undefined;
    const idx = Number(seg);
    const isArrayIndex = !Number.isNaN(idx) && String(idx) === seg;
    if (isArrayIndex) {
      if (!Array.isArray(node)) return undefined;
      node = node[idx];
    } else {
      if (typeof node !== "object" || Array.isArray(node)) return undefined;
      node = (node as Record<string, unknown>)[seg];
    }
  }
  return node;
}

export function setAtPath<T>(obj: T, path: string, value: unknown): T {
  const segments = path.split(".");
  if (segments.length === 0) return obj;

  function recurse(node: unknown, segs: string[]): unknown {
    const [head, ...rest] = segs;
    if (head === undefined) return value;

    if (node === null || node === undefined) {
      console.warn("[useEditableJson] path not found:", path);
      throw new Error("PATH_NOT_FOUND");
    }

    const idx = Number(head);
    const isArrayIndex = !Number.isNaN(idx) && String(idx) === head;

    if (isArrayIndex) {
      if (!Array.isArray(node)) {
        console.warn("[useEditableJson] path not found:", path);
        throw new Error("PATH_NOT_FOUND");
      }
      const copy = [...node];
      copy[idx] = rest.length === 0 ? value : recurse(copy[idx], rest);
      return copy;
    } else {
      if (typeof node !== "object" || Array.isArray(node)) {
        console.warn("[useEditableJson] path not found:", path);
        throw new Error("PATH_NOT_FOUND");
      }
      const copy = { ...(node as Record<string, unknown>) };
      copy[head] = rest.length === 0 ? value : recurse(copy[head], rest);
      return copy;
    }
  }

  try {
    return recurse(obj, segments) as T;
  } catch {
    // PATH_NOT_FOUND — return original unchanged (already logged)
    return obj;
  }
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface UseEditableJsonResult<T> {
  data: T | null;
  error: string | null;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  patch: (path: string, value: unknown) => void;
  savedAt: number | null;
  reload: () => void;
}

// ---------------------------------------------------------------------------
// useEditableJson
// ---------------------------------------------------------------------------

export function useEditableJson<T = unknown>(
  projectName: string,
  relPath: string,
): UseEditableJsonResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UseEditableJsonResult<T>["status"]>("loading");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Bump this to trigger a reload
  const [reloadTick, setReloadTick] = useState(0);

  // Mutable refs — do not cause re-renders
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const pendingSnapshot = useRef<T | null>(null); // queued data while save is in flight
  const savingRef = useRef(false); // true while PUT is in flight
  const latestDataRef = useRef<T | null>(null); // always mirrors data state

  // Keep latestDataRef in sync with data
  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  // ---- fetch on mount / projectName / relPath / reload ----
  useEffect(() => {
    let cancelled = false;

    // Discard any pending debounce and in-flight save when switching files
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (saveAbort.current) {
      saveAbort.current.abort();
      saveAbort.current = null;
    }
    savingRef.current = false;
    pendingSnapshot.current = null;

    setData(null);
    setError(null);
    setStatus("loading");

    fetch(fileUrl(projectName, relPath))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then((parsed) => {
        if (cancelled) return;
        setData(parsed);
        setStatus("idle");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(String(e instanceof Error ? e.message : e));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [projectName, relPath, reloadTick]);

  // ---- save helper ----
  const doSave = useCallback(
    async (snapshot: T) => {
      // Cancel any previous in-flight save
      if (saveAbort.current) saveAbort.current.abort();
      const abort = new AbortController();
      saveAbort.current = abort;
      savingRef.current = true;
      setStatus("saving");

      const body = JSON.stringify(snapshot, null, 2);
      try {
        const res = await fetch(
          `/api/file?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(relPath)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
            signal: abort.signal,
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }

        savingRef.current = false;
        setSavedAt(Date.now());
        setStatus("saved");

        // If another patch arrived while we were saving, flush it now
        if (pendingSnapshot.current !== null) {
          const next = pendingSnapshot.current;
          pendingSnapshot.current = null;
          void doSave(next);
        }
      } catch (e: unknown) {
        if ((e as { name?: string }).name === "AbortError") {
          // Aborted — a new save will take over. Reset status so UI doesn't
          // remain stuck on "saving" if no successor fires.
          savingRef.current = false;
          setStatus("idle");
          return;
        }
        savingRef.current = false;
        setError(String(e instanceof Error ? e.message : e));
        setStatus("error");
      }
    },
    [projectName, relPath],
  );

  // ---- patch ----
  const patch = useCallback(
    (path: string, value: unknown) => {
      setData((prev) => {
        if (prev === null) return prev;
        const next = setAtPath(prev, path, value);
        latestDataRef.current = next;

        // Debounce: clear existing timer, start fresh 600 ms window
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          debounceTimer.current = null;
          const snapshot = latestDataRef.current;
          if (snapshot === null) return;
          if (savingRef.current) {
            // Save in flight — queue latest snapshot; doSave will pick it up
            pendingSnapshot.current = snapshot;
          } else {
            void doSave(snapshot);
          }
        }, 600);

        return next;
      });
    },
    [doSave],
  );

  // ---- reload ----
  const reload = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setReloadTick((t) => t + 1);
  }, []);

  // ---- cleanup on unmount (no save) ----
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      // Abort any in-flight save so we don't overwrite after unmount
      if (saveAbort.current) {
        saveAbort.current.abort();
        saveAbort.current = null;
      }
    };
  }, []);

  return { data, error, status, patch, savedAt, reload };
}
