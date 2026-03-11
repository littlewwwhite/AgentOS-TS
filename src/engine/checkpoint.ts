// input: Agent tool calls (create/resolve/list checkpoints); EngineStore + ProjectScheduler
// output: MCP tool definitions for checkpoint lifecycle management
// pos: Interface layer — exposes checkpoint operations as MCP tools for agents and external callers

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

import type { EngineStore } from "./store.js";
import type { ProjectScheduler } from "./scheduler.js";
import type { CheckpointType } from "./schema.js";

/**
 * Create MCP tools bound to an EngineStore + ProjectScheduler.
 * Follows the same factory pattern as createTaskTools in task-queue/tools.ts.
 */
export function createCheckpointTools(
  store: EngineStore,
  scheduler: ProjectScheduler,
) {
  const createCheckpoint = tool(
    "create_checkpoint",
    "Create a review checkpoint that pauses the current phase and requests human review. " +
      "Use this when you need approval, feedback, or quality validation before proceeding.",
    {
      phase_id: z.string().describe("The phase ID this checkpoint belongs to"),
      type: z
        .enum(["review", "approval", "quality_gate", "milestone"])
        .describe("Checkpoint type: review (feedback), approval (sign-off), quality_gate (criteria check), milestone (progress marker)"),
      description: z
        .string()
        .describe("What is being reviewed and why human input is needed"),
      artifacts: z
        .array(z.string())
        .optional()
        .describe("File paths of artifacts to review (e.g. draft scripts, images)"),
    },
    async ({ phase_id, type, description, artifacts }) => {
      try {
        const checkpoint = store.createCheckpoint({
          phaseId: phase_id,
          type: type as CheckpointType,
          description,
          artifacts: artifacts ?? [],
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                checkpoint_id: checkpoint.id,
                status: checkpoint.status,
                message: "Checkpoint created. Awaiting human review.",
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    },
  );

  const resolveCheckpoint = tool(
    "resolve_checkpoint",
    "Resolve a pending checkpoint with an approval decision. " +
      "'approved' allows the phase to continue; 'revised' sends feedback to the agent; 'rejected' fails the phase.",
    {
      checkpoint_id: z.string().describe("The checkpoint ID to resolve"),
      decision: z
        .enum(["approved", "revised", "rejected"])
        .describe("Resolution decision"),
      feedback: z
        .string()
        .optional()
        .describe("Reviewer feedback — required when decision is 'revised', optional otherwise"),
    },
    async ({ checkpoint_id, decision, feedback }) => {
      try {
        const checkpoint = store.getCheckpoint(checkpoint_id);
        if (!checkpoint) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `Checkpoint not found: ${checkpoint_id}` }),
              },
            ],
          };
        }

        scheduler.onCheckpointResolved(checkpoint_id, decision, feedback);

        const updated = store.getCheckpoint(checkpoint_id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                checkpoint_id,
                decision,
                status: updated?.status,
                message: `Checkpoint resolved: ${decision}.`,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    },
  );

  const listCheckpoints = tool(
    "list_checkpoints",
    "List checkpoints filtered by project or phase. Omit both to list all checkpoints.",
    {
      project_id: z
        .string()
        .optional()
        .describe("Filter by project ID (returns pending checkpoints across all phases)"),
      phase_id: z
        .string()
        .optional()
        .describe("Filter by phase ID (returns all checkpoints for that phase)"),
    },
    async ({ project_id, phase_id }) => {
      let checkpoints;

      if (phase_id) {
        checkpoints = store.listCheckpointsByPhase(phase_id);
      } else if (project_id) {
        checkpoints = store.getPendingCheckpoints(project_id);
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Provide at least one of: project_id, phase_id" }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              checkpoints.map((c) => ({
                id: c.id,
                phase_id: c.phaseId,
                type: c.type,
                status: c.status,
                description: c.description,
                artifacts: c.artifacts,
                feedback: c.feedback,
                resolution: c.resolution,
                revision_count: c.revisionCount,
                created_at: new Date(c.createdAt).toISOString(),
                updated_at: new Date(c.updatedAt).toISOString(),
              })),
            ),
          },
        ],
      };
    },
  );

  return [createCheckpoint, resolveCheckpoint, listCheckpoints];
}
