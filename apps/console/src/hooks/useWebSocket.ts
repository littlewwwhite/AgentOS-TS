// apps/console/src/hooks/useWebSocket.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, WsEvent } from "../types";
import {
  buildChatHistoryKey,
  readStoredChatMessages,
  resolveRestoredChatMessages,
  writeStoredChatMessages,
} from "../lib/chatHistory";

function uid() {
  return Math.random().toString(36).slice(2);
}

function extractPath(content: unknown): string | undefined {
  if (typeof content !== "string" || !content) return undefined;
  const m = content.match(/(?:workspace\/[^/\s"]+\/)?((?:output|draft)\/[^\s")]+)/);
  return m?.[1];
}

interface SendOptions {
  agentMessage?: string;
}

export function useWebSocket(
  url: string,
  onToolResult?: (path: string) => void,
  onResult?: () => void,
  onSession?: (sessionId: string | null) => void,
  project?: string | null,
  sessionId?: string | null,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [slashCommands, setSlashCommands] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const thinkingIdRef = useRef<string | null>(null);
  const activeProjectRef = useRef<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const activeHistoryKeyRef = useRef<string | null>(null);

  const onToolResultRef = useRef(onToolResult);
  const onResultRef = useRef(onResult);
  const onSessionRef = useRef(onSession);
  useEffect(() => { onToolResultRef.current = onToolResult; }, [onToolResult]);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onSessionRef.current = onSession; }, [onSession]);

  useEffect(() => {
    const currentProject = project ?? null;
    const currentSession = sessionId ?? null;
    const nextKey = currentProject && sessionId ? buildChatHistoryKey(currentProject, sessionId) : null;
    const projectChanged = activeProjectRef.current !== currentProject;
    const sessionChanged = activeSessionRef.current !== currentSession;
    const bootstrappingSession = !projectChanged && activeSessionRef.current === null && currentSession !== null;
    const sameKey = activeHistoryKeyRef.current === nextKey;

    activeProjectRef.current = currentProject;
    activeSessionRef.current = currentSession;
    activeHistoryKeyRef.current = nextKey;

    if (!currentProject) {
      setMessages([]);
      return;
    }

    if (!sessionId) {
      if (projectChanged) setMessages([]);
      return;
    }

    const restored = readStoredChatMessages(currentProject, sessionId);
    setMessages((prev) =>
      resolveRestoredChatMessages(prev, restored, {
        sameKey,
        projectChanged,
        sessionChanged,
        bootstrappingSession,
      }),
    );
  }, [project, sessionId]);

  useEffect(() => {
    if (!project || !sessionId) return;
    writeStoredChatMessages(project, sessionId, messages);
  }, [messages, project, sessionId]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => {
      setIsConnected(false);
      setIsStreaming(false);
      streamingIdRef.current = null;
      thinkingIdRef.current = null;
      setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
    };

    ws.onmessage = (e) => {
      const event: WsEvent = JSON.parse(e.data);

      if (import.meta.env.DEV) {
        console.debug("[ws]", event.type, event);
      }

      if (event.type === "session") {
        onSessionRef.current?.(event.sessionId);
        return;
      }

      if (event.type === "slash_commands") {
        setSlashCommands(event.commands);
        return;
      }

      if (event.type === "system") {
        // Lossless passthrough; no UI surface yet. Keep for debugging.
        if (import.meta.env.DEV) console.debug("[ws] system", event.subtype, event.data);
        return;
      }

      if (event.type === "text") {
        setIsStreaming(true);
        if (thinkingIdRef.current) {
          const closingId = thinkingIdRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === closingId ? { ...m, isStreaming: false } : m))
          );
          thinkingIdRef.current = null;
        }
        const targetId = streamingIdRef.current ?? uid();
        if (!streamingIdRef.current) {
          streamingIdRef.current = targetId;
        }
        setMessages((prev) => {
          const hasTarget = prev.some((m) => m.id === targetId);
          if (hasTarget) {
            return prev.map((m) =>
              m.id === targetId ? { ...m, content: m.content + event.text } : m
            );
          }
          return [
            ...prev,
            { id: targetId, role: "assistant", kind: "text", content: event.text, isStreaming: true, timestamp: Date.now() },
          ];
        });
      }

      if (event.type === "thinking") {
        setIsStreaming(true);
        const targetId = thinkingIdRef.current ?? uid();
        if (!thinkingIdRef.current) {
          thinkingIdRef.current = targetId;
        }
        setMessages((prev) => {
          const hasTarget = prev.some((m) => m.id === targetId);
          if (hasTarget) {
            return prev.map((m) =>
              m.id === targetId ? { ...m, content: m.content + event.text } : m
            );
          }
          return [
            ...prev,
            { id: targetId, role: "assistant", kind: "thinking", content: event.text, isStreaming: true, timestamp: Date.now() },
          ];
        });
      }

      if (event.type === "tool_use") {
        if (thinkingIdRef.current) {
          const closingId = thinkingIdRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === closingId ? { ...m, isStreaming: false } : m))
          );
          thinkingIdRef.current = null;
        }
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
        thinkingIdRef.current = null;
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
        thinkingIdRef.current = null;
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
    (message: string, project?: string, sessionId?: string, options: SendOptions = {}) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setIsStreaming(true);
      setMessages((prev) => [...prev, userMsg]);
      wsRef.current.send(JSON.stringify({ message: options.agentMessage ?? message, project, sessionId }));
    },
    []
  );

  const stop = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ action: "interrupt" }));
    setIsStreaming(false);
    streamingIdRef.current = null;
    thinkingIdRef.current = null;
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  }, []);

  return { messages, isConnected, isStreaming, slashCommands, send, stop };
}
