import { describe, expect, it } from "vitest";
import {
  createInitialUiState,
  reduceSandboxEvent,
} from "../../web/lib/reduce-sandbox-event";

describe("reduceSandboxEvent", () => {
  it("marks the connection ready and registers available agents", () => {
    const next = reduceSandboxEvent(createInitialUiState(), {
      type: "ready",
      skills: ["screenwriter", "art-director"],
    });

    expect(next.connection).toBe("ready");
    expect(next.availableAgents).toEqual(["main", "screenwriter", "art-director"]);
    expect(next.sessions.screenwriter).toBeDefined();
    expect(next.sessions["art-director"]).toBeDefined();
  });

  it("appends streaming assistant text by session", () => {
    const state = createInitialUiState();

    const withFirstChunk = reduceSandboxEvent(state, {
      type: "text",
      text: "Hello",
      agent: "screenwriter",
    });
    const withSecondChunk = reduceSandboxEvent(withFirstChunk, {
      type: "text",
      text: " world",
      agent: "screenwriter",
    });

    const session = withSecondChunk.sessions.screenwriter;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      kind: "assistant",
      text: "Hello world",
      streaming: true,
    });
    expect(session.status).toBe("busy");
  });

  it("assigns unique assistant ids across separate turns", () => {
    const firstTurn = reduceSandboxEvent(createInitialUiState(), {
      type: "text",
      text: "First draft",
    });
    const completedFirstTurn = reduceSandboxEvent(firstTurn, {
      type: "result",
      cost: 0.11,
      duration_ms: 500,
      session_id: "session-main",
      is_error: false,
    });
    const secondTurn = reduceSandboxEvent(completedFirstTurn, {
      type: "text",
      text: "Second draft",
    });

    const firstAssistant = completedFirstTurn.sessions.main.messages[0];
    const secondAssistant = secondTurn.sessions.main.messages[2];

    expect(firstAssistant).toMatchObject({ kind: "assistant", id: "assistant-main-0" });
    expect(secondAssistant).toMatchObject({ kind: "assistant", id: "assistant-main-2" });
  });

  it("records tool activity and completes the assistant turn on result", () => {
    const busy = reduceSandboxEvent(createInitialUiState(), {
      type: "text",
      text: "Drafting scene",
    });
    const withTool = reduceSandboxEvent(busy, {
      type: "tool_use",
      tool: "write_json",
      id: "tool_1",
    });
    const done = reduceSandboxEvent(withTool, {
      type: "result",
      cost: 0.42,
      duration_ms: 1200,
      session_id: "session-main",
      is_error: false,
    });

    expect(done.sessions.main.messages[1]).toMatchObject({
      kind: "tool_use",
      tool: "write_json",
    });
    expect(done.sessions.main.messages[2]).toMatchObject({
      kind: "result",
      cost: 0.42,
      durationMs: 1200,
      isError: false,
    });
    expect(done.sessions.main.messages[0]).toMatchObject({
      kind: "assistant",
      streaming: false,
    });
    expect(done.sessions.main.sessionId).toBe("session-main");
    expect(done.sessions.main.status).toBe("idle");
  });

  it("rebuilds session history deterministically", () => {
    const next = reduceSandboxEvent(createInitialUiState(), {
      type: "history",
      agent: "screenwriter",
      messages: [
        { role: "user", content: "Write a cold open", timestamp: 1000 },
        { role: "assistant", content: "Here is a draft", timestamp: 2000 },
      ],
    });

    expect(next.sessions.screenwriter.messages).toEqual([
      {
        kind: "user",
        id: "history-screenwriter-0",
        text: "Write a cold open",
        createdAt: 1000,
      },
      {
        kind: "assistant",
        id: "history-screenwriter-1",
        text: "Here is a draft",
        streaming: false,
      },
    ]);
  });

  it("tracks active agent transitions and skills payloads", () => {
    const withSkills = reduceSandboxEvent(createInitialUiState(), {
      type: "skills",
      skills: {
        screenwriter: "Writes scripts",
        "art-director": "Designs frames",
      },
    });
    const entered = reduceSandboxEvent(withSkills, {
      type: "agent_entered",
      agent: "screenwriter",
      session_id: "session-screenwriter",
    });
    const exited = reduceSandboxEvent(entered, {
      type: "agent_exited",
      agent: "screenwriter",
    });

    expect(withSkills.availableAgents).toEqual(["main", "screenwriter", "art-director"]);
    expect(entered.activeAgent).toBe("screenwriter");
    expect(entered.sessions.screenwriter.messages.at(-1)).toMatchObject({
      kind: "system",
      text: "Entered agent: screenwriter",
    });
    expect(exited.activeAgent).toBeNull();
    expect(exited.sessions.screenwriter.messages.at(-1)).toMatchObject({
      kind: "system",
      text: "Exited agent: screenwriter",
    });
  });

  it("maps status and error events to connection state", () => {
    const disconnected = reduceSandboxEvent(createInitialUiState(), {
      type: "status",
      state: "disconnected",
    });
    const failed = reduceSandboxEvent(disconnected, {
      type: "error",
      message: "Sandbox expired",
    });

    expect(disconnected.connection).toBe("disconnected");
    expect(disconnected.sessions.main.status).toBe("disconnected");
    expect(failed.connection).toBe("error");
    expect(failed.lastError).toBe("Sandbox expired");
  });
});
