import { useEffect, useState } from "react";
import { fileUrl } from "../lib/fileUrl";

export function useFileText(projectName: string, relPath: string) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(fileUrl(projectName, relPath))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [projectName, relPath]);
  return { text, error };
}

export function useFileJson<T = unknown>(projectName: string, relPath: string) {
  const { text, error } = useFileText(projectName, relPath);
  const data = text != null ? safeParse<T>(text) : null;
  return { data, error: error ?? (text != null && data === null ? "invalid JSON" : null) };
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
