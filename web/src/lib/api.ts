// input: Browser fetch API, EventSource API
// output: Typed API client for all sandbox + workspace endpoints
// pos: API layer — thin wrapper over HTTP, no business logic

import type { FileNode, SandboxEvent } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- Sandbox lifecycle ----------

export async function startSandbox(
  templateId?: string,
): Promise<{ sandboxId: string }> {
  return post("/api/sandbox/start", { templateId });
}

export async function sendChat(message: string): Promise<void> {
  await post("/api/sandbox/chat", { message });
}

export async function interruptChat(): Promise<void> {
  await post("/api/sandbox/interrupt");
}

export async function destroySandbox(): Promise<void> {
  await fetch("/api/sandbox", { method: "DELETE" });
}

// ---------- Workspace ----------

export async function fetchFileTree(path?: string): Promise<FileNode[]> {
  const params = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/workspace/files${params}`);
  return res.json();
}

export async function fetchFileContent(
  path: string,
): Promise<{ content: string; type: string }> {
  const res = await fetch(
    `/api/workspace/file?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- SSE ----------

export function subscribeToEvents(
  onEvent: (event: SandboxEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const es = new EventSource("/api/sandbox/events");
  const types = ["ready", "text", "tool_use", "result", "error", "status", "skills"];

  for (const type of types) {
    es.addEventListener(type, (e) => {
      onEvent(JSON.parse((e as MessageEvent).data));
    });
  }

  es.onerror = (e) => onError?.(e);
  return () => es.close();
}
