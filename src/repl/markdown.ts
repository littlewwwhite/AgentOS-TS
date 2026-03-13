// input: Raw markdown text chunks from streaming agent output
// output: ANSI-formatted text for terminal rendering
// pos: Streaming markdown-to-ANSI converter for CLI REPL output pipeline

import type { ReplPalette } from "./render.js";

export interface MarkdownState {
  lineBuffer: string;
  inCodeBlock: boolean;
  codeBlockLang: string;
}

export function createMarkdownState(): MarkdownState {
  return { lineBuffer: "", inCodeBlock: false, codeBlockLang: "" };
}

function transformInline(line: string, palette: ReplPalette): string {
  // Links: [text](url) → text (url)
  line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
    `${palette.cyan(text)} ${palette.dim(`(${url})`)}`);
  // Inline code: `code`
  line = line.replace(/`([^`]+)`/g, (_, code) => palette.cyan(code));
  // Bold: **text**
  line = line.replace(/\*\*([^*]+)\*\*/g, (_, text) => palette.bold(text));
  // Italic: *text*
  line = line.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, text) => palette.dim(text));
  return line;
}

function transformLine(line: string, state: MarkdownState, palette: ReplPalette): { output: string; state: MarkdownState } {
  // Code fence toggle
  if (line.trimStart().startsWith("```")) {
    if (!state.inCodeBlock) {
      const lang = line.trimStart().slice(3).trim();
      return {
        output: palette.dim(lang ? `  ─── ${lang} ───` : "  ───"),
        state: { ...state, inCodeBlock: true, codeBlockLang: lang },
      };
    }
    return {
      output: palette.dim("  ───"),
      state: { ...state, inCodeBlock: false, codeBlockLang: "" },
    };
  }

  // Inside code block — dim entire line
  if (state.inCodeBlock) {
    return { output: palette.dim(`  ${line}`), state };
  }

  // Headings with visual hierarchy
  const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const text = transformInline(headingMatch[2], palette);
    if (level === 1) return { output: `${palette.bold(text)}\n${"─".repeat(Math.min(text.length, 40))}`, state };
    if (level === 2) return { output: palette.bold(text), state };
    return { output: palette.dim(palette.bold(text)), state };
  }

  // Blockquote: > text
  const quoteMatch = line.match(/^>\s?(.*)/);
  if (quoteMatch) {
    return { output: `${palette.dim("│")} ${palette.dim(transformInline(quoteMatch[1], palette))}`, state };
  }

  // Unordered list: - item, * item
  const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
  if (ulMatch) {
    const indent = ulMatch[1];
    return { output: `${indent}  ${palette.dim("•")} ${transformInline(ulMatch[2], palette)}`, state };
  }

  // Ordered list: 1. item
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
  if (olMatch) {
    const indent = olMatch[1];
    return { output: `${indent}  ${palette.dim(`${olMatch[2]}.`)} ${transformInline(olMatch[3], palette)}`, state };
  }

  // Horizontal rule: ---, ***, ___
  if (/^[-*_]{3,}\s*$/.test(line)) {
    return { output: palette.dim("────────────────"), state };
  }

  // Normal line — apply inline formatting
  return { output: transformInline(line, palette), state };
}

export function transformMarkdownChunk(
  state: MarkdownState,
  chunk: string,
  palette: ReplPalette,
): { state: MarkdownState; output: string } {
  const combined = state.lineBuffer + chunk;
  const lines = combined.split("\n");

  // Last element is the incomplete line (could be empty string if chunk ends with \n)
  const incomplete = lines.pop()!;
  let currentState: MarkdownState = { ...state, lineBuffer: incomplete };
  const outputParts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const result = transformLine(lines[i], currentState, palette);
    currentState = { ...result.state, lineBuffer: incomplete };
    outputParts.push(result.output + "\n");
  }

  return { state: currentState, output: outputParts.join("") };
}

export function flushMarkdownBuffer(
  state: MarkdownState,
  palette: ReplPalette,
): { state: MarkdownState; output: string } {
  if (!state.lineBuffer) {
    return { state: createMarkdownState(), output: "" };
  }

  const result = transformLine(state.lineBuffer, state, palette);
  return {
    state: { ...createMarkdownState() },
    output: result.output,
  };
}
