"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SandboxCommand, SandboxEvent } from "@/lib/protocol";

export type TransportState = "connecting" | "connected" | "disconnected" | "error";

export function getServerBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_AGENTOS_SERVER_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

function getWebSocketUrl(projectId: string): string {
  const url = new URL(getServerBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/${encodeURIComponent(projectId)}`;
  return url.toString();
}

export interface UseSandboxConnectionOptions {
  projectId: string;
  onEvent?: (event: SandboxEvent) => void;
  onStateChange?: (state: TransportState) => void;
}

export function useSandboxConnection({
  projectId,
  onEvent,
  onStateChange,
}: UseSandboxConnectionOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const onStateChangeRef = useRef(onStateChange);
  const [transportState, setTransportState] = useState<TransportState>("connecting");

  onEventRef.current = onEvent;
  onStateChangeRef.current = onStateChange;

  const sendCommand = useCallback(async (cmd: SandboxCommand) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    socket.send(JSON.stringify(cmd));
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectAttempts = 0;

    const applyState = (nextState: TransportState) => {
      setTransportState(nextState);
      onStateChangeRef.current?.(nextState);
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      applyState("connecting");
      const socket = new WebSocket(getWebSocketUrl(projectId));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        reconnectAttempts = 0;
        applyState("connected");
        socket.send(JSON.stringify({ cmd: "status" }));
        socket.send(JSON.stringify({ cmd: "list_skills" }));
      });

      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data as string) as SandboxEvent;
          onEventRef.current?.(event);
        } catch {
          return;
        }
      });

      socket.addEventListener("error", () => {
        applyState("error");
      });

      socket.addEventListener("close", () => {
        if (disposed) {
          return;
        }

        applyState("disconnected");
        reconnectAttempts += 1;
        const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 5000);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [projectId]);

  return {
    transportState,
    sendCommand,
  };
}
