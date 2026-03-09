// input: .env file on disk
// output: parsed key-value pairs from .env
// pos: Shared utility — single .env parser used by server.ts and test harness

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DotEnv {
  E2B_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  [key: string]: string | undefined;
}

/**
 * Parse .env file from project root (or given path).
 * Prefers .env values over process.env — critical because Claude Code sets
 * ANTHROPIC_BASE_URL to a local proxy unreachable from inside E2B sandbox.
 */
export function loadDotEnv(envPath?: string): DotEnv {
  const filePath = envPath ?? resolve(process.cwd(), ".env");
  try {
    const result: DotEnv = {};
    for (const line of readFileSync(filePath, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq > 0) result[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return result;
  } catch {
    return {};
  }
}
