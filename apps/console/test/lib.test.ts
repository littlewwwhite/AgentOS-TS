import { describe, expect, test } from "bun:test";
import { fileUrl } from "../src/lib/fileUrl";
import { detectSchema } from "../src/lib/schemaDetect";
import { buildRefDict, resolveRefs, type ScriptJson } from "../src/lib/fountain";
import {
  buildClipInspectorData,
  buildStoryboardEditorModel,
  buildStoryboardGenerationUnits,
  clipVideoPath,
  durationFromRange,
  parseDraftStoryboardPrompt,
  resolveStoryboardSelectionAtTime,
  summarizeSourceRefs,
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
  test("paused inspiration contract falls back to generic JSON", () => {
    expect(detectSchema({ brief: "x", topics: [] })).toBe("generic");
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

  test("summarizes storyboard draft source references for rendered editing", () => {
    expect(summarizeSourceRefs([0, 1, 2, 4, 7])).toBe("0-2, 4, 7");
    expect(summarizeSourceRefs([])).toBe("无");
  });

  test("parses nested shot metadata from storyboard draft prompts without mutating JSON structure", () => {
    const prompt = `PART1\n\n剧情摘要：A\n\n{\n  "shots": [\n    {"shot_id": "S1", "time_range": "00:00-00:02", "camera_setup": {"type": "全景"}},\n    {"shot_id": "S2", "time_range": "00:02-00:04"}\n  ]\n}`;

    expect(parseDraftStoryboardPrompt(prompt)).toEqual({
      partLabel: "PART1",
      summary: "剧情摘要：A",
      shots: [
        { shotId: "S1", timeRange: "00:00-00:02", cameraType: "全景" },
        { shotId: "S2", timeRange: "00:02-00:04", cameraType: null },
      ],
    });
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
    expect(model.defaultShotKey).toBe("scn_001::clip_001::shot_001");
    expect(model.clips).toHaveLength(2);
    expect(model.shots).toHaveLength(3);
    expect(model.totalDuration).toBe(11);
    expect(model.clips[0]).toMatchObject({
      key: "scn_001::clip_001",
      sceneId: "scn_001",
      clipId: "clip_001",
      totalDuration: 6,
      shotCount: 2,
      startOffset: 0,
      endOffset: 6,
      videoPath: "output/ep001/scn001/ep001_scn001_clip001.mp4",
      displayText: "灵霜看向陆云",
    });
    expect(model.clips[1]).toMatchObject({
      key: "scn_002::clip_003",
      startOffset: 6,
      endOffset: 11,
    });
    expect(model.clips[0]?.shots[1]).toMatchObject({
      key: "scn_001::clip_001::shot_002",
      shotId: "shot_002",
      duration: 2,
      startOffset: 4,
      endOffset: 6,
      clipKey: "scn_001::clip_001",
    });
    expect(model.shots[2]).toMatchObject({
      key: "scn_002::clip_003::shot_001",
      startOffset: 6,
      endOffset: 11,
      clipKey: "scn_002::clip_003",
    });
  });

  test("builds storyboard timeline from approved scene shot prompts", () => {
    const model = buildStoryboardEditorModel(
      "output/storyboard/approved/ep001_storyboard.json",
      [
        {
          scene_id: "scn_001",
          shots: [
            {
              source_refs: [0, 1, 2],
              prompt: `PART1\n\n总体描述：压抑内宅。\n\n\`\`\`json\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景手部+银锭特写","beats":["账房摊开银锭"]},{"shot_id":"S2","time_range":"00:06-00:10","camera_setup":{"type":"中景"},"beats":["主角抬眼"]}]}\n\`\`\``,
            },
          ],
        },
      ],
      {},
    );

    expect(model.clips).toHaveLength(1);
    expect(model.shots).toHaveLength(2);
    expect(model.defaultClipKey).toBe("scn_001::part_001");
    expect(model.defaultShotKey).toBe("scn_001::part_001::S1");
    expect(model.clips[0]).toMatchObject({
      sceneId: "scn_001",
      clipId: "part_001",
      displayText: "总体描述：压抑内宅。",
      shotCount: 2,
      totalDuration: 10,
    });
    expect(model.shots[0]).toMatchObject({
      shotId: "S1",
      timeRange: "00:00-00:06",
      duration: 6,
      prompt: "近景手部+银锭特写\n账房摊开银锭",
    });
    expect(model.shots[1]).toMatchObject({
      shotId: "S2",
      duration: 4,
      prompt: "中景\n主角抬眼",
    });
  });

  test("builds storyboard generation units from script refs and approved prompt calls", () => {
    const script: ScriptJson = {
      actors: [{ actor_id: "act_001", actor_name: "灵霜" }],
      episodes: [
        {
          episode_id: "ep001",
          scenes: [
            {
              scene_id: "scn_001",
              actions: [
                { type: "action", content: "{act_001}把银锭推到桌边。" },
                { type: "dialogue", actor_id: "act_001", content: "这些账，今晚要清。" },
                { type: "action", content: "她抬眼看向门外。" },
              ],
            },
          ],
        },
      ],
    };

    const rawPrompt = `PART1

总体描述：压抑内宅。

\`\`\`json
{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景手部+银锭特写","beats":["灵霜把银锭推到桌边"]},{"shot_id":"S2","time_range":"00:06-00:10","camera_setup":{"type":"中景"},"beats":["灵霜抬眼看向门外"]}]}
\`\`\``;

    const units = buildStoryboardGenerationUnits(
      "output/storyboard/approved/ep001_storyboard.json",
      [
        {
          scene_id: "scn_001",
          shots: [
            {
              source_refs: [0, 1, 2],
              prompt: rawPrompt,
            },
          ],
        },
      ],
      script,
      new Set(["output/ep001/scn001/ep001_scn001_part001.mp4"]),
    );

    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      key: "scn_001::part_001",
      episodeId: "ep001",
      sceneId: "scn_001",
      partId: "part_001",
      sourceRefsLabel: "0-2",
      scriptExcerpt: "灵霜把银锭推到桌边。\n灵霜：这些账，今晚要清。\n她抬眼看向门外。",
      promptSummary: "总体描述：压抑内宅。",
      shots: [
        {
          shotId: "S1",
          timeRange: "00:00-00:06",
          duration: 6,
          prompt: "近景手部+银锭特写\n灵霜把银锭推到桌边",
        },
        {
          shotId: "S2",
          timeRange: "00:06-00:10",
          duration: 4,
          prompt: "中景\n灵霜抬眼看向门外",
        },
      ],
      videoStatus: "generated",
      videoPath: "output/ep001/scn001/ep001_scn001_part001.mp4",
    });
    expect(units[0]?.prompt).toBe(rawPrompt);
  });

  test("prefers merged episode video when it exists beside the storyboard", () => {
    const model = buildStoryboardEditorModel(
      "output/ep001/ep001_storyboard.json",
      [
        {
          scene_id: "scn_001",
          clips: [{ clip_id: "clip_001", shots: [{ shot_id: "shot_001", time_range: "0-4s", partial_prompt: "A" }] }],
        },
      ],
      {},
      new Set([
        "output/ep001/ep001.mp4",
        "output/ep001/scn001/clip001/ep001_scn001_clip001.mp4",
      ]),
    );

    expect(model.episodeVideoPath).toBe("output/ep001/ep001.mp4");
  });

  test("resolves real clip media paths from the tree instead of assuming one folder layout", () => {
    const model = buildStoryboardEditorModel(
      "output/ep001/ep001_storyboard.json",
      [
        {
          scene_id: "scn_001",
          clips: [{ clip_id: "clip_001", shots: [{ shot_id: "shot_001", time_range: "0-4s", partial_prompt: "A" }] }],
        },
        {
          scene_id: "scn_002",
          clips: [{ clip_id: "clip_001", shots: [{ shot_id: "shot_001", time_range: "0-3s", partial_prompt: "B" }] }],
        },
      ],
      {},
      new Set([
        "output/ep001/scn001/clip001/ep001_scn001_clip001.mp4",
        "output/ep001/scn002/ep001_scn002_clip001_003.mp4",
      ]),
    );

    expect(model.clips[0]?.videoPath).toBe("output/ep001/scn001/clip001/ep001_scn001_clip001.mp4");
    expect(model.clips[1]?.videoPath).toBe("output/ep001/scn002/ep001_scn002_clip001_003.mp4");
  });

  test("resolves active clip and shot from episode timeline time", () => {
    const model = buildStoryboardEditorModel(
      "output/ep001/ep001_storyboard.json",
      [
        {
          scene_id: "scn_001",
          clips: [
            {
              clip_id: "clip_001",
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
              clip_id: "clip_002",
              shots: [{ shot_id: "shot_001", time_range: "0-5s", partial_prompt: "C" }],
            },
          ],
        },
      ],
      {},
    );

    expect(resolveStoryboardSelectionAtTime(model, 0.5)).toEqual({
      clipKey: "scn_001::clip_001",
      shotKey: "scn_001::clip_001::shot_001",
    });
    expect(resolveStoryboardSelectionAtTime(model, 4.5)).toEqual({
      clipKey: "scn_001::clip_001",
      shotKey: "scn_001::clip_001::shot_002",
    });
    expect(resolveStoryboardSelectionAtTime(model, 7.25)).toEqual({
      clipKey: "scn_002::clip_002",
      shotKey: "scn_002::clip_002::shot_001",
    });
    expect(resolveStoryboardSelectionAtTime(model, 99)).toEqual({
      clipKey: "scn_002::clip_002",
      shotKey: "scn_002::clip_002::shot_001",
    });
  });
});
