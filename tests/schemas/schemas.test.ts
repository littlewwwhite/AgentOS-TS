import { describe, it, expect } from "vitest";
import {
  DesignSchema,
  CatalogSchema,
  ScriptSchema,
  AssetManifestSchema,
  ProductionPlanSchema,
  TimelineSchema,
  schemaRegistry,
} from "../../src/schemas/index.js";

describe("DesignSchema", () => {
  it("validates a complete design", () => {
    const data = {
      title: "Test Film",
      worldview: "A fantasy world",
      style: "anime cel-shaded",
      total_episodes: 1,
      episodes: [
        {
          episode: 1,
          title: "Pilot",
          main_plot: "Hero awakens",
          climax: "Boss fight",
          cliffhanger: "Mysterious stranger",
          scenes: [{ id: "1-1", time: "日", setting: "内", location: "大厅", description: "觉醒仪式" }],
        },
      ],
    };
    expect(DesignSchema.parse(data)).toEqual(data);
  });

  it("rejects missing required fields", () => {
    expect(() => DesignSchema.parse({ title: "X" })).toThrow();
  });
});

describe("CatalogSchema", () => {
  it("validates catalog with optional states", () => {
    const data = {
      actors: [
        { id: "act_001", name: "张三" },
        { id: "act_002", name: "李四", states: ["default", "战甲"] },
      ],
      locations: [{ id: "loc_001", name: "大厅" }],
      props: [{ id: "prp_001", name: "宝剑" }],
    };
    const result = CatalogSchema.parse(data);
    expect(result.actors[0].states).toBeUndefined();
    expect(result.actors[1].states).toEqual(["default", "战甲"]);
  });
});

describe("ScriptSchema", () => {
  it("validates a minimal script", () => {
    const data = {
      title: "Test",
      actors: [{ id: "act_001", name: "Hero" }],
      episodes: [
        {
          episode: 1,
          scenes: [
            {
              id: "scn_001",
              sequence: 1,
              location: "Forest",
              actions: [{ sequence: 1, type: "dialogue", content: "Hello" }],
            },
          ],
        },
      ],
    };
    const result = ScriptSchema.parse(data);
    expect(result.actors).toHaveLength(1);
    expect(result.episodes[0].scenes[0].cast).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.metadata).toEqual({});
  });

  it("validates script with full nested structure", () => {
    const data = {
      title: "Full Script",
      description: "A test script",
      worldview: "Fantasy",
      style: "anime",
      actors: [
        { id: "act_001", name: "Hero", states: [{ id: "st_001", name: "casual" }] },
      ],
      locations: [
        { id: "loc_001", name: "Forest", states: [{ id: "lst_001", name: "ruins" }] },
      ],
      props: [{ id: "prp_001", name: "Sword", description: "A magic sword" }],
      episodes: [
        {
          episode: 1,
          title: "Ep 1",
          summary: "Summary",
          scenes: [
            {
              id: "scn_001",
              sequence: 1,
              location: "Forest",
              location_id: "loc_001",
              location_state_id: "lst_001",
              time_of_day: "dawn",
              summary: "Opening",
              cast: [{ actor_id: "act_001", state_id: "st_001" }],
              prop_ids: ["prp_001"],
              actions: [
                {
                  sequence: 1,
                  actor_id: "act_001",
                  type: "dialogue",
                  content: "Let's go",
                  emotion: "determined",
                  direction: "close-up",
                  beat: "hook",
                  time_hint: "0-3s",
                },
              ],
              environment: "dark forest with mist",
              metadata: { music_mood: "tense" },
            },
          ],
        },
      ],
      metadata: { source_type: "original" },
    };
    const result = ScriptSchema.parse(data);
    expect(result.actors[0].states).toHaveLength(1);
    expect(result.episodes[0].scenes[0].cast[0].state_id).toBe("st_001");
  });
});

describe("AssetManifestSchema", () => {
  it("validates asset manifest", () => {
    const data = {
      project: "test_project",
      actors: [
        { id: "act_001", type: "character", source_ref: "act_001", file_path: "assets/hero.png" },
      ],
      scenes: [
        { id: "scn_001", type: "background", source_ref: "loc_001", file_path: "assets/forest.png" },
      ],
      props: [],
    };
    expect(AssetManifestSchema.parse(data).project).toBe("test_project");
  });

  it("validates actor asset with speech_style", () => {
    const data = {
      project: "test",
      actors: [
        {
          id: "act_001",
          type: "character",
          source_ref: "act_001",
          file_path: "x.png",
          speech_style: "calm",
        },
      ],
      scenes: [],
      props: [],
    };
    expect(AssetManifestSchema.parse(data).actors[0].speech_style).toBe("calm");
  });
});

describe("ProductionPlanSchema", () => {
  it("validates production plan", () => {
    const data = {
      project: "test",
      shots: [
        {
          id: "shot_001",
          scene_id: "scn_001",
          sequence: 1,
          description: "Hero enters",
          actor_ids: ["act_001"],
          asset_refs: ["hero.png"],
        },
      ],
      render_jobs: [
        { shot_id: "shot_001", prompt: "Hero walking", assets: ["hero.png"] },
      ],
    };
    const result = ProductionPlanSchema.parse(data);
    expect(result.shots[0].episode).toBe(0);
    expect(result.render_jobs[0].status).toBe("pending");
  });
});

describe("TimelineSchema", () => {
  it("validates timeline", () => {
    const data = {
      project: "test",
      episodes: [1],
      clips: [
        { shot_id: "shot_001", type: "video", file_path: "out/001.mp4", start_time: 0, duration: 5 },
        { shot_id: "shot_001", type: "audio_dialogue", file_path: "out/001.wav", start_time: 0, duration: 5, layer: 1 },
      ],
      total_duration: 5,
    };
    const result = TimelineSchema.parse(data);
    expect(result.clips[0].layer).toBe(0);
    expect(result.clips[1].layer).toBe(1);
  });
});

describe("schemaRegistry", () => {
  it("contains all expected keys", () => {
    const expected = [
      "design.json",
      "catalog.json",
      "script.json",
      "assets/manifest.json",
      "production/plan.json",
      "output/timeline.json",
    ];
    for (const key of expected) {
      expect(schemaRegistry[key]).toBeDefined();
    }
  });
});
