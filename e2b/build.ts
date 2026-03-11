// input: package.json, dist/, skills/, agents/
// output: E2B custom template "agentos-sandbox"
// pos: Programmatic template builder — replaces Dockerfile + build.sh

import path from "node:path";
import fs from "node:fs/promises";
import { Template, defaultBuildLogger } from "e2b";
import { prepareE2BFileContext } from "../src/e2b-build-context.js";
import { getPythonRuntimeBuildCommands } from "../src/e2b-python-runtime.js";
import {
  computeTemplateInputFingerprint,
  writeTemplateBuildState,
} from "../src/e2b-template-state.js";

const ROOT = path.resolve(import.meta.dir, "..");
const APP = "/home/user/app";
const [installUvCommand, installPythonRuntimeCommand] = getPythonRuntimeBuildCommands();

async function main() {
  const fingerprint = await computeTemplateInputFingerprint(ROOT);
  const stagingRoot = await prepareE2BFileContext(ROOT);
  const template = Template({ fileContextPath: stagingRoot })
    .fromBunImage("1.3")
    .makeDir(APP)
    .makeDir(`${APP}/e2b/python-runtime`)
    .copy("e2b/python-runtime/", `${APP}/e2b/python-runtime/`)
    // --- Python runtime (uv + locked venv) for skill scripts ---
    .runCmd(installUvCommand)
    .runCmd(installPythonRuntimeCommand)
    // --- Node/Bun app ---
    .copy("package.json", `${APP}/package.json`)
    .setWorkdir(APP)
    .runCmd("bun install") // Linux native binaries — no --frozen-lockfile!
    .copy("dist/", `${APP}/dist/`)
    .copy("skills/", `${APP}/skills/`)
    .copy("agents/", `${APP}/agents/`)
    .makeDir(`${APP}/workspace`);
  try {
    const info = await Template.build(template, "agentos-sandbox", {
      cpuCount: 2,
      memoryMB: 2048,
      onBuildLogs: defaultBuildLogger(),
    });
    await writeTemplateBuildState(ROOT, {
      templateId: info.templateId,
      fingerprint,
      builtAt: new Date().toISOString(),
    });
    console.log(`Template built: ${info.name} (${info.templateId})`);
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
