// input: AsyncQueue from sandbox-orchestrator
// output: Tests for queue push/pull, FIFO ordering, async waiter semantics
// pos: Unit test — validates core concurrency primitive

import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../src/sandbox-orchestrator.js";

describe("AsyncQueue", () => {
  it("push then pull returns item immediately", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const v = await q.pull();
    expect(v).toBe(1);
  });

  it("pull then push resolves waiter", async () => {
    const q = new AsyncQueue<string>();
    const promise = q.pull();
    q.push("hello");
    const v = await promise;
    expect(v).toBe("hello");
  });

  it("FIFO ordering", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    expect(await q.pull()).toBe(1);
    expect(await q.pull()).toBe(2);
    expect(await q.pull()).toBe(3);
  });

  it("multiple waiters served in order", async () => {
    const q = new AsyncQueue<number>();
    const p1 = q.pull();
    const p2 = q.pull();
    q.push(10);
    q.push(20);
    expect(await p1).toBe(10);
    expect(await p2).toBe(20);
  });

  it("pending count reflects buffer size", () => {
    const q = new AsyncQueue<number>();
    expect(q.pending).toBe(0);
    q.push(1);
    q.push(2);
    expect(q.pending).toBe(2);
  });

  it("pending decreases on pull from buffer", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    await q.pull();
    expect(q.pending).toBe(1);
  });

  it("pending is zero when waiters consume immediately", () => {
    const q = new AsyncQueue<number>();
    q.pull(); // creates waiter
    q.push(1); // goes directly to waiter, not buffer
    expect(q.pending).toBe(0);
  });

  it("handles interleaved push/pull", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    expect(await q.pull()).toBe(1);
    const p = q.pull();
    q.push(2);
    expect(await p).toBe(2);
    q.push(3);
    q.push(4);
    expect(await q.pull()).toBe(3);
    expect(await q.pull()).toBe(4);
  });

  it("works with complex object types", async () => {
    const q = new AsyncQueue<{ prompt: string; requestId?: string }>();
    q.push({ prompt: "hello", requestId: "r1" });
    q.push({ prompt: "world" });
    const first = await q.pull();
    expect(first.prompt).toBe("hello");
    expect(first.requestId).toBe("r1");
    const second = await q.pull();
    expect(second.prompt).toBe("world");
    expect(second.requestId).toBeUndefined();
  });
});
