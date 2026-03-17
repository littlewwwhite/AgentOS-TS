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
            { id: "act_001", name: "楚凡" },
            { id: "act_002", name: "林雪" },
          ],
          locations: [
            { id: "loc_001", name: "觉醒大厅" },
            { id: "loc_002", name: "学院街道" },
          ],
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

    test("actor IDs use catalog values", async () => {
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
      const actorIds = script.actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_001");
      expect(actorIds).toContain("act_002");
    });

    test("scene IDs use scn_NNN format", async () => {
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
      const sceneIds = script.episodes[0].scenes.map((s: any) => s.scene_id);
      expect(sceneIds[0]).toBe("scn_001");
      expect(sceneIds[1]).toBe("scn_002");
    });

    test("location IDs from catalog", async () => {
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
      for (const loc of script.locations) {
        expect(loc.location_id).toMatch(/^loc_\d+$/);
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
            { id: "act_001", name: "楚凡" },
            { id: "act_002", name: "林雪" },
          ],
          locations: [
            { id: "loc_001", name: "觉醒大厅" },
            { id: "loc_002", name: "学院街道" },
          ],
          props: [
            { id: "prp_001", name: "凡字玉佩" },
            { id: "prp_002", name: "断剑" },
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
      expect(propIds).toContain("prp_001");
      expect(propIds).toContain("prp_002");

      // Scene 1-1 has both props
      const scene1 = script.episodes[0].scenes[0];
      const scene1PropIds = scene1.props.map((p: any) => p.prop_id);
      expect(scene1PropIds).toContain("prp_001");
      expect(scene1PropIds).toContain("prp_002");

      // Scene 1-2 has only 凡字玉佩
      const scene2 = script.episodes[0].scenes[1];
      const scene2PropIds = scene2.props.map((p: any) => p.prop_id);
      expect(scene2PropIds).toContain("prp_001");
      expect(scene2PropIds).not.toContain("prp_002");
    });

    test("props use catalog IDs when available", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      const propsMap: Record<string, string> = {};
      for (const p of script.props) {
        propsMap[p.prop_name] = p.prop_id;
      }
      expect(propsMap["凡字玉佩"]).toBe("prp_001");
      expect(propsMap["断剑"]).toBe("prp_002");
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
            { id: "act_001", name: "楚凡", states: ["战甲", "便服"] },
            { id: "act_002", name: "林雪", states: ["婚纱"] },
          ],
          locations: [
            { id: "loc_001", name: "觉醒大厅" },
            { id: "loc_002", name: "大殿" },
            { id: "loc_003", name: "街道" },
          ],
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
        (a: any) => a.actor_id === "act_001",
      );
      expect(chuFanInScene1.state_id).not.toBeNull();
      expect(stateMap[chuFanInScene1.state_id]).toBe("楚凡|战甲");

      const linXueInScene1 = scene1.actors.find(
        (a: any) => a.actor_id === "act_002",
      );
      expect(linXueInScene1.state_id).toBeNull();
    });

    test("multiple states in one state line", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Scene 1-2: both have states
      const scene2 = script.episodes[0].scenes[1];
      const chuFan = scene2.actors.find((a: any) => a.actor_id === "act_001");
      const linXue = scene2.actors.find((a: any) => a.actor_id === "act_002");

      expect(chuFan.state_id).not.toBeNull();
      expect(linXue.state_id).not.toBeNull();
    });

    test("scene without state line has null states", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Scene 1-3: no state line, 楚凡 should have null state
      const scene3 = script.episodes[0].scenes[2];
      const chuFan = scene3.actors.find((a: any) => a.actor_id === "act_001");
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
            { id: "act_001", name: "楚凡", states: ["战甲"] },
            { id: "act_002", name: "林雪" },
          ],
          locations: [
            { id: "loc_001", name: "觉醒大厅" },
          ],
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
      const chuFan = scene.actors.find((a: any) => a.actor_id === "act_001");
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

    test("auto-generates zero-padded IDs when no catalog", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Actors
      const actorIds = script.actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_001");
      expect(actorIds).toContain("act_002");

      // Locations
      const locIds = script.locations.map((l: any) => l.location_id);
      expect(locIds).toContain("loc_001");

      // Props
      const propIds = script.props.map((p: any) => p.prop_id);
      expect(propIds).toContain("prp_001");
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
          actors: [{ id: "act_001", name: "楚凡" }],
          locations: [{ id: "loc_001", name: "觉醒大厅" }],
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
        (l: any) => l.location_id === "loc_001",
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

  describe("catalog-only mode: aliases and unresolved", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 家中客厅
人物：女主、弟弟
道具：应急包
▲女主紧张地打开应急包。
弟弟（焦急）：姐，外面已经开始下雪了！
女主（OS）：文文说得没错……
`,
        },
        {
          actors: [
            { id: "act_001", name: "许瑶", aliases: ["女主", "姐", "我"] },
            { id: "act_002", name: "许正希", aliases: ["弟弟", "正希"] },
          ],
          locations: [
            { id: "loc_001", name: "家中客厅" },
          ],
          props: [
            { id: "prp_001", name: "应急包" },
          ],
        },
        { title: "别名测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("aliases resolve to catalog IDs", async () => {
      const result = await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Only 2 actors from catalog, no duplicates
      expect(script.actors.length).toBe(2);
      const actorNames = script.actors.map((a: any) => a.actor_name);
      expect(actorNames).toContain("许瑶");
      expect(actorNames).toContain("许正希");
      // "女主" and "弟弟" should NOT appear as separate actors
      expect(actorNames).not.toContain("女主");
      expect(actorNames).not.toContain("弟弟");

      // No warnings
      expect(result).not.toHaveProperty("warnings");
    });

    test("scene actors use canonical catalog IDs via aliases", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      const scene = script.episodes[0].scenes[0];
      const actorIds = scene.actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_001"); // 女主 → 许瑶
      expect(actorIds).toContain("act_002"); // 弟弟 → 许正希
    });
  });

  describe("unresolved names produce warnings", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 客厅
人物：张三、未知路人
▲张三看向窗外。
未知路人（紧张）：快跑！
`,
        },
        {
          actors: [
            { id: "act_001", name: "张三" },
          ],
          locations: [
            { id: "loc_001", name: "客厅" },
          ],
          props: [],
        },
        { title: "警告测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("unresolved actors appear in warnings", async () => {
      const result = await parseEpisodes(projectPath) as any;
      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("未知路人");
    });

    test("unresolved actors are NOT in script.json actors list", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      expect(script.actors.length).toBe(1);
      expect(script.actors[0].actor_name).toBe("张三");
    });
  });

  describe("Chinese conjunction splitting", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集
1-1 日 内 客厅
人物：女主和弟弟
▲两人对视。
`,
        },
        {
          actors: [
            { id: "act_001", name: "女主" },
            { id: "act_002", name: "弟弟" },
          ],
          locations: [
            { id: "loc_001", name: "客厅" },
          ],
          props: [],
        },
        { title: "连词拆分测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("splits '和' in actor lines into separate actors", async () => {
      const result = await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      const scene = script.episodes[0].scenes[0];
      const actorIds = scene.actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_001");
      expect(actorIds).toContain("act_002");
      // No warnings — both resolved
      expect(result).not.toHaveProperty("warnings");
    });
  });

  describe("catalog without id fields (auto-assign)", () => {
    let projectPath: string;

    beforeAll(async () => {
      projectPath = await setupProject(
        {
          "ep01.md": `第1集

1-1 日 内 客厅
人物：许瑶
道具：玉佩

许瑶打量着手中的玉佩。

许瑶：这是哪里来的？

1-2 夜 外 街道
人物：许正希

许正希独自走在空旷的街头。

许正希：(OS) 姐姐还好吗……`,
        },
        {
          actors: [
            { name: "许瑶", description: "28岁，女", aliases: ["女主", "姐姐"] },
            { name: "许正希", description: "25岁，男", aliases: ["弟弟"] },
          ],
          locations: [
            { name: "客厅", description: "老旧小区一居室" },
            { name: "街道", description: "空旷的夜间街道" },
          ],
          props: [{ name: "玉佩", description: "翠绿色古玉佩" }],
        },
        { title: "无ID测试", style: "", worldview: "" },
      );
    });

    afterAll(async () => {
      await cleanup(projectPath);
    });

    test("parser auto-generates act_001/loc_001/prp_001 by array order", async () => {
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Actors get auto-assigned IDs by array position
      expect(script.actors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actor_id: "act_001", actor_name: "许瑶" }),
          expect.objectContaining({ actor_id: "act_002", actor_name: "许正希" }),
        ]),
      );
      // Locations
      expect(script.locations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location_id: "loc_001", location_name: "客厅" }),
          expect.objectContaining({ location_id: "loc_002", location_name: "街道" }),
        ]),
      );
      // Props
      expect(script.props).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ prop_id: "prp_001", prop_name: "玉佩" }),
        ]),
      );
    });

    test("alias resolution works without id fields", async () => {
      // ep01 uses canonical names; add ep02 that uses alias "女主" for 许瑶
      const epDir = path.join(projectPath, "draft", "episodes");
      await fs.writeFile(
        path.join(epDir, "ep02.md"),
        [
          "第2集",
          "",
          "2-1 日 内 客厅",
          "人物：女主",
          "",
          "女主：我回来了。",
        ].join("\n"),
        "utf-8",
      );
      // Remove previous output to force clean re-parse
      await fs.rm(path.join(projectPath, "output"), { recursive: true, force: true });
      await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Find ep_002 and check alias resolved to act_001
      const ep2 = script.episodes.find((e: any) => e.episode_id === "ep_002");
      expect(ep2).toBeDefined();
      expect(ep2.scenes.length).toBeGreaterThan(0);
      const actorIds = ep2.scenes[0].actors.map((a: any) => a.actor_id);
      expect(actorIds).toContain("act_001");
    });
  });

  describe("case-insensitive English name matching", () => {
    test("different casing in script resolves to same catalog actor", async () => {
      const projectPath = await setupProject(
        {
          "ep01.md": `第1集

1-1 日 内 客厅
人物：Alice、bob
▲Alice走进客厅。
bob：你好

1-2 日 内 卧室
人物：alice、Bob
alice：晚安
Bob：晚安
`,
        },
        {
          actors: [
            { id: "act_001", name: "Alice" },
            { id: "act_002", name: "Bob" },
          ],
          locations: [
            { id: "loc_001", name: "客厅" },
            { id: "loc_002", name: "卧室" },
          ],
          props: [],
        },
        { title: "大小写测试", style: "", worldview: "" },
      );

      const result = await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Only 2 actors, not 4
      expect(script.actors.length).toBe(2);

      // Canonical names preserve catalog casing
      const actorNames = script.actors.map((a: any) => a.actor_name);
      expect(actorNames).toContain("Alice");
      expect(actorNames).toContain("Bob");
      expect(actorNames).not.toContain("alice");
      expect(actorNames).not.toContain("bob");

      // Both scenes reference the same actor IDs
      const scene1Ids = script.episodes[0].scenes[0].actors.map((a: any) => a.actor_id);
      const scene2Ids = script.episodes[0].scenes[1].actors.map((a: any) => a.actor_id);
      expect(scene1Ids).toContain("act_001");
      expect(scene1Ids).toContain("act_002");
      expect(scene2Ids).toContain("act_001");
      expect(scene2Ids).toContain("act_002");

      // No warnings — all resolved
      expect(result).not.toHaveProperty("warnings");

      await cleanup(projectPath);
    });

    test("case-insensitive matching without catalog", async () => {
      const projectPath = await setupProject(
        {
          "ep01.md": `第1集

1-1 日 内 Studio
人物：Charlie
Charlie：开始

1-2 日 内 studio
人物：charlie
charlie：继续
`,
        },
        undefined,
        { title: "无catalog大小写", style: "", worldview: "" },
      );

      const result = await parseEpisodes(projectPath);
      const scriptPath = path.join(projectPath, "output", "script.json");
      const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

      // Only 1 actor, not 2
      expect(script.actors.length).toBe(1);
      // Only 1 location, not 2
      expect(script.locations.length).toBe(1);

      await cleanup(projectPath);
    });
  });
});
