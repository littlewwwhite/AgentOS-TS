import type { ArtifactState, PipelineState, StageState } from "../types";
import { buildSourceUploadTargets, sanitizeUploadFilename } from "./sourceUpload";
import { STAGE_ORDER, STAGE_OWNER } from "./workflowModel";

interface BuildProjectBootstrapInput {
  projectName: string;
  sourceFilename: string;
  sourceContentType?: string | null;
  now?: string;
}

interface BootstrapFilePlan {
  path: string;
  kind: "raw" | "canonical-source" | "control";
}

export interface ProjectBootstrapPlan {
  projectKey: string;
  files: BootstrapFilePlan[];
  sourceUpdated: boolean;
  initialState: PipelineState;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function sanitizeProjectKey(projectName: string): string {
  const safe = projectName
    .normalize("NFKC")
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();

  if (!safe) {
    throw new Error("project name is required");
  }
  return safe;
}

function buildStages(sourceUpdated: boolean, ts: string): Record<string, StageState> {
  const stages: Record<string, StageState> = {};
  for (const stageName of STAGE_ORDER) {
    stages[stageName] = {
      status: "not_started",
      artifacts: [],
      updated_at: null,
      notes: null,
      owner_role: STAGE_OWNER[stageName],
      locked: false,
      revision: 0,
    };
  }

  stages.SCRIPT = {
    status: sourceUpdated ? "in_review" : "not_started",
    artifacts: sourceUpdated ? ["source.txt"] : [],
    updated_at: sourceUpdated ? ts : null,
    owner_role: "writer",
    notes: sourceUpdated ? "source uploaded; review before continuing" : "source uploaded to input/; normalize into source.txt before writing",
    locked: false,
    revision: sourceUpdated ? 1 : 0,
  };

  return stages;
}

function buildArtifacts(sourceUpdated: boolean, ts: string): Record<string, ArtifactState> {
  if (!sourceUpdated) return {};
  return {
    "source.txt": {
      kind: "source",
      owner_role: "writer",
      status: "in_review",
      editable: true,
      revision: 1,
      depends_on: [],
      invalidates: [],
      updated_at: ts,
      notes: "canonical source input",
    },
  };
}

export function buildProjectBootstrap(input: BuildProjectBootstrapInput): ProjectBootstrapPlan {
  const ts = nowIso(input.now);
  const projectKey = sanitizeProjectKey(input.projectName);
  const safeFilename = sanitizeUploadFilename(input.sourceFilename);
  const targets = buildSourceUploadTargets(safeFilename, input.sourceContentType);
  const sourceUpdated = !!targets.sourcePath;
  const files: BootstrapFilePlan[] = [{ path: targets.rawPath, kind: "raw" }];

  if (targets.sourcePath) {
    files.push({ path: targets.sourcePath, kind: "canonical-source" });
  }

  files.push({ path: "pipeline-state.json", kind: "control" });

  return {
    projectKey,
    files,
    sourceUpdated,
    initialState: {
      version: 1,
      updated_at: ts,
      current_stage: "SCRIPT",
      next_action: sourceUpdated ? "review SCRIPT" : "prepare source SCRIPT",
      last_error: null,
      stages: buildStages(sourceUpdated, ts),
      episodes: {},
      artifacts: buildArtifacts(sourceUpdated, ts),
      change_requests: [],
    },
  };
}
