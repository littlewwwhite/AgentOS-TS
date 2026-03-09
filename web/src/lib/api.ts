// input: Browser WebSocket API, fetch API
// output: Typed API client for all sandbox + workspace endpoints
// pos: API layer — thin wrapper over WebSocket + HTTP, no business logic

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

export async function destroySandbox(): Promise<void> {
  closeWebSocket();
  await fetch("/api/sandbox", { method: "DELETE" });
}

// ---------- WebSocket ----------

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentOnEvent: ((event: SandboxEvent) => void) | null = null;
let currentOnError: ((error: Event) => void) | null = null;

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= 5) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 8000);
  reconnectTimer = setTimeout(() => {
    reconnectAttempts++;
    doConnect();
  }, delay);
}

function doConnect(): void {
  if (!currentOnEvent) return;

  const socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    reconnectAttempts = 0;
  };

  socket.onmessage = (e) => {
    try {
      currentOnEvent?.(JSON.parse(e.data));
    } catch {
      /* ignore malformed messages */
    }
  };

  socket.onclose = () => {
    if (ws === socket) scheduleReconnect();
  };

  socket.onerror = (e) => currentOnError?.(e);

  ws = socket;
}

export function connectWebSocket(
  onEvent: (event: SandboxEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  currentOnEvent = onEvent;
  currentOnError = onError ?? null;
  reconnectAttempts = 0;
  doConnect();
  return closeWebSocket;
}

function closeWebSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  currentOnEvent = null;
  currentOnError = null;
  if (ws) {
    ws.close();
    ws = null;
  }
}

function sendCommand(cmd: Record<string, unknown>): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("WebSocket not connected"));
  }
  ws.send(JSON.stringify(cmd));
  return Promise.resolve();
}

export function sendChat(message: string): Promise<void> {
  return sendCommand({ cmd: "chat", message });
}

export function interruptChat(): Promise<void> {
  return sendCommand({ cmd: "interrupt" });
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
