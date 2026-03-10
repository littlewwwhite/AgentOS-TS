import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeTemplateInputFingerprint,
  decideTemplateBuildOnStart,
  readTemplateBuildState,
  writeTemplateBuildState,
} from "../src/e2b-template-state.js";

async function createTemplateFixture(rootDir: string): Promise<void> {
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "agents", "screenwriter", ".claude", "skills"), {
    recursive: true,
  });
  await fs.mkdir(path.join(rootDir, "e2b"), { recursive: true });

  await fs.writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "fixture", type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(rootDir, "tsconfig.json"), JSON.stringify({}));
  await fs.writeFile(path.join(rootDir, "src", "sandbox.ts"), "export const version = 'v1';\n");
  await fs.writeFile(
    path.join(rootDir, "agents", "screenwriter", ".claude", "skills", "style.md"),
    "# Style\n",
  );
  await fs.writeFile(path.join(rootDir, "e2b", "build.ts"), "export {};\n");
}

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "e2b-template-state-"));
  tempRoots.push(root);
  await createTemplateFixture(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("e2b template state", () => {
  it("requests a build for a fresh sandbox when no saved template state exists", async () => {
    const root = await createTempRoot();
    const currentFingerprint = await computeTemplateInputFingerprint(root);

    expect(
      decideTemplateBuildOnStart({
        connectSandboxId: null,
        currentFingerprint,
        savedFingerprint: null,
      }),
    ).toEqual({
      shouldBuild: true,
      reason: "missing_state",
    });
  });

  it("skips auto-build when reconnecting to an existing sandbox", async () => {
    const root = await createTempRoot();
    const currentFingerprint = await computeTemplateInputFingerprint(root);

    expect(
      decideTemplateBuildOnStart({
        connectSandboxId: "sbx-existing",
        currentFingerprint,
        savedFingerprint: "stale-fingerprint",
      }),
    ).toEqual({
      shouldBuild: false,
      reason: "reconnect",
    });
  });

  it("requests a rebuild when template inputs changed after the last successful build", async () => {
    const root = await createTempRoot();
    const firstFingerprint = await computeTemplateInputFingerprint(root);

    await writeTemplateBuildState(root, {
      templateId: "agentos-sandbox",
      fingerprint: firstFingerprint,
      builtAt: "2026-03-10T00:00:00.000Z",
    });

    await fs.writeFile(path.join(root, "src", "sandbox.ts"), "export const version = 'v2';\n");
    const currentFingerprint = await computeTemplateInputFingerprint(root);

    expect(
      decideTemplateBuildOnStart({
        connectSandboxId: null,
        currentFingerprint,
        savedFingerprint: firstFingerprint,
      }),
    ).toEqual({
      shouldBuild: true,
      reason: "fingerprint_mismatch",
    });
  });

  it("persists and reloads template build state from disk", async () => {
    const root = await createTempRoot();

    await writeTemplateBuildState(root, {
      templateId: "agentos-sandbox",
      fingerprint: "abc123",
      builtAt: "2026-03-10T00:00:00.000Z",
    });

    await expect(readTemplateBuildState(root)).resolves.toEqual({
      version: 1,
      templateId: "agentos-sandbox",
      fingerprint: "abc123",
      builtAt: "2026-03-10T00:00:00.000Z",
    });
  });
});
