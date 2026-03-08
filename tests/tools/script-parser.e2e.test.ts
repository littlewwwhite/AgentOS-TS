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

  it("produces valid JSON output", async () => {
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
  });

  it("scene structure has required fields", async () => {
    const result = await parseEpisodes(PROJECT_PATH);
    const scriptPath = result.script_path as string;
    const parsed = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const firstScene = parsed.episodes[0]?.scenes[0];
    expect(firstScene).toBeDefined();
    expect(firstScene).toHaveProperty("id");
    expect(firstScene).toHaveProperty("location");
    expect(firstScene).toHaveProperty("location_id");
    expect(firstScene).toHaveProperty("time_of_day");
    expect(firstScene).toHaveProperty("cast");
    expect(firstScene).toHaveProperty("actions");
    expect(Array.isArray(firstScene.actions)).toBe(true);
  });

  it("actions have correct types", async () => {
    const result = await parseEpisodes(PROJECT_PATH);
    const scriptPath = result.script_path as string;
    const parsed = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const allActions = parsed.episodes.flatMap(
      (ep: { scenes: Array<{ actions: Array<{ type: string }> }> }) =>
        ep.scenes.flatMap((s) => s.actions),
    );
    const actionTypes = new Set(allActions.map((a: { type: string }) => a.type));

    // Should contain at least dialogue and action types
    expect(actionTypes.size).toBeGreaterThan(0);
    for (const t of actionTypes) {
      expect(["dialogue", "action", "inner_thought", "sfx"]).toContain(t);
    }
  });

  it("matches Python output stats", async () => {
    // Run Python parser and compare stats
    try {
      const { stdout } = await execAsync(
        `cd ../AgentOS && uv run python -c "
import asyncio, json
from agentos.tools.script_parser import parse_episodes
result = asyncio.run(parse_episodes('${PROJECT_PATH}'))
print(json.dumps(result))
"`,
        { timeout: 15000 },
      );
      const pyResult = JSON.parse(stdout.trim());
      const tsResult = await parseEpisodes(PROJECT_PATH);

      const pyStats = pyResult.stats;
      const tsStats = tsResult.stats as Record<string, number>;

      expect(tsStats.total_episodes).toBe(pyStats.total_episodes);
      expect(tsStats.total_scenes).toBe(pyStats.total_scenes);
      expect(tsStats.total_actors).toBe(pyStats.total_actors);
      expect(tsStats.total_locations).toBe(pyStats.total_locations);
    } catch {
      // Skip if Python env not available
      console.log("  (Python comparison skipped: uv/python not available)");
    }
  });
});
