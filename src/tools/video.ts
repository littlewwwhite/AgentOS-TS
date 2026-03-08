// input: Image paths, motion prompts, shot config
// output: Generated video paths and status
// pos: Stage3 video generation tools (stub)

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

export const generateVideo = tool(
  "generate_video",
  "Generate a video clip from image and prompt",
  { image_path: z.string(), prompt: z.string(), duration: z.number() },
  async ({ prompt, duration }) => {
    const d = duration ?? 5.0;
    return {
      content: [
        { type: "text" as const, text: `Video generation started for: ${prompt} duration=${d}s (stub)` },
      ],
    };
  },
);

export const checkVideoStatus = tool(
  "check_video_status",
  "Check the status of a video generation job",
  { job_id: z.string() },
  async ({ job_id }) => {
    return {
      content: [{ type: "text" as const, text: `Job ${job_id}: completed (stub)` }],
    };
  },
);
