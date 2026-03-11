// input: Agent tool calls via MCP protocol
// output: Task lifecycle operations (submit, check, cancel, download)
// pos: Interface layer — exposes task queue as MCP tools for agent consumption

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

import type { TaskQueue } from "./queue.js";

/**
 * Create MCP tools bound to a TaskQueue instance.
 * Called via factory to ensure each SDK session gets fresh tool instances.
 */
export function createTaskTools(queue: TaskQueue) {
  const submitTask = tool(
    "submit_task",
    "Submit an async task (image/video generation) to the task queue. Returns a task ID for tracking. " +
      "The task runs in the background — use check_tasks to monitor progress.",
    {
      type: z.string().describe("Task type matching an API config name (e.g. 'animeworkbench-image', 'animeworkbench-video')"),
      provider: z.string().describe("Provider identifier (e.g. 'animeworkbench')"),
      params: z.record(z.unknown()).describe("API-specific parameters (modelCode, taskPrompt, promptParams, etc.)"),
      max_attempts: z.number().optional().describe("Max retry attempts (default: 3)"),
      phase_id: z.string().optional().describe("Optional phase ID for project engine integration"),
    },
    async ({ type, provider, params, max_attempts, phase_id }) => {
      try {
        const task = await queue.submit({
          type,
          provider,
          params,
          maxAttempts: max_attempts,
          phaseId: phase_id,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                task_id: task.id,
                status: task.status,
                message: `Task submitted successfully. Use check_tasks to monitor progress.`,
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

  const checkTasks = tool(
    "check_tasks",
    "Check the status of one or more async tasks. Returns current status, progress, and results for completed tasks.",
    {
      task_ids: z.array(z.string()).describe("Array of task IDs to check"),
    },
    async ({ task_ids }) => {
      const tasks = queue.getStatus(task_ids);
      const results = tasks.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        attempt: t.attempt,
        max_attempts: t.maxAttempts,
        result: t.result,
        error: t.error,
        created_at: new Date(t.createdAt).toISOString(),
        updated_at: new Date(t.updatedAt).toISOString(),
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results) }],
      };
    },
  );

  const cancelTask = tool(
    "cancel_task",
    "Cancel a pending or in-progress task. Cannot cancel completed or failed tasks.",
    {
      task_id: z.string().describe("The task ID to cancel"),
    },
    async ({ task_id }) => {
      const ok = queue.cancel(task_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              task_id,
              cancelled: ok,
              message: ok
                ? "Task cancelled successfully."
                : "Cannot cancel task (not found or already completed/failed).",
            }),
          },
        ],
      };
    },
  );

  const downloadResult = tool(
    "download_result",
    "Download result artifacts from a completed task to a local directory.",
    {
      task_id: z.string().describe("The completed task ID"),
      dest_path: z.string().describe("Local directory path to save downloaded files"),
    },
    async ({ task_id, dest_path }) => {
      try {
        const files = await queue.downloadResult(task_id, dest_path);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                task_id,
                downloaded_files: files,
                message: `Downloaded ${files.length} file(s) to ${dest_path}`,
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

  return [submitTask, checkTasks, cancelTask, downloadResult];
}
