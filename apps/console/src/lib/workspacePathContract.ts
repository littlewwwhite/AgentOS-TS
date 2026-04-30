// input: workspace-relative artifact paths from UI, pipeline state, and SDK tools
// output: normalized path checks and human-readable path contract diagnostics
// pos: shared guardrail that keeps generated artifacts renderable under workspace/<project>

const ALLOWED_TOP_LEVEL_FILES = new Set(["README.md", "source.txt", "pipeline-state.json"]);
const ALLOWED_TOP_LEVEL_DIRS = new Set(["input", "draft", "output", ".logs"]);

export interface WorkspacePathViolation {
  path: string;
  reason: string;
}

export function normalizeWorkspaceRelPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("\0")) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

export function isExpectedWorkspaceArtifactPath(path: string): boolean {
  const relPath = normalizeWorkspaceRelPath(path);
  if (!relPath) return false;
  if (ALLOWED_TOP_LEVEL_FILES.has(relPath)) return true;
  const topLevel = relPath.split("/")[0];
  return ALLOWED_TOP_LEVEL_DIRS.has(topLevel);
}

function isAbsoluteFsPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizeFsPath(path: string): string {
  const unixPath = path.replace(/\\/g, "/");
  const driveMatch = unixPath.match(/^[A-Za-z]:/);
  const prefix = driveMatch ? driveMatch[0] : unixPath.startsWith("/") ? "/" : "";
  const withoutPrefix = driveMatch ? unixPath.slice(2) : unixPath;
  const parts: string[] = [];

  for (const part of withoutPrefix.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `${prefix}${parts.join("/")}`;
}

export function projectRelativePath(projectRoot: string, cwd: string, filePath: string): string | null {
  const absPath = normalizeFsPath(isAbsoluteFsPath(filePath) ? filePath : `${cwd}/${filePath}`);
  const root = normalizeFsPath(projectRoot);
  if (absPath === root) return "";
  if (!absPath.startsWith(`${root}/`)) return null;
  return normalizeWorkspaceRelPath(absPath.slice(root.length + 1));
}

export function validateGeneratedWritePath(projectRoot: string, cwd: string, filePath: string): WorkspacePathViolation | null {
  const relPath = projectRelativePath(projectRoot, cwd, filePath);
  if (!relPath) {
    return { path: filePath, reason: "path escapes the active project workspace" };
  }
  if (!isExpectedWorkspaceArtifactPath(relPath)) {
    return {
      path: relPath,
      reason: "generated artifacts must live in source.txt, pipeline-state.json, input/, draft/, output/, or .logs/",
    };
  }
  return null;
}

export function collectWorkspacePathViolations(paths: string[]): WorkspacePathViolation[] {
  const seen = new Set<string>();
  const violations: WorkspacePathViolation[] = [];

  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!normalizeWorkspaceRelPath(path)) {
      violations.push({ path, reason: "not a valid workspace-relative path" });
      continue;
    }
    if (!isExpectedWorkspaceArtifactPath(path)) {
      violations.push({ path, reason: "outside the expected project artifact layout" });
    }
  }

  return violations;
}

export function workspacePathContractText(): string {
  return [
    "Workspace path contract:",
    "- Renderable project paths are always relative to workspace/<project>.",
    "- Source input: source.txt and input/.",
    "- Draft/intermediate planning: draft/.",
    "- Generated deliverables and review assets: output/.",
    "- Runtime control state: pipeline-state.json.",
    "- Logs/progress markers: .logs/.",
    "- Do not write generated project content to arbitrary top-level folders.",
  ].join("\n");
}
