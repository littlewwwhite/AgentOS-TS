import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VikingClient } from "../src/viking/client.js";

const DEFAULT_URL = "http://localhost:1933";
const CUSTOM_URL = "http://viking.example.com:8080";
const API_KEY = "test-api-key";
const AGENT_ID = "test-agent";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VikingClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENVIKING_URL;
  });

  // ---- constructor defaults ----

  describe("constructor", () => {
    it("uses default url and timeout", () => {
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      expect(c.baseUrl).toBe(DEFAULT_URL);
      expect(c.timeoutMs).toBe(10_000);
    });

    it("accepts a custom url", () => {
      const c = new VikingClient({ url: CUSTOM_URL, apiKey: API_KEY, agentId: AGENT_ID });
      expect(c.baseUrl).toBe(CUSTOM_URL);
    });

    it("reads OPENVIKING_URL env var as fallback", () => {
      process.env.OPENVIKING_URL = "http://env-viking:2000";
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      expect(c.baseUrl).toBe("http://env-viking:2000");
    });

    it("prefers explicit url over env var", () => {
      process.env.OPENVIKING_URL = "http://env-viking:2000";
      const c = new VikingClient({ url: CUSTOM_URL, apiKey: API_KEY, agentId: AGENT_ID });
      expect(c.baseUrl).toBe(CUSTOM_URL);
    });

    it("accepts custom timeoutMs", () => {
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID, timeoutMs: 5000 });
      expect(c.timeoutMs).toBe(5000);
    });
  });

  // ---- health ----

  describe("health()", () => {
    it("returns true when server responds with 200", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ status: "ok" }));
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      expect(await c.health()).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${DEFAULT_URL}/health`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("returns false when server responds with non-200", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "down" }, 503));
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      expect(await c.health()).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("network error"));
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      expect(await c.health()).toBe(false);
    });
  });

  // ---- find ----

  describe("find()", () => {
    it("posts query and returns resources", async () => {
      const resources = [
        { uri: "file:///a.txt", score: 0.95, content: "hello" },
        { uri: "file:///b.txt", score: 0.8, content: "world" },
      ];
      fetchSpy.mockResolvedValueOnce(jsonResponse({ result: { resources } }));

      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      const result = await c.find("test query", { limit: 5 });

      expect(result).toEqual(resources);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${DEFAULT_URL}/api/v1/search`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "test query", limit: 5 }),
        }),
      );
    });

    it("returns empty array when no resources in response", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ result: {} }));
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      expect(await c.find("query")).toEqual([]);
    });

    it("sends correct headers", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ result: { resources: [] } }));
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      await c.find("query");

      const call = fetchSpy.mock.calls[0];
      const opts = call[1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-API-Key"]).toBe(API_KEY);
      expect(headers["X-Agent-Id"]).toBe(AGENT_ID);
    });
  });

  // ---- addResource ----

  describe("addResource()", () => {
    it("posts resource path and returns result", async () => {
      const addResult = { uri: "file:///new.txt", status: "indexed" };
      fetchSpy.mockResolvedValueOnce(jsonResponse(addResult));

      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      const result = await c.addResource("/path/to/new.txt", { tags: ["doc"] });

      expect(result).toEqual(addResult);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${DEFAULT_URL}/api/v1/resources`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ path: "/path/to/new.txt", tags: ["doc"] }),
        }),
      );
    });
  });

  // ---- ls ----

  describe("ls()", () => {
    it("fetches directory listing for a uri", async () => {
      const entries = [
        { name: "a.txt", type: "file", uri: "file:///dir/a.txt" },
        { name: "sub", type: "directory", uri: "file:///dir/sub" },
      ];
      fetchSpy.mockResolvedValueOnce(jsonResponse(entries));

      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID });
      const result = await c.ls("file:///dir");

      expect(result).toEqual(entries);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${DEFAULT_URL}/api/v1/fs/ls?uri=${encodeURIComponent("file:///dir")}`,
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // ---- timeout ----

  describe("timeout", () => {
    it("passes AbortSignal.timeout to fetch", async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ status: "ok" }));
      const c = new VikingClient({ apiKey: API_KEY, agentId: AGENT_ID, timeoutMs: 3000 });
      await c.health();

      const call = fetchSpy.mock.calls[0];
      const opts = call[1] as RequestInit;
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
