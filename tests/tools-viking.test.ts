import { describe, it, expect } from "vitest";
import { createToolServers } from "../src/tools/index.js";

describe("viking tool server", () => {
  it("is registered in TOOL_SERVER_BUILDERS", () => {
    const servers = createToolServers(["viking"]);
    expect(servers.viking).toBeDefined();
  });

  it("creates distinct instances per call", () => {
    const a = createToolServers(["viking"]);
    const b = createToolServers(["viking"]);
    expect(a.viking).not.toBe(b.viking);
  });
});
