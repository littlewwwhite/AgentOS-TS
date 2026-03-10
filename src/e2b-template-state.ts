import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const TEMPLATE_STATE_VERSION = 1;
const TEMPLATE_STATE_FILE = path.join(".e2b", "template-state.json");
const TEMPLATE_INPUT_FILES = ["package.json", "tsconfig.json", "e2b/build.ts"];
const TEMPLATE_INPUT_DIRS = ["src", "skills", "agents"];

export interface TemplateBuildState {
  version: number;
  templateId: string;
  fingerprint: string;
  builtAt: string;
}

export interface TemplateBuildDecisionInput {
  connectSandboxId: string | null;
  currentFingerprint: string;
  savedFingerprint: string | null;
}

export interface TemplateBuildDecision {
  shouldBuild: boolean;
  reason: "reconnect" | "missing_state" | "fingerprint_mismatch" | "up_to_date";
}

export async function computeTemplateInputFingerprint(rootDir: string): Promise<string> {
  const inputFiles = await collectTemplateInputFiles(rootDir);
  const hash = createHash("sha256");

  for (const relativePath of inputFiles) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(rootDir, relativePath)));
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function decideTemplateBuildOnStart(
  input: TemplateBuildDecisionInput,
): TemplateBuildDecision {
  if (input.connectSandboxId) {
    return {
      shouldBuild: false,
      reason: "reconnect",
    };
  }

  if (!input.savedFingerprint) {
    return {
      shouldBuild: true,
      reason: "missing_state",
    };
  }

  if (input.savedFingerprint !== input.currentFingerprint) {
    return {
      shouldBuild: true,
      reason: "fingerprint_mismatch",
    };
  }

  return {
    shouldBuild: false,
    reason: "up_to_date",
  };
}

export async function readTemplateBuildState(rootDir: string): Promise<TemplateBuildState | null> {
  try {
    const raw = await fs.readFile(getTemplateStatePath(rootDir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<TemplateBuildState>;
    if (
      parsed.version !== TEMPLATE_STATE_VERSION ||
      typeof parsed.templateId !== "string" ||
      typeof parsed.fingerprint !== "string" ||
      typeof parsed.builtAt !== "string"
    ) {
      return null;
    }
    return parsed as TemplateBuildState;
  } catch {
    return null;
  }
}

export async function writeTemplateBuildState(
  rootDir: string,
  state: Omit<TemplateBuildState, "version">,
): Promise<void> {
  const filePath = getTemplateStatePath(rootDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        version: TEMPLATE_STATE_VERSION,
        ...state,
      },
      null,
      2,
    ) + "\n",
  );
}

function getTemplateStatePath(rootDir: string): string {
  return path.join(rootDir, TEMPLATE_STATE_FILE);
}

async function collectTemplateInputFiles(rootDir: string): Promise<string[]> {
  const files = new Set<string>();

  for (const relativePath of TEMPLATE_INPUT_FILES) {
    const absolutePath = path.join(rootDir, relativePath);
    if (await pathExists(absolutePath)) {
      files.add(relativePath);
    }
  }

  for (const relativeDir of TEMPLATE_INPUT_DIRS) {
    await walkTemplateInputs(rootDir, relativeDir, files);
  }

  return [...files].sort();
}

async function walkTemplateInputs(
  rootDir: string,
  relativeDir: string,
  files: Set<string>,
): Promise<void> {
  const absoluteDir = path.join(rootDir, relativeDir);
  let entries: Dirent[];

  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const nextRelativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      await walkTemplateInputs(rootDir, nextRelativePath, files);
      continue;
    }
    if (entry.isFile()) {
      files.add(nextRelativePath);
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
