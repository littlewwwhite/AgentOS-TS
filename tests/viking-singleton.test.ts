import { describe, it, expect, afterEach } from "vitest";
import { getVikingClient, initViking, resetViking } from "../src/viking/index.js";

afterEach(() => resetViking());

describe("Viking singleton", () => {
  it("returns null before initialization", () => {
    expect(getVikingClient()).toBeNull();
  });

  it("returns client after initialization", () => {
    const client = initViking();
    expect(client).toBeDefined();
    expect(getVikingClient()).toBe(client);
  });

  it("returns same instance on repeated init", () => {
    const a = initViking();
    const b = initViking();
    expect(a).toBe(b);
  });

  it("resets to null", () => {
    initViking();
    resetViking();
    expect(getVikingClient()).toBeNull();
  });
});
