import { describe, expect, it } from "vitest";
import { createToolServers, toolServers } from "../src/tools/index.js";

const EXPECTED_SERVER_NAMES = ["audio", "image", "script", "storage", "video"];

describe("createToolServers", () => {
  it("creates a fresh tool server registry for each call", () => {
    const first = createToolServers();
    const second = createToolServers();

    expect(Object.keys(first).sort()).toEqual(EXPECTED_SERVER_NAMES);
    expect(Object.keys(second).sort()).toEqual(EXPECTED_SERVER_NAMES);
    expect(first).not.toBe(second);

    for (const name of EXPECTED_SERVER_NAMES) {
      expect(first[name]).toBeDefined();
      expect(second[name]).toBeDefined();
      expect(first[name]).not.toBe(second[name]);
    }
  });

  it("keeps a static registry export for callers that only need one set of servers", () => {
    expect(Object.keys(toolServers).sort()).toEqual(EXPECTED_SERVER_NAMES);
  });
});
