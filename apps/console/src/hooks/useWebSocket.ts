// apps/console/src/hooks/useWebSocket.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, WsEvent } from "../types";

function uid() {
  return Math.random().toString(36).slice(2);
}

function extractPath(content: unknown): string | undefined {
  if (typeof content !== "string" || !content) return undefined;
  const m = content.match(/(?:workspace\/[^/\s"]+\/)?((?:output|draft)\/[^\s")]+)/);
  return m?.[1];
}

export function useWebSocket(
  url: string,
  onToolResult?: (path: string) => void,
  onResult?: () => void,
  onSession?: (sessionId: string | null) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);

  const onToolResultRef = useRef(onToolResult);
  const onResultRef = useRef(onResult);
  const onSessionRef = useRef(onSession);
  useEffect(() => { onToolResultRef.current = onToolResult; }, [onToolResult]);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onSessionRef.current = onSession; }, [onSession]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (e) => {
      const event: WsEvent = JSON.parse(e.data);

      if (import.meta.env.DEV) {
        console.debug("[ws]", event.type, event);
      }

      if (event.type === "session") {
        onSessionRef.current?.(event.sessionId);
        return;
      }

      if (event.type === "system") {
        // Lossless passthrough; no UI surface yet. Keep for debugging.
        if (import.meta.env.DEV) console.debug("[ws] system", event.subtype, event.data);
        return;
      }

      if (event.type === "text") {
        setIsStreaming(true);
        setMessages((prev) => {
          const existingId = streamingIdRef.current;
          if (existingId) {
            return prev.map((m) =>
              m.id === existingId ? { ...m, content: m.content + event.text } : m
            );
          }
          const newId = uid();
          streamingIdRef.current = newId;
          return [
            ...prev,
            { id: newId, role: "assistant", content: event.text, isStreaming: true, timestamp: Date.now() },
          ];
        });
      }

      if (event.type === "tool_use") {
        if (streamingIdRef.current) {
          const closingId = streamingIdRef.current;
          setMessages((prev) =>
            prev
              .map((m) => (m.id === closingId ? { ...m, isStreaming: false } : m))
              .filter((m) => !(m.id === closingId && !m.toolName && m.content.trim() === ""))
          );
          streamingIdRef.current = null;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `tool_${event.id}`,
            role: "assistant",
            content: "",
            toolName: event.tool,
            toolInput: event.input,
            isStreaming: true,
            timestamp: Date.now(),
          },
        ]);
      }

      if (event.type === "tool_result") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `tool_${event.id}` ? { ...m, toolOutput: event.output, isStreaming: false } : m
          )
        );
        const p = extractPath(event.output);
        if (p) onToolResultRef.current?.(p);
        onResultRef.current?.();
      }

      if (event.type === "result") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) =>
          prev
            .filter((m) => !(m.role === "assistant" && !m.toolName && m.content.trim() === ""))
            .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        );
        onResultRef.current?.();
      }

      if (event.type === "error") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        onSessionRef.current?.(null);
        setMessages((prev) => [
          ...prev.filter((m) => !(m.role === "assistant" && !m.toolName && m.content.trim() === "")),
          { id: uid(), role: "assistant", content: `错误：${event.message}`, timestamp: Date.now() },
        ]);
      }
    };

    return () => ws.close();
  }, [url]);

  const send = useCallback(
    (message: string, project?: string, sessionId?: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      wsRef.current.send(JSON.stringify({ message, project, sessionId }));
    },
    []
  );

  return { messages, isConnected, isStreaming, send };
}
