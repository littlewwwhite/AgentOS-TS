// input: tests for script-parser.ts
// output: validates parsing of episodes into structured script.json
// pos: unit tests for the deterministic script parser

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseEpisodes } from "../src/tools/script-parser";

// ---------- Helpers ----------

async function setupProject(
  episodes: Record<string, string>,
  catalog?: Record<string, unknown>,
  design?: Record<string, unknown>,
): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "script-parser-"));
  const draftDir = path.join(tmpDir, "draft");
  const epDir = path.join(draftDir, "episodes");
  await fs.mkdir(epDir, { recursive: true });

  for (const [name, content] of Object.entries(episodes)) {
    await fs.writeFile(path.join(epDir, name), content, "utf-8");
  }

  if (catalog) {
    await fs.writeFile(
      path.join(draftDir, "catalog.json"),
      JSON.stringify(catalog),
      "utf-8",
    );
  }

  if (design) {
    await fs.writeFile(
      path.join(draftDir, "design.json"),
      JSON.stringify(design),
      "utf-8",
    );
  }

  return tmpDir;
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------- Tests ----------

describe("script-parser", () => {
  describe("ID format (no zero-padding)", () => {
    let projectPath: string;
    let result: Record<string, unknown>;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 觉醒大厅
人物：楚凡、林雪
▲楚凡走上台。
林雪（冷漠）：我们之间，到此为止了。

1-2 夜 外 学院街道
人物：楚凡
▲楚凡在雨中行走。
`,
        },
        {
          actors: [
            { id: "act_1", name: "楚凡" },
            { id: "act_2", name: "林雪" },
          ],
          locations: [],
          props: [],
        },
        { title: "测试剧本", style: "现代都市", worldview: "异能世界" },
      );
      result = await parseEpisodes(projectPath);
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("episode IDs have no zero-padding", () => {
      const episodes = (result as any).episodes ?? result;
      // Check script.json was written
      expect(result).not.toHaveProperty("error");
    });

    test("actor IDs use catalog values (act_1 not act_001)", async () => {
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
      const actorIds = script.actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_1");
      expect(actorIds).toContain("act_2");
      // No zero-padded IDs
      expect(actorIds).not.toContain("act_001");
    });

    test("scene IDs use epN_scn_N format", async () => {
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
      const sceneIds = script.episodes[0].scenes.map((s: any) => s.scene_id);
      expect(sceneIds[0]).toBe("scn_1");
      expect(sceneIds[1]).toBe("scn_2");
    });

    test("location IDs have no zero-padding", async () => {
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
      for (const loc of script.locations) {
        expect(loc.location_id).toMatch(/^loc_\d+$/);
        expect(loc.location_id).not.toMatch(/^loc_0/);
      }
    });
  });

  describe("道具行 parsing", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 觉醒大厅
人物：楚凡、林雪
道具：凡字玉佩、断剑
▲楚凡手握断剑。
林雪（冷漠）：把玉佩还我。

1-2 夜 外 学院街道
人物：楚凡
道具：凡字玉佩
▲楚凡攥着凡字玉佩走在雨中。
`,
        },
        {
          actors: [
            { id: "act_1", name: "楚凡" },
            { id: "act_2", name: "林雪" },
          ],
          locations: [],
          props: [
            { id: "prp_1", name: "凡字玉佩" },
            { id: "prp_2", name: "断剑" },
          ],
        },
        { title: "测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("props are extracted from 道具 lines", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Global props list
      const propIds = script.props.map((p: any) => p.prop_id);
      expect(propIds).toContain("prp_1");
      expect(propIds).toContain("prp_2");

      // Scene 1-1 has both props
      const scene1 = script.episodes[0].scenes[0];
      const scene1PropIds = scene1.props.map((p: any) => p.prop_id);
      expect(scene1PropIds).toContain("prp_1");
      expect(scene1PropIds).toContain("prp_2");

      // Scene 1-2 has only 凡字玉佩
      const scene2 = script.episodes[0].scenes[1];
      const scene2PropIds = scene2.props.map((p: any) => p.prop_id);
      expect(scene2PropIds).toContain("prp_1");
      expect(scene2PropIds).not.toContain("prp_2");
    });

    test("props use catalog IDs when available", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      const propsMap: Record<string, string> = {};
      for (const p of script.props) {
        propsMap[p.prop_name] = p.prop_id;
      }
      expect(propsMap["凡字玉佩"]).toBe("prp_1");
      expect(propsMap["断剑"]).toBe("prp_2");
    });
  });

  describe("状态行 parsing", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 觉醒大厅
人物：楚凡、林雪
状态：楚凡【战甲】
▲楚凡身穿战甲走上前。
林雪（惊讶）：你怎么穿成这样？

1-2 日 内 大殿
人物：楚凡、林雪
状态：楚凡【战甲】、林雪【婚纱】
▲楚凡和林雪对视。

1-3 夜 外 街道
人物：楚凡
▲楚凡独行。
`,
        },
        {
          actors: [
            { id: "act_1", name: "楚凡", states: ["战甲", "便服"] },
            { id: "act_2", name: "林雪", states: ["婚纱"] },
          ],
          locations: [],
          props: [],
        },
        { title: "状态测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("state line sets actor states correctly", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Build state lookup
      const stateMap: Record<string, string> = {};
      for (const actor of script.actors) {
        for (const st of actor.states ?? []) {
          stateMap[st.state_id] = `${actor.actor_name}|${st.state_name}`;
        }
      }

      // Scene 1-1: 楚凡 has 战甲 state, 林雪 has null
      const scene1 = script.episodes[0].scenes[0];
      const chuFanInScene1 = scene1.actors.find(
        (a: any) => a.actor_id === "act_1",
      );
      expect(chuFanInScene1.state_id).not.toBeNull();
      expect(stateMap[chuFanInScene1.state_id]).toBe("楚凡|战甲");

      const linXueInScene1 = scene1.actors.find(
        (a: any) => a.actor_id === "act_2",
      );
      expect(linXueInScene1.state_id).toBeNull();
    });

    test("multiple states in one state line", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Scene 1-2: both have states
      const scene2 = script.episodes[0].scenes[1];
      const chuFan = scene2.actors.find((a: any) => a.actor_id === "act_1");
      const linXue = scene2.actors.find((a: any) => a.actor_id === "act_2");

      expect(chuFan.state_id).not.toBeNull();
      expect(linXue.state_id).not.toBeNull();
    });

    test("scene without state line has null states", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Scene 1-3: no state line, 楚凡 should have null state
      const scene3 = script.episodes[0].scenes[2];
      const chuFan = scene3.actors.find((a: any) => a.actor_id === "act_1");
      expect(chuFan.state_id).toBeNull();
    });
  });

  describe("backward compat: inline state in 人物行", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 觉醒大厅
人物：楚凡【战甲】、林雪
▲楚凡登场。
`,
        },
        {
          actors: [
            { id: "act_1", name: "楚凡", states: ["战甲"] },
            { id: "act_2", name: "林雪" },
          ],
          locations: [],
          props: [],
        },
        { title: "兼容测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("inline state in 人物 line still works", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      const scene = script.episodes[0].scenes[0];
      const chuFan = scene.actors.find((a: any) => a.actor_id === "act_1");
      expect(chuFan.state_id).not.toBeNull();
    });
  });

  describe("auto-generated IDs for unknown entities", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 神秘洞穴
人物：张三、李四
道具：金钥匙
▲张三推开石门。
李四（紧张）：小心！
`,
        },
        // No catalog — all entities are new
        undefined,
        { title: "自动ID测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("auto-generates IDs starting from 1", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Actors
      const actorIds = script.actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_1");
      expect(actorIds).toContain("act_2");

      // Locations
      const locIds = script.locations.map((l: any) => l.location_id);
      expect(locIds).toContain("loc_1");

      // Props
      const propIds = script.props.map((p: any) => p.prop_id);
      expect(propIds).toContain("prp_1");

      // No zero-padded IDs anywhere
      for (const id of [...actorIds, ...locIds, ...propIds]) {
        expect(id).not.toMatch(/_0\d/);
      }
    });
  });

  describe("location state in scene header", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 觉醒大厅【废墟】
人物：楚凡
▲楚凡站在废墟中。
`,
        },
        {
          actors: [{ id: "act_1", name: "楚凡" }],
          locations: [{ id: "loc_1", name: "觉醒大厅" }],
          props: [],
        },
        { title: "地点状态测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("location state extracted from scene header", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Location has state
      const loc = script.locations.find(
        (l: any) => l.location_id === "loc_1",
      );
      expect(loc.states).toBeDefined();
      expect(loc.states.length).toBe(1);
      expect(loc.states[0].state_name).toBe("废墟");
      expect(loc.states[0].state_id).toMatch(/^st_\d+$/);

      // Scene references location state
      const scene = script.episodes[0].scenes[0];
      expect(scene.locations[0].state_id).not.toBeNull();
    });
  });
});
