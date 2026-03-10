import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TerminalSpinner } from "../src/repl-spinner.js";

function createMockStream() {
  const chunks: string[] = [];
  return {
    chunks,
    stream: { write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }) } as unknown as NodeJS.WriteStream,
  };
}

describe("TerminalSpinner", () => {
  let mock: ReturnType<typeof createMockStream>;
  let spinner: TerminalSpinner;

  beforeEach(() => {
    mock = createMockStream();
    spinner = new TerminalSpinner(mock.stream, (s) => `[dim]${s}[/dim]`);
  });

  afterEach(() => {
    spinner.stop();
  });

  it("starts and renders a frame", () => {
    spinner.start("Loading...");
    expect(spinner.isActive).toBe(true);
    // First render happens immediately in start()
    expect(mock.stream.write).toHaveBeenCalled();
    const lastWrite = mock.chunks[mock.chunks.length - 1];
    expect(lastWrite).toContain("Loading...");
  });

  it("stops and clears the line", () => {
    spinner.start("Working...");
    mock.chunks.length = 0;
    spinner.stop();
    expect(spinner.isActive).toBe(false);
    expect(mock.chunks).toContain("\r\x1b[K");
  });

  it("guardedWrite clears and re-renders when active", () => {
    spinner.start("Busy");
    mock.chunks.length = 0;

    spinner.guardedWrite("output text");

    // Should have: clear, write, re-render
    expect(mock.chunks[0]).toBe("\r\x1b[K");
    expect(mock.chunks[1]).toBe("output text");
    // Last chunk should contain the status re-render
    const lastChunk = mock.chunks[mock.chunks.length - 1];
    expect(lastChunk).toContain("Busy");
  });

  it("guardedWrite passes through when inactive", () => {
    spinner.guardedWrite("plain text");
    expect(mock.chunks).toEqual(["plain text"]);
  });

  it("update changes the status text", () => {
    spinner.start("First");
    mock.chunks.length = 0;
    spinner.update("Second");
    const lastChunk = mock.chunks[mock.chunks.length - 1];
    expect(lastChunk).toContain("Second");
  });
});
