// input: script-parser parseEpisodes with synthetic data
// output: Tests for parser correctness with controlled input
// pos: Unit test — validates deterministic parser with known expected output

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseEpisodes } from "../../src/tools/script-parser.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

async function createProject(
  episodes: Record<string, string>,
  catalog?: Record<string, unknown>,
  design?: Record<string, unknown>,
): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "parser-test-"));
  const draftDir = path.join(tmpDir, "draft");
  const epDir = path.join(draftDir, "episodes");
  const outDir = path.join(tmpDir, "output");
  await fs.mkdir(epDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  if (design) {
    await fs.writeFile(
      path.join(draftDir, "design.json"),
      JSON.stringify(design),
    );
  }
  if (catalog) {
    await fs.writeFile(
      path.join(draftDir, "catalog.json"),
      JSON.stringify(catalog),
    );
  }
  for (const [name, content] of Object.entries(episodes)) {
    await fs.writeFile(path.join(epDir, name), content);
  }
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("parseEpisodes", () => {
  it("returns error when episodes directory missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "parser-empty-"));
    const result = await parseEpisodes(dir);
    expect(result).toHaveProperty("error");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns error when no ep*.md files exist", async () => {
    const dir = await createProject({});
    // Remove the empty episodes dir files
    const result = await parseEpisodes(dir);
    expect(result).toHaveProperty("error");
    expect((result.error as string)).toContain("No ep");
  });

  it("parses single scene", async () => {
    const ep = `第1集：测试

1-1 日 内 客厅
人物：张三、李四
道具：杯子
▲张三走进客厅
张三：你好
李四（惊讶）：你怎么来了
`;
    const dir = await createProject(
      { "ep01.md": ep },
      undefined,
      { title: "测试剧", worldview: "现代", style: "现实" },
    );
    const result = await parseEpisodes(dir);
    expect(result).not.toHaveProperty("error");

    const stats = result.stats as Record<string, number>;
    expect(stats.total_episodes).toBe(1);
    expect(stats.total_scenes).toBe(1);
    expect(stats.total_actors).toBe(2);
    expect(stats.total_locations).toBe(1);

    // Verify output file
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    expect(script.title).toBe("测试剧");

    const scene = script.episodes[0].scenes[0];
    expect(scene.location).toBe("客厅");
    expect(scene.time_of_day).toBe("day");
    expect(scene.cast.length).toBe(2);
    expect(scene.prop_ids.length).toBe(1);

    // 3 actions: action + 2 dialogues
    expect(scene.actions.length).toBe(3);
    expect(scene.actions[0].type).toBe("action");
    expect(scene.actions[1].type).toBe("dialogue");
    expect(scene.actions[2].type).toBe("dialogue");
    expect(scene.actions[2].emotion).toBe("惊讶");
  });

  it("handles multiple episodes and scenes", async () => {
    const ep1 = `第1集：开端

1-1 日 内 办公室
人物：王总
▲王总看着窗外

1-2 夜 外 街道
人物：小明
小明：下班了
`;
    const ep2 = `第2集：发展

2-1 清晨 内 卧室
人物：小红
▲小红醒来
小红：新的一天
`;
    const dir = await createProject({ "ep01.md": ep1, "ep02.md": ep2 });
    const result = await parseEpisodes(dir);
    const stats = result.stats as Record<string, number>;
    expect(stats.total_episodes).toBe(2);
    expect(stats.total_scenes).toBe(3);
    expect(stats.total_actors).toBe(3);
    expect(stats.total_locations).toBe(3);

    // Verify scene IDs reset per episode
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    expect(script.episodes[0].scenes[0].id).toBe("scn_001");
    expect(script.episodes[0].scenes[1].id).toBe("scn_002");
    expect(script.episodes[1].scenes[0].id).toBe("scn_001");
  });

  it("handles time words correctly", async () => {
    const ep = `第1集

1-1 日 内 A
人物：X
1-2 夜 内 B
人物：X
1-3 清晨 内 C
人物：X
1-4 黄昏 外 D
人物：X
1-5 午后 内 E
人物：X
1-6 深夜 内 F
人物：X
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    const scenes = script.episodes[0].scenes;
    expect(scenes[0].time_of_day).toBe("day");
    expect(scenes[1].time_of_day).toBe("night");
    expect(scenes[2].time_of_day).toBe("dawn");
    expect(scenes[3].time_of_day).toBe("dusk");
    expect(scenes[4].time_of_day).toBe("noon");
    expect(scenes[5].time_of_day).toBe("night");
  });

  it("handles actor states", async () => {
    const ep = `第1集

1-1 日 内 大厅
人物：张三【幼年】、李四【战甲】
张三：你好
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    // Check actors have states
    const actors = script.actors;
    const zhangsan = actors.find((a: any) => a.name === "张三");
    expect(zhangsan).toBeDefined();
    expect(zhangsan.states).toBeDefined();
    expect(zhangsan.states[0].name).toBe("幼年");
  });

  it("handles location states", async () => {
    const ep = `第1集

1-1 日 内 大厅【废墟状态】
人物：张三
张三：这里好荒凉
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const loc = script.locations[0];
    expect(loc.name).toBe("大厅");
    expect(loc.states).toBeDefined();
    expect(loc.states[0].name).toBe("废墟状态");

    const scene = script.episodes[0].scenes[0];
    expect(scene.location_state_id).toBeDefined();
  });

  it("filters non-character names", async () => {
    const ep = `第1集

1-1 日 内 客厅
人物：张三
旁白：故事开始了
【字幕：第一天】
张三：你好
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    // 旁白 should not be in actors
    const actorNames = script.actors.map((a: any) => a.name);
    expect(actorNames).not.toContain("旁白");
    expect(actorNames).not.toContain("字幕");
    expect(actorNames).toContain("张三");
  });

  it("handles OS (inner thought) lines", async () => {
    const ep = `第1集

1-1 日 内 客厅
人物：张三
张三（OS）：我心里好难过
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    const action = script.episodes[0].scenes[0].actions[0];
    expect(action.type).toBe("inner_thought");
    expect(action.content).toBe("我心里好难过");
  });

  it("handles props deduplication", async () => {
    const ep = `第1集

1-1 日 内 客厅
人物：张三
道具：杯子、杯子、刀
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    expect(script.props.length).toBe(2); // deduplicated
  });

  it("uses catalog.json IDs when available", async () => {
    const catalog = {
      actors: [
        { id: "act_100", name: "张三", states: ["幼年"] },
      ],
      locations: [
        { id: "loc_200", name: "客厅" },
      ],
      props: [
        { id: "prp_300", name: "杯子" },
      ],
    };
    const ep = `第1集

1-1 日 内 客厅
人物：张三
道具：杯子
张三：你好
`;
    const dir = await createProject({ "ep01.md": ep }, catalog);
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const actor = script.actors.find((a: any) => a.name === "张三");
    expect(actor.id).toBe("act_100");

    const loc = script.locations.find((l: any) => l.name === "客厅");
    expect(loc.id).toBe("loc_200");

    expect(script.props[0].id).toBe("prp_300");
  });

  it("handles NPC layer filtering", async () => {
    const ep = `第1集

1-1 日 内 大厅
人物：张三、李四/NPC：路人甲、路人乙
张三：你好
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

    const actorNames = script.actors.map((a: any) => a.name);
    expect(actorNames).toContain("张三");
    expect(actorNames).toContain("李四");
    // NPC layer should be filtered
    expect(actorNames).not.toContain("路人甲");
  });

  it("handles group patterns", async () => {
    const ep = `第1集

1-1 日 内 战场
人物：将军、士兵×10、众人
将军：出发
`;
    const dir = await createProject({ "ep01.md": ep });
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    const actorNames = script.actors.map((a: any) => a.name);
    expect(actorNames).toContain("将军");
    // Groups should be filtered
    expect(actorNames).not.toContain("士兵×10");
  });

  it("writes design metadata from design.json", async () => {
    const ep = `第1集
1-1 日 内 客厅
人物：张三
张三：你好
`;
    const design = { title: "我的剧本", worldview: "现代都市", style: "写实" };
    const dir = await createProject({ "ep01.md": ep }, undefined, design);
    const result = await parseEpisodes(dir);
    const scriptPath = result.script_path as string;
    const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));
    expect(script.title).toBe("我的剧本");
    expect(script.worldview).toBe("现代都市");
    expect(script.style).toBe("写实");
  });
});
