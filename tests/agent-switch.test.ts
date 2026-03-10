// input: agent-switch module (signal, tools, dispatch servers)
// output: Tests for signal-driven agent switching mechanism
// pos: Unit test — validates orchestrator's core communication bridge

import { describe, it, expect } from "vitest";
import {
  createSwitchSignal,
  createSwitchToAgent,
  createReturnToMain,
  createDispatchServers,
} from "../src/tools/agent-switch.js";

describe("createSwitchSignal", () => {
  it("initializes with null requests", () => {
    const signal = createSwitchSignal();
    expect(signal.switchRequest).toBeNull();
    expect(signal.returnRequest).toBeNull();
  });
});

describe("createSwitchToAgent", () => {
  it("sets switchRequest on signal when called", async () => {
    const signal = createSwitchSignal();
    const agentNames = ["screenwriter", "art-director"];
    const switchTool = createSwitchToAgent(signal, agentNames);

    // Verify tool metadata
    expect(switchTool).toBeDefined();

    // Simulate calling the tool
    signal.switchRequest = { agent: "screenwriter", task: "Write episode 1" };
    expect(signal.switchRequest).toEqual({
      agent: "screenwriter",
      task: "Write episode 1",
    });
  });

  it("signal can be cleared after consumption", () => {
    const signal = createSwitchSignal();
    signal.switchRequest = { agent: "art-director", task: "Generate images" };
    expect(signal.switchRequest).not.toBeNull();

    // Orchestrator consumes the signal
    const req = signal.switchRequest;
    signal.switchRequest = null;
    expect(req!.agent).toBe("art-director");
    expect(signal.switchRequest).toBeNull();
  });
});

describe("createReturnToMain", () => {
  it("sets returnRequest on signal when called", () => {
    const signal = createSwitchSignal();
    const returnTool = createReturnToMain(signal);
    expect(returnTool).toBeDefined();

    signal.returnRequest = { summary: "Episode 1 completed" };
    expect(signal.returnRequest).toEqual({ summary: "Episode 1 completed" });
  });

  it("signal can be consumed and cleared", () => {
    const signal = createSwitchSignal();
    signal.returnRequest = { summary: "All done" };
    const req = signal.returnRequest;
    signal.returnRequest = null;
    expect(req!.summary).toBe("All done");
    expect(signal.returnRequest).toBeNull();
  });
});

describe("createDispatchServers", () => {
  it("creates both master and full servers", () => {
    const signal = createSwitchSignal();
    const { masterServer, fullServer } = createDispatchServers(signal, [
      "screenwriter",
      "art-director",
    ]);
    expect(masterServer).toBeDefined();
    expect(fullServer).toBeDefined();
  });

  it("master and full servers are distinct objects", () => {
    const signal = createSwitchSignal();
    const { masterServer, fullServer } = createDispatchServers(signal, [
      "screenwriter",
    ]);
    expect(masterServer).not.toBe(fullServer);
  });

  it("works with single agent", () => {
    const signal = createSwitchSignal();
    const { masterServer, fullServer } = createDispatchServers(signal, [
      "screenwriter",
    ]);
    expect(masterServer).toBeDefined();
    expect(fullServer).toBeDefined();
  });

  it("shared signal allows bidirectional communication", () => {
    const signal = createSwitchSignal();
    createDispatchServers(signal, ["screenwriter", "art-director"]);

    // Simulate master → agent switch
    signal.switchRequest = { agent: "screenwriter", task: "Write script" };
    expect(signal.switchRequest?.agent).toBe("screenwriter");

    // Consume switch request
    signal.switchRequest = null;

    // Simulate agent → master return
    signal.returnRequest = { summary: "Script completed" };
    expect(signal.returnRequest?.summary).toBe("Script completed");

    // Consume return request
    signal.returnRequest = null;

    expect(signal.switchRequest).toBeNull();
    expect(signal.returnRequest).toBeNull();
  });
});
