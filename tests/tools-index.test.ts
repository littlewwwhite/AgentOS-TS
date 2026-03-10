import { describe, expect, it } from "vitest";
import { createToolServers } from "../src/tools/index.js";

const EXPECTED_SERVER_NAMES = ["audio", "image", "script", "storage", "video"];

describe("createToolServers", () => {
  it("creates a fresh tool server registry for each call", () => {
    const first = createToolServers(EXPECTED_SERVER_NAMES);
    const second = createToolServers(EXPECTED_SERVER_NAMES);

    expect(Object.keys(first).sort()).toEqual(EXPECTED_SERVER_NAMES);
    expect(Object.keys(second).sort()).toEqual(EXPECTED_SERVER_NAMES);
    expect(first).not.toBe(second);

    for (const name of EXPECTED_SERVER_NAMES) {
      expect(first[name]).toBeDefined();
      expect(second[name]).toBeDefined();
      expect(first[name]).not.toBe(second[name]);
    }
  });

  it("defaults to an empty registry for least-privilege callers", () => {
    expect(Object.keys(createToolServers())).toEqual([]);
  });

  it("creates only the requested sdk-backed servers", () => {
    const servers = createToolServers(["storage", "script"]);
    expect(Object.keys(servers).sort()).toEqual(["script", "storage"]);
  });

  it("ignores the switch sentinel because dispatch servers are attached elsewhere", () => {
    const servers = createToolServers(["switch"]);
    expect(Object.keys(servers)).toEqual([]);
  });
});
