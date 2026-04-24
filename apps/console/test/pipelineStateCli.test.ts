import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("pipeline_state.py", () => {
  test("creates and updates minimal state deterministically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentos-state-"));
    const statePath = join(dir, "pipeline-state.json");

    const proc = Bun.spawn([
      "python3",
      "../../../scripts/pipeline_state.py",
      "stage",
      "--project-dir",
      dir,
      "--stage",
      "SCRIPT",
      "--status",
      "running",
      "--next-action",
      "review SCRIPT",
    ], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    expect(stderr).toBe("");

    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      current_stage: string;
      next_action: string;
      stages: Record<string, { status: string }>;
    };

    expect(state.current_stage).toBe("SCRIPT");
    expect(state.next_action).toBe("review SCRIPT");
    expect(state.stages.SCRIPT.status).toBe("running");
  });
});
