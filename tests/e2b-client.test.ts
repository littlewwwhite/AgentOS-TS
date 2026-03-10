import { describe, it, expect } from "vitest";
import { SandboxClient } from "../src/e2b-client.js";

describe("SandboxClient", () => {
  it("throws when sendCommand called before start", async () => {
    const client = new SandboxClient({
      templateId: "test-template",
    });
    await expect(client.chat("hello")).rejects.toThrow(
      "Sandbox not started",
    );
  });

  it("exposes null sandboxId and pid before start", () => {
    const client = new SandboxClient({
      templateId: "test-template",
    });
    expect(client.sandboxId).toBeNull();
    expect(client.pid).toBeNull();
  });

  it("parses JSON lines from stdout correctly", () => {
    const events: unknown[] = [];
    const client = new SandboxClient({
      templateId: "test-template",
      onEvent: (ev) => events.push(ev),
    });

    // Access private method for testing via prototype
    const handler = (client as any).handleStdout.bind(client);

    // Simulate chunked delivery of JSON lines
    handler('{"type":"ready","skills":["a"]}\n');
    handler('{"type":"text","tex');
    handler('t":"hello"}\n');

    expect(events).toEqual([
      { type: "ready", skills: ["a"] },
      { type: "text", text: "hello" },
    ]);
  });

  it("ignores non-JSON stdout lines", () => {
    const events: unknown[] = [];
    const client = new SandboxClient({
      templateId: "test-template",
      onEvent: (ev) => events.push(ev),
    });

    const handler = (client as any).handleStdout.bind(client);
    handler("some random text\n");
    handler('{"type":"text","text":"ok"}\n');

    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("accepts onSandboxRecreated option without error", () => {
    const recreatedCb = async () => {};
    const client = new SandboxClient({
      templateId: "test-template",
      onSandboxRecreated: recreatedCb,
    });
    // Should construct without throwing — callback is stored for reconnect use
    expect(client.sandboxId).toBeNull();
  });

  it("tracks heartbeatFailCount field initialized to zero", () => {
    const client = new SandboxClient({ templateId: "test-template" });
    // Access private field to verify initialization
    expect((client as any).heartbeatFailCount).toBe(0);
  });

  it("handles multiple events in single chunk", () => {
    const events: unknown[] = [];
    const client = new SandboxClient({
      templateId: "test-template",
      onEvent: (ev) => events.push(ev),
    });

    const handler = (client as any).handleStdout.bind(client);
    handler(
      '{"type":"text","text":"a"}\n{"type":"text","text":"b"}\n',
    );

    expect(events).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });
});
