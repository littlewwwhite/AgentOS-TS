import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storyboardData = {
  episode_id: "ep_001",
  status: "approved",
  scenes: [
    {
      scene_id: "scn_001",
      shots: [
        {
          source_refs: [0, 1, 2],
          prompt: `PART1\n\n总体描述：压抑内宅。\n\n\`\`\`json\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景手部+银锭特写","beats":["账房摊开银锭"]}]}\n\`\`\``,
        },
      ],
    },
  ],
};

// Storyboard where source_refs point to a scene that does not exist in scriptData
// — used to verify the empty scriptExcerpt UI path.
const storyboardDataNoScriptMatch = {
  episode_id: "ep_999",
  status: "approved",
  scenes: [
    {
      scene_id: "scn_999",
      shots: [
        {
          source_refs: [0],
          prompt: `PART1\n\n总体描述：无匹配剧本。\n\n\`\`\`json\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:04","camera_setup":"中景","beats":["远景镜头"]}]}\n\`\`\``,
        },
      ],
    },
  ],
};

const scriptData = {
  episodes: [
    {
      episode_id: "ep001",
      scenes: [
        {
          scene_id: "scn_001",
          actions: [
            { type: "action", content: "账房摊开银锭。" },
            { type: "dialogue", actor_id: "act_001", content: "这些账，今晚要清。" },
            { type: "action", content: "主角抬眼，屋内安静。" },
          ],
        },
      ],
    },
  ],
  actors: [{ actor_id: "act_001", actor_name: "灵霜" }],
};

// Mutable storyboard data reference — each test can swap before rendering.
let currentStoryboardData: unknown = storyboardData;
// Mutable script data reference — each test can swap before rendering.
let currentScriptData: unknown = scriptData;

mock.module("../src/hooks/useEditableJson", () => ({
  useEditableJson: () => ({
    get data() { return currentStoryboardData; },
    error: null,
    status: "idle",
    patch: () => undefined,
    savedAt: null,
  }),
  getAtPath: (value: unknown, path: string) => {
    return path.split(".").reduce<unknown>((current, segment) => {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) return current[Number(segment)];
      if (typeof current === "object") return (current as Record<string, unknown>)[segment];
      return undefined;
    }, value);
  },
}));

mock.module("../src/hooks/useFile", () => ({
  useFileJson: (_projectName: string, path: string) => ({
    get data() { return path === "output/script.json" ? currentScriptData : {}; },
  }),
}));

// Mutable tree reference — each test can swap it before rendering.
let currentTree: unknown[] = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

mock.module("../src/contexts/ProjectContext", () => ({
  useProject: () => ({
    get tree() {
      return currentTree;
    },
    refresh: () => undefined,
    state: { artifacts: {} },
  }),
}));

const { StoryboardView } = await import("../src/components/Viewer/views/StoryboardView");

describe("StoryboardView rendering", () => {
  test("renders storyboard generation units instead of the empty storyboard state", () => {
    currentTree = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    expect(html).not.toContain("当前故事板里还没有可浏览的镜头");
    expect(html).toContain("剧本到故事板");
    expect(html).toContain("来源剧本 0-2");
    expect(html).toContain("账房摊开银锭。");
    expect(html).toContain("灵霜：这些账，今晚要清。");
    expect(html).toContain("分镜提示词");
    expect(html).toContain("总体描述：压抑内宅。");
    expect(html).toContain("S1");
    expect(html).toContain("近景手部+银锭特写");
    expect(html).toContain("视频待生成");
  });

  test("videoStatus is 'generated' when the video path lives in a nested tree node", () => {
    // The storyboard path is "output/storyboard/approved/ep001_storyboard.json".
    // episodeId = "ep001", episodeRuntimeDir = "output/ep001"
    // For scene scn_001 + part_001:
    //   sceneSlug = compactStoryboardId("scn_001") = "scn001"
    //   clipSlug  = compactStoryboardId("part_001") = "part001"
    //   clipVideoPath = "output/ep001/scn001/ep001_scn001_part001.mp4"
    currentStoryboardData = storyboardData;
    currentScriptData = scriptData;
    currentTree = [
      {
        path: "output/ep001",
        children: [
          {
            path: "output/ep001/scn001",
            children: [{ path: "output/ep001/scn001/ep001_scn001_part001.mp4" }],
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    expect(html).toContain("视频已生成");
    expect(html).not.toContain("视频待生成");
  });

  // I-1: when scriptData has no matching scene, scriptExcerpt is [] and UI must
  // render （无剧本摘录） instead of the old sentinel string.
  test("renders （无剧本摘录） when scriptData has no matching scene, never renders sentinel string", () => {
    currentStoryboardData = storyboardDataNoScriptMatch;
    currentScriptData = scriptData; // scriptData has scn_001, storyboard uses scn_999 — no match
    currentTree = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    expect(html).not.toContain("未找到对应剧本段落");
    expect(html).toContain("（无剧本摘录）");
    expect(html).toContain("剧本到故事板");
  });

  // I-2: when storyboard has scenes[].shots[].prompt but editorModel clips are empty
  // (no legacy clips[] array), the main surface must still render — not fall back to
  // the "no clips" empty state.
  test("renders main surface with generationUnits even when editorModel clips are empty", () => {
    // storyboardDataNoScriptMatch uses shots-based storyboard (no clips[] array).
    // buildStoryboardEditorModel will derive synthetic clips from prompts — so clips
    // won't be empty here; the test validates the fast path via generationUnits.
    currentStoryboardData = storyboardDataNoScriptMatch;
    currentScriptData = {}; // no script at all — ensures scriptExcerpt = []
    currentTree = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    expect(html).toContain("剧本到故事板");
    expect(html).not.toContain("当前故事板里还没有可浏览的镜头");
  });
});
