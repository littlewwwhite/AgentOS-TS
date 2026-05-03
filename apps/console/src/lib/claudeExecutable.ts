// input: repository root + current host platform
// output: explicit Claude Code executable path for Claude Agent SDK
// pos: server-side SDK bootstrap helper that avoids wrong native binary selection

import { existsSync } from "fs";
import { join } from "path";

export function claudeNativePackageOrder(platform = process.platform, arch = process.arch): string[] {
  const exe = platform === "win32" ? ".exe" : "";
  if (platform === "linux") {
    // Prefer glibc on normal Linux hosts. The SDK resolver checks musl first,
    // which fails on yc-hk with an ENOENT-style "binary not found" error.
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude${exe}`,
      `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude${exe}`,
    ];
  }
  return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${exe}`];
}

export function resolveClaudeCodeExecutable(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  arch = process.arch,
): string | undefined {
  if (env.CLAUDE_CODE_EXECUTABLE) return env.CLAUDE_CODE_EXECUTABLE;

  const nodeModules = join(projectRoot, "apps", "console", "node_modules");
  for (const relativePath of claudeNativePackageOrder(platform, arch)) {
    const executable = join(nodeModules, relativePath);
    if (existsSync(executable)) return executable;
  }
  return undefined;
}
