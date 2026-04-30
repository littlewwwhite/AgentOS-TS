import { describe, expect, test } from "bun:test";
import { parseEnvFile, loadEnvFileIfMissing } from "../src/lib/serverEnv";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("server env loading", () => {
  test("parses comments, quoted values, and plain assignments", () => {
    expect(parseEnvFile([
      "# ANTHROPIC_MODEL=ignored",
      "ANTHROPIC_MODEL=glm-5.1",
      "ANTHROPIC_BASE_URL=\"https://example.test\"",
      "ANTHROPIC_AUTH_TOKEN='token-value'",
    ].join("\n"))).toEqual({
      ANTHROPIC_MODEL: "glm-5.1",
      ANTHROPIC_BASE_URL: "https://example.test",
      ANTHROPIC_AUTH_TOKEN: "token-value",
    });
  });

  test("loads missing env values without overriding explicit process env", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentos-env-"));
    const envPath = join(dir, ".env");
    const env: NodeJS.ProcessEnv = { ANTHROPIC_MODEL: "explicit-model" };
    writeFileSync(envPath, "ANTHROPIC_MODEL=glm-5.1\nANTHROPIC_BASE_URL=https://example.test\n");

    try {
      expect(loadEnvFileIfMissing(envPath, env)).toEqual(["ANTHROPIC_BASE_URL"]);
      expect(env.ANTHROPIC_MODEL).toBe("explicit-model");
      expect(env.ANTHROPIC_BASE_URL).toBe("https://example.test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
