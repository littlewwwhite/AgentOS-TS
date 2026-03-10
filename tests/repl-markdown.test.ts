import { describe, expect, it } from "vitest";
import {
  createMarkdownState,
  transformMarkdownChunk,
  flushMarkdownBuffer,
} from "../src/repl-markdown.js";
import type { ReplPalette } from "../src/e2b-repl-render.js";

const palette: ReplPalette = {
  dim: (s) => `<dim>${s}</dim>`,
  cyan: (s) => `<cyan>${s}</cyan>`,
  yellow: (s) => `<yellow>${s}</yellow>`,
  red: (s) => `<red>${s}</red>`,
  bold: (s) => `<bold>${s}</bold>`,
  magenta: (s) => `<magenta>${s}</magenta>`,
  green: (s) => `<green>${s}</green>`,
  badge: (s) => `[${s}]`,
};

describe("transformMarkdownChunk", () => {
  it("converts heading lines", () => {
    const state = createMarkdownState();
    const result = transformMarkdownChunk(state, "## Hello World\n", palette);
    expect(result.output).toBe("<bold>Hello World</bold>\n");
  });

  it("converts inline code", () => {
    const state = createMarkdownState();
    const result = transformMarkdownChunk(state, "Use `foo()` here\n", palette);
    expect(result.output).toContain("<cyan>foo()</cyan>");
  });

  it("converts bold text", () => {
    const state = createMarkdownState();
    const result = transformMarkdownChunk(state, "This is **important**\n", palette);
    expect(result.output).toContain("<bold>important</bold>");
  });

  it("converts italic text", () => {
    const state = createMarkdownState();
    const result = transformMarkdownChunk(state, "This is *subtle*\n", palette);
    expect(result.output).toContain("<dim>subtle</dim>");
  });

  it("handles code blocks", () => {
    const state = createMarkdownState();
    const r1 = transformMarkdownChunk(state, "```typescript\nconst x = 1;\n```\n", palette);
    expect(r1.output).toContain("<dim>  ─── typescript ───</dim>");
    expect(r1.output).toContain("<dim>  const x = 1;</dim>");
    expect(r1.state.inCodeBlock).toBe(false);
  });

  it("buffers incomplete lines", () => {
    const state = createMarkdownState();
    const r1 = transformMarkdownChunk(state, "Hello ", palette);
    expect(r1.output).toBe("");
    expect(r1.state.lineBuffer).toBe("Hello ");

    const r2 = transformMarkdownChunk(r1.state, "World\n", palette);
    expect(r2.output).toBe("Hello World\n");
    expect(r2.state.lineBuffer).toBe("");
  });
});

describe("flushMarkdownBuffer", () => {
  it("flushes remaining buffer content", () => {
    const state = { ...createMarkdownState(), lineBuffer: "trailing text" };
    const result = flushMarkdownBuffer(state, palette);
    expect(result.output).toBe("trailing text");
    expect(result.state.lineBuffer).toBe("");
  });

  it("returns empty for empty buffer", () => {
    const state = createMarkdownState();
    const result = flushMarkdownBuffer(state, palette);
    expect(result.output).toBe("");
  });
});
