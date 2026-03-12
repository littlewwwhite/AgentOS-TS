import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve("agents");
const SHARED_ROOT = path.join(ROOT, "_shared", "animeworkbench");

const SCRIPT_PATHS = [
  "art-director/.claude/skills/asset-gen/scripts",
  "art-director/.claude/skills/image-create/scripts",
  "art-director/.claude/skills/image-edit/scripts",
  "art-director/.claude/skills/kling-video-prompt/scripts",
  "video-producer/.claude/skills/video-create/scripts",
  "video-producer/.claude/skills/video-review/scripts",
] as const;

async function read(relativePath: string): Promise<string> {
  return fs.readFile(path.join(ROOT, relativePath), "utf-8");
}

describe("shared animeworkbench auth scripts", () => {
  it("keeps one shared implementation for auth and login", async () => {
    await expect(
      fs.stat(path.join(SHARED_ROOT, "auth_shared.py")),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(SHARED_ROOT, "login_shared.py")),
    ).resolves.toBeDefined();
  });

  it("keeps every skill entrypoint as a thin wrapper", async () => {
    for (const scriptDir of SCRIPT_PATHS) {
      const authWrapper = await read(`${scriptDir}/auth.py`);
      expect(authWrapper).toContain("from auth_shared import *");
      expect(authWrapper).not.toContain("urllib.request");

      const loginWrapper = await read(`${scriptDir}/login.py`);
      expect(loginWrapper).toContain("from login_shared import *");
      expect(loginWrapper).not.toContain("urllib.request");
    }
  });
});
