// input: repo-root .env file path + process environment
// output: deterministic server env hydration helpers
// pos: server-side bridge between repo configuration and Claude Agent SDK

import { existsSync, readFileSync } from "fs";

export function parseEnvFile(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;

    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function loadEnvFileIfMissing(path: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(path)) return [];
  const parsed = parseEnvFile(readFileSync(path, "utf8"));
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
