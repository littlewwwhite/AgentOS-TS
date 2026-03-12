import { describe, expect, it } from "vitest";
import {
  FIXED_MODEL,
  interpretPrompt,
  shouldAppendLocalNotice,
} from "../../web/lib/slash-commands";

describe("interpretPrompt", () => {
  it("maps plain text to a chat command for the selected agent", () => {
    const result = interpretPrompt("Draft episode one", {
      selectedAgent: "screenwriter",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "command",
      selectedAgent: "screenwriter",
      command: {
        cmd: "chat",
        message: "Draft episode one",
        target: "screenwriter",
      },
    });
  });

  it("switches to an agent with /enter and emits the backend command", () => {
    const result = interpretPrompt("/enter art-director", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter", "art-director"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "art-director",
      command: {
        cmd: "enter_agent",
        agent: "art-director",
      },
      notice: `Switched to art-director · model ${FIXED_MODEL}`,
    });
  });

  it("returns to main with /exit", () => {
    const result = interpretPrompt("/exit", {
      selectedAgent: "screenwriter",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "main",
      command: { cmd: "exit_agent" },
      notice: `Switched to main · model ${FIXED_MODEL}`,
    });
  });

  it("reports the fixed model locally", () => {
    const result = interpretPrompt("/model", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "main",
      notice: `Model is fixed to ${FIXED_MODEL}`,
    });
  });

  it("lists available slash commands locally", () => {
    const result = interpretPrompt("/help", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "main",
      notice:
        "Commands: /enter <agent>, /exit, /agents, /skills, /status, /model, /resume <session_id>, /stop, /clear, /help",
    });
    expect(shouldAppendLocalNotice(result)).toBe(true);
  });

  it("lists available agents locally", () => {
    const result = interpretPrompt("/agents", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter", "art-director"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "main",
      notice: "Available agents: main, screenwriter, art-director",
    });
  });

  it("requests a status refresh without entering the chat transcript", () => {
    const result = interpretPrompt("/status", {
      selectedAgent: "screenwriter",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "screenwriter",
      command: { cmd: "status" },
      notice: `Requested status for screenwriter · model ${FIXED_MODEL}`,
    });
    expect(shouldAppendLocalNotice(result)).toBe(false);
  });

  it("requests the skills list with a skills-specific notice", () => {
    const result = interpretPrompt("/skills", {
      selectedAgent: "screenwriter",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "screenwriter",
      command: { cmd: "list_skills" },
      notice: "Requested skills for screenwriter",
    });
  });

  it("routes resume to the backend when a session id is provided", () => {
    const result = interpretPrompt("/resume sess-123", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "local",
      selectedAgent: "main",
      command: { cmd: "resume", session_id: "sess-123" },
      notice: `Requested resume for sess-123 · model ${FIXED_MODEL}`,
    });
  });

  it("reports an error when /resume is missing a session id", () => {
    const result = interpretPrompt("/resume", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "error",
      selectedAgent: "main",
      notice: "Missing session id. Usage: /resume <session_id>",
    });
  });

  it("reports an error for unknown agents", () => {
    const result = interpretPrompt("/enter editor", {
      selectedAgent: "main",
      availableAgents: ["main", "screenwriter"],
    });

    expect(result).toEqual({
      kind: "error",
      selectedAgent: "main",
      notice: 'Unknown agent "editor". Available: main, screenwriter',
    });
  });
});
