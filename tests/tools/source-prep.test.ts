import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareSourceProjectFile } from "../../src/tools/source.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  }
});

describe("prepareSourceProjectFile", () => {
  it("copies a workspace-root source file into a named project directory", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-prep-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    const sourcePath = path.join(workspaceDir, "c7.txt");
    await fs.writeFile(sourcePath, "novel content", "utf-8");

    const result = await prepareSourceProjectFile(sourcePath);

    expect(result.projectPath).toBe(path.join(workspaceDir, "c7"));
    expect(result.sourceTextPath).toBe(path.join(workspaceDir, "c7", "source.txt"));
    await expect(fs.readFile(result.sourceTextPath, "utf-8")).resolves.toBe("novel content");
  });

  it("copies a workspace/data source file into a sibling named project directory", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-prep-"));
    const dataDir = path.join(tmpDir, "workspace", "data");
    await fs.mkdir(dataDir, { recursive: true });

    const sourcePath = path.join(dataDir, "测3.txt");
    await fs.writeFile(sourcePath, "xianxia", "utf-8");

    const result = await prepareSourceProjectFile(sourcePath);

    expect(result.projectPath).toBe(path.join(tmpDir, "workspace", "测3"));
    expect(result.sourceTextPath).toBe(path.join(tmpDir, "workspace", "测3", "source.txt"));
    await expect(fs.readFile(result.sourceTextPath, "utf-8")).resolves.toBe("xianxia");
  });
});
