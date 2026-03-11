import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { E2B_BUILD_INPUTS, prepareE2BFileContext } from "../src/e2b-build-context.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "e2b-build-context-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("e2b build context", () => {
  it("copies only declared template inputs into a clean staging directory", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.mkdir(path.join(root, "skills", "asset-gen", "scripts"), { recursive: true });
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.mkdir(path.join(root, "e2b", "python-runtime"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, "dist", "sandbox.js"), "export {};\n");
    await fs.writeFile(path.join(root, "skills", "asset-gen", "SKILL.md"), "# skill\n");
    await fs.writeFile(path.join(root, "agents", "art-director.yaml"), "name: art-director\n");
    await fs.writeFile(path.join(root, "e2b", "python-runtime", "pyproject.toml"), "[project]\n");
    await fs.writeFile(path.join(root, "README.md"), "ignore me\n");

    const stagingDir = await prepareE2BFileContext(root);

    for (const entry of E2B_BUILD_INPUTS) {
      await expect(fs.stat(path.join(stagingDir, entry))).resolves.toBeDefined();
    }
    await expect(fs.stat(path.join(stagingDir, "README.md"))).rejects.toThrow();
  });

  it("removes Python cache directories from the staged copy", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.mkdir(path.join(root, "skills", "asset-gen", "scripts", "__pycache__"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.mkdir(path.join(root, "e2b", "python-runtime"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, "dist", "sandbox.js"), "export {};\n");
    await fs.writeFile(path.join(root, "skills", "asset-gen", "SKILL.md"), "# skill\n");
    await fs.writeFile(
      path.join(root, "skills", "asset-gen", "scripts", "__pycache__", "cached.pyc"),
      "compiled",
    );
    await fs.writeFile(path.join(root, "agents", "art-director.yaml"), "name: art-director\n");
    await fs.writeFile(path.join(root, "e2b", "python-runtime", "pyproject.toml"), "[project]\n");

    const stagingDir = await prepareE2BFileContext(root);

    await expect(
      fs.stat(path.join(stagingDir, "skills", "asset-gen", "scripts", "__pycache__")),
    ).rejects.toThrow();
  });

  it("skips VCS and Apple metadata files from the staged copy", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.mkdir(path.join(root, "skills"), { recursive: true });
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.mkdir(path.join(root, "e2b", "python-runtime"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, "dist", "sandbox.js"), "export {};\n");
    await fs.writeFile(path.join(root, "skills", ".git"), "gitdir: /tmp/skills/.git\n");
    await fs.writeFile(path.join(root, "skills", "._SKILL.md"), "apple-double");
    await fs.writeFile(path.join(root, "skills", "SKILL.md"), "# skill\n");
    await fs.writeFile(path.join(root, "agents", ".DS_Store"), "metadata");
    await fs.writeFile(path.join(root, "agents", "art-director.yaml"), "name: art-director\n");
    await fs.writeFile(path.join(root, "e2b", "python-runtime", "pyproject.toml"), "[project]\n");

    const stagingDir = await prepareE2BFileContext(root);

    await expect(fs.stat(path.join(stagingDir, "skills", ".git"))).rejects.toThrow();
    await expect(fs.stat(path.join(stagingDir, "skills", "._SKILL.md"))).rejects.toThrow();
    await expect(fs.stat(path.join(stagingDir, "agents", ".DS_Store"))).rejects.toThrow();
  });
});
