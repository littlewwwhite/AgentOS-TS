import { describe, expect, test } from "bun:test";
import { fileUrl } from "../src/lib/fileUrl";
import { detectSchema } from "../src/lib/schemaDetect";
import { buildRefDict, resolveRefs } from "../src/lib/fountain";
import {
  buildClipInspectorData,
  buildStoryboardEditorModel,
  clipVideoPath,
  durationFromRange,
  splitStoryboardText,
} from "../src/lib/storyboard";

describe("fileUrl", () => {
  test("encodes path segments but keeps slashes", () => {
    expect(fileUrl("c3-1", "output/ep001/clip 1.mp4")).toBe(
      "/files/c3-1/output/ep001/clip%201.mp4",
    );
  });
  test("trims leading slash", () => {
    expect(fileUrl("c0", "/output/script.json")).toBe("/files/c0/output/script.json");
  });
});

describe("detectSchema", () => {
  test("script: has episodes array", () => {
    expect(detectSchema({ episodes: [{ scenes: [] }] })).toBe("script");
  });
  test("storyboard: scenes with shots+prompt", () => {
    expect(detectSchema({ episode_id: "ep001", scenes: [{ shots: [{ prompt: "x" }] }] })).toBe("storyboard");
  });
  test("inspiration: has inspiration_id or brief", () => {
    expect(detectSchema({ brief: "x", topics: [] })).toBe("inspiration");
  });
  test("fallback: unknown", () => {
    expect(detectSchema({ foo: 1 })).toBe("generic");
  });
  test("non-object returns generic", () => {
    expect(detectSchema(null)).toBe("generic");
    expect(detectSchema([1, 2])).toBe("generic");
  });
  test("script wins when both episodes and scenes are top-level", () => {
    expect(detectSchema({ episodes: [{ scenes: [] }], scenes: [{ shots: [{ prompt: "x" }] }] })).toBe("script");
  });
});

describe("reference resolution", () => {
  test("builds id map from draft catalog shape", () => {
    const dict = buildRefDict({
      actors: [{ id: "act_002", name: "何深" }],
      locations: [{ id: "loc_004", name: "别墅客厅" }],
      props: [{ id: "prp_001", name: "花甲子坟" }],
    });
    expect(dict.act_002).toBe("何深");
    expect(dict.loc_004).toBe("别墅客厅");
    expect(dict.prp_001).toBe("花甲子坟");
  });

  test("renders id refs, double-braced refs, and name refs", () => {
    const dict = {
      act_002: "灵霜",
      loc_001: "灵霜寝宫",
      灵霜: "灵霜",
    };
    expect(resolveRefs("{act_002}站在{{loc_001}}，{灵霜}回头", dict)).toBe(
      "灵霜站在灵霜寝宫，灵霜回头",
    );
  });
});

describe("storyboard helpers", () => {
  test("derives clip video path from storyboard path and ids", () => {
    expect(
      clipVideoPath("output/ep001/ep001_storyboard.json", "scn_001", "clip_002"),
    ).toBe("output/ep001/scn001/ep001_scn001_clip002.mp4");
  });

  test("parses hyphen and en-dash time ranges", () => {
    expect(durationFromRange("0-4s")).toBe(4);
    expect(durationFromRange("3.0–5.5s")).toBe(2.5);
  });

  test("splits storyboard source into resolved text beats", () => {
    expect(splitStoryboardText("action：A {act_002} → B", { act_002: "何深" })).toEqual([
      "A 何深",
      "B",
    ]);
  });

  test("builds resolved clip inspector data for the storyboard info panel", () => {
    const data = buildClipInspectorData(
      {
        scene_id: "scn_001",
        environment: { space: "interior", time: "night" },
        locations: [{ location_id: "loc_001" }],
        actors: [{ actor_id: "act_001" }, { actor_id: "act_002" }],
        props: [{ prop_id: "prp_001" }],
      },
      {
        expected_duration: "6s",
        script_source: "action：{act_001}看向{act_002}",
        layout_prompt: "{act_001}站在{loc_001}",
        sfx_prompt: "保留衣料摩擦声",
        complete_prompt_v2: "镜头跟随{act_001}进入{loc_001}",
        shots: [
          { shot_id: "shot_001", time_range: "0-4s", partial_prompt: "{act_001}转身" },
          { shot_id: "shot_002", time_range: "4-6s", partial_prompt: "{act_002}抬眼" },
        ],
      },
      {
        act_001: "灵霜",
        act_002: "陆云",
        loc_001: "长廊",
        prp_001: "轮椅",
      },
    );

    expect(data).toMatchObject({
      location: "长廊",
      environment: "INT · NIGHT",
      characters: ["灵霜", "陆云"],
      props: ["轮椅"],
      scriptSource: "灵霜看向陆云",
      layoutPrompt: "灵霜站在长廊",
      sfxPrompt: "保留衣料摩擦声",
      promptPreview: "镜头跟随灵霜进入长廊",
      shotCount: 2,
      totalDuration: 6,
      expectedDuration: "6s",
    });
  });

  test("falls back to stitched shot prompts when no complete prompt exists", () => {
    const data = buildClipInspectorData(
      {
        scene_id: "scn_002",
        actors: [{ actor_id: "act_001" }],
      },
      {
        shots: [
          { shot_id: "shot_001", time_range: "0-3s", partial_prompt: "{act_001}抬头" },
          { shot_id: "shot_002", time_range: "3-5s", partial_prompt: "{act_001}冷笑" },
        ],
      },
      { act_001: "行风" },
    );

    expect(data.promptPreview).toBe("行风抬头\n行风冷笑");
    expect(data.totalDuration).toBe(5);
    expect(data.characters).toEqual(["行风"]);
  });

  test("builds fixed editor timeline data with default selected clip", () => {
    const model = buildStoryboardEditorModel(
      "output/ep001/ep001_storyboard.json",
      [
        {
          scene_id: "scn_001",
          clips: [
            {
              clip_id: "clip_001",
              expected_duration: "6s",
              script_source: "{act_001}看向{act_002}",
              shots: [
                { shot_id: "shot_001", time_range: "0-4s", partial_prompt: "A" },
                { shot_id: "shot_002", time_range: "4-6s", partial_prompt: "B" },
              ],
            },
          ],
        },
        {
          scene_id: "scn_002",
          clips: [
            {
              clip_id: "clip_003",
              expected_duration: "5s",
              script_source: "{act_002}转身",
              shots: [{ shot_id: "shot_001", time_range: "0-5s", partial_prompt: "C" }],
            },
          ],
        },
      ],
      { act_001: "灵霜", act_002: "陆云" },
    );

    expect(model.defaultClipKey).toBe("scn_001::clip_001");
    expect(model.clips).toHaveLength(2);
    expect(model.clips[0]).toMatchObject({
      key: "scn_001::clip_001",
      sceneId: "scn_001",
      clipId: "clip_001",
      totalDuration: 6,
      shotCount: 2,
      videoPath: "output/ep001/scn001/ep001_scn001_clip001.mp4",
      displayText: "灵霜看向陆云",
    });
    expect(model.clips[0]?.shots[1]).toMatchObject({
      key: "scn_001::clip_001::shot_002",
      shotId: "shot_002",
      duration: 2,
    });
  });
});
