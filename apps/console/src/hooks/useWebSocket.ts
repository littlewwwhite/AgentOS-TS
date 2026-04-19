// apps/console/src/hooks/useWebSocket.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, CanvasView, WsEvent } from "../types";

function uid() {
  return Math.random().toString(36).slice(2);
}

function routeCanvas(event: Extract<WsEvent, { type: "tool_result" }>): CanvasView | null {
  const path = event.path ?? "";
  if (path.includes("pipeline-state.json")) {
    const m = path.match(/workspace\/([^/]+)\//);
    return m ? { type: "pipeline", projectName: m[1] } : null;
  }
  if (path.includes("/actors/") || path.includes("/locations/") || path.includes("/props/")) {
    return { type: "images", paths: [path] };
  }
  if (/ep\d+/.test(path) && event.output) {
    return { type: "text", content: event.output, label: path.split("/").pop() ?? path };
  }
  return null;
}

export function useWebSocket(url: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canvas, setCanvas] = useState<CanvasView>({ type: "idle" });
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (e) => {
      const event: WsEvent = JSON.parse(e.data);

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
          setMessages((prev) =>
            prev.map((m) => m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m)
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
        const view = routeCanvas(event);
        if (view) setCanvas(view);
      }

      if (event.type === "result") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        );
      }

      if (event.type === "error") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: `错误：${event.message}`, timestamp: Date.now() },
        ]);
      }
    };

    return () => ws.close();
  }, [url]);

  const send = useCallback(
    (message: string, project?: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      wsRef.current.send(JSON.stringify({ message, project }));
    },
    []
  );

  return { messages, canvas, isConnected, isStreaming, send };
}
