// E2E validation: parse real episode files and compare Python vs TypeScript output
import { parseEpisodes } from "../../src/tools/script-parser.js";
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const PROJECT_PATH = path.resolve("../AgentOS/workspace/01-script-test");

// Skip if real workspace doesn't exist
const hasWorkspace = await fs.access(PROJECT_PATH).then(() => true).catch(() => false);

describe.skipIf(!hasWorkspace)("script-parser E2E", () => {
  it("parses real episodes without errors", async () => {
    const result = await parseEpisodes(PROJECT_PATH);
    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("script_path");
    expect(result).toHaveProperty("stats");

    const stats = result.stats as Record<string, number>;
    expect(stats.total_episodes).toBeGreaterThan(0);
    expect(stats.total_scenes).toBeGreaterThan(0);
    expect(stats.total_actors).toBeGreaterThan(0);
    expect(stats.total_locations).toBeGreaterThan(0);
  });

  it("produces valid JSON output with new structure", async () => {
    const result = await parseEpisodes(PROJECT_PATH);
    const scriptPath = result.script_path as string;
    const raw = await fs.readFile(scriptPath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty("title");
    expect(parsed).toHaveProperty("actors");
    expect(parsed).toHaveProperty("locations");
    expect(parsed).toHaveProperty("episodes");
    expect(Array.isArray(parsed.actors)).toBe(true);
    expect(Array.isArray(parsed.episodes)).toBe(true);

    // Verify new naming convention
    if (parsed.actors.length > 0) {
      expect(parsed.actors[0]).toHaveProperty("actor_id");
      expect(parsed.actors[0]).toHaveProperty("actor_name");
    }
    if (parsed.episodes.length > 0) {
      expect(parsed.episodes[0]).toHaveProperty("episode_id");
    }
  });

  it("scene structure has required fields", async () => {
    const result = await parseEpisodes(PROJECT_PATH);
    const scriptPath = result.script_path as string;
    const parsed = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const firstScene = parsed.episodes[0]?.scenes[0];
    expect(firstScene).toBeDefined();
    expect(firstScene).toHaveProperty("scene_id");
    expect(firstScene).toHaveProperty("environment");
    expect(firstScene.environment).toHaveProperty("space");
    expect(firstScene.environment).toHaveProperty("time");
    expect(firstScene).toHaveProperty("locations");
    expect(firstScene).toHaveProperty("actors");
    expect(firstScene).toHaveProperty("actions");
    expect(Array.isArray(firstScene.actions)).toBe(true);

    // Scene ID should have episode prefix
    expect(firstScene.scene_id).toMatch(/^ep\d+_scn_\d+$/);
  });

  it("actions have correct types and no sequence field", async () => {
    const result = await parseEpisodes(PROJECT_PATH);
    const scriptPath = result.script_path as string;
    const parsed = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const allActions = parsed.episodes.flatMap(
      (ep: { scenes: Array<{ actions: Array<{ type: string }> }> }) =>
        ep.scenes.flatMap((s) => s.actions),
    );
    const actionTypes = new Set(allActions.map((a: { type: string }) => a.type));

    expect(actionTypes.size).toBeGreaterThan(0);
    for (const t of actionTypes) {
      expect(["dialogue", "action", "inner_thought", "sfx"]).toContain(t);
    }

    // No sequence field
    for (const a of allActions) {
      expect(a).not.toHaveProperty("sequence");
    }
  });
});
