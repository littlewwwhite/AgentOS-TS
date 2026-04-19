import { describe, expect, test } from "bun:test";
import { buildProjectRouteSearch, readProjectRoute } from "../src/lib/sessionRoute";

describe("session route helpers", () => {
  test("reads project and session from search params", () => {
    expect(readProjectRoute("?project=c3&session=sess_123")).toEqual({
      project: "c3",
      sessionId: "sess_123",
    });
  });

  test("preserves unrelated params when writing route search", () => {
    const next = buildProjectRouteSearch("?tab=storyboard", {
      project: "c3",
      sessionId: "sess_123",
    });
    const params = new URLSearchParams(next);
    expect(params.get("tab")).toBe("storyboard");
    expect(params.get("project")).toBe("c3");
    expect(params.get("session")).toBe("sess_123");
  });

  test("drops session when project is cleared", () => {
    const next = buildProjectRouteSearch("?project=c3&session=sess_123&tab=chat", {
      project: null,
      sessionId: null,
    });
    const params = new URLSearchParams(next);
    expect(params.get("project")).toBeNull();
    expect(params.get("session")).toBeNull();
    expect(params.get("tab")).toBe("chat");
  });
});
