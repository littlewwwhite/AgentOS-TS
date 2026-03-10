import { describe, expect, it } from "vitest";

import { applyReplEvent, createInitialReplState } from "../src/e2b-repl-state.js";

describe("e2b repl state", () => {
  it("renders automatic delegation entry and updates active agent", () => {
    const next = applyReplEvent(createInitialReplState(), {
      type: "agent_entered",
      agent: "screenwriter",
      reason: "delegation",
      parent_agent: "main",
    });

    expect(next.state.activeAgent).toBe("screenwriter");
    expect(next.logs).toEqual(["  ⏺ delegated main → screenwriter"]);
  });

  it("renders automatic return and clears active agent", () => {
    const started = applyReplEvent(createInitialReplState(), {
      type: "agent_entered",
      agent: "screenwriter",
      reason: "delegation",
      parent_agent: "main",
    }).state;

    const next = applyReplEvent(started, {
      type: "agent_exited",
      agent: "screenwriter",
      reason: "return",
      parent_agent: "main",
    });

    expect(next.state.activeAgent).toBeNull();
    expect(next.logs).toEqual(["  ⏺ returned screenwriter → main"]);
  });

  it("keeps manual transitions silent because repl already prints them", () => {
    const entered = applyReplEvent(createInitialReplState(), {
      type: "agent_entered",
      agent: "screenwriter",
      reason: "manual",
    });
    const exited = applyReplEvent(entered.state, {
      type: "agent_exited",
      agent: "screenwriter",
      reason: "manual",
    });

    expect(entered.logs).toEqual([]);
    expect(exited.logs).toEqual([]);
  });
});
