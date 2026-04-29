import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storyboardData = {
  episode_id: "ep_001",
  status: "approved",
  scenes: [
    {
      scene_id: "scn_001",
      actors: [{ actor_id: "act_001" }],
      locations: [{ location_id: "loc_001" }],
      shots: [
        {
          source_refs: [0, 1, 2],
          prompt: `PART1\n\n总体描述：压抑内宅。\n\n\`\`\`json\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:06","camera_setup":"近景手部+银锭特写","beats":["账房摊开银锭"]}]}\n\`\`\``,
        },
      ],
    },
  ],
};

// Storyboard where source_refs point to a scene that does not exist in scriptData.
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
  actors: [
    {
      actor_id: "act_001",
      actor_name: "灵霜",
      states: [{ state_id: "st_001", state_name: "洗衣奴装" }],
    },
  ],
  locations: [{ location_id: "loc_001", location_name: "内宅" }],
  props: [{ prop_id: "prp_001", prop_name: "银锭" }],
};

// Mutable storyboard data reference — each test can swap before rendering.
let currentStoryboardData: unknown = storyboardData;
// Mutable script data reference — each test can swap before rendering.
let currentScriptData: unknown = scriptData;

function setAtPathForMock<T>(obj: T, path: string, value: unknown): T {
  const segments = path.split(".");
  function recurse(node: unknown, segs: string[]): unknown {
    const [head, ...rest] = segs;
    if (head === undefined) return value;
    if (node === null || node === undefined) throw new Error("PATH_NOT_FOUND");
    const idx = Number(head);
    const isArrayIndex = !Number.isNaN(idx) && String(idx) === head;
    if (isArrayIndex) {
      if (!Array.isArray(node)) throw new Error("PATH_NOT_FOUND");
      const copy = [...node];
      copy[idx] = rest.length === 0 ? value : recurse(copy[idx], rest);
      return copy;
    }
    if (typeof node !== "object" || Array.isArray(node)) throw new Error("PATH_NOT_FOUND");
    const copy = { ...(node as Record<string, unknown>) };
    copy[head] = rest.length === 0 ? value : recurse(copy[head], rest);
    return copy;
  }
  try {
    return recurse(obj, segments) as T;
  } catch {
    return obj;
  }
}

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
  setAtPath: setAtPathForMock,
}));

mock.module("../src/hooks/useFile", () => ({
  useFileText: () => ({ text: null, error: null }),
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
    expect(html).not.toContain("剧本到故事板");
    expect(html).not.toContain("来源剧本");
    expect(html).not.toContain("视频状态");
    expect(html).toContain("当前镜头");
    expect(html).toContain("资产库");
    expect(html).toContain("grid-cols-[220px_minmax(0,1fr)]");
    expect(html).toContain("repeat(auto-fit, minmax(min(100%, 360px), 1fr))");
    expect(html).toContain("grid-rows-[minmax(0,1fr)_auto]");
    expect(html).toContain("角色");
    expect(html).toContain("场景");
    expect(html).toContain("当前片段");
    expect(html).toContain("视频片段轨");
    expect(html).not.toContain("整集时间轴");
    expect(html).not.toContain("片段轨</");
    expect(html).not.toContain("镜头轨");
    expect(html).not.toContain("点击任意片段或镜头即可跳转");
    expect(html).toContain("总时长");
    expect(html).toContain("账房摊开银锭");
    expect(html).toContain("灵霜");
    expect(html).toContain("这些账，今晚要清。");
    expect(html).toContain("生成视频 prompt");
    expect(html).not.toContain("video.generate");
    expect(html).not.toContain("aos-cli.model/v1");
    expect(html).not.toContain("PART1");
    expect(html).toContain("总体描述：压抑内宅。");
    expect(html).toContain("&quot;shots&quot;");
    expect(html).toContain("&quot;shot_id&quot;");
    expect(html).toContain("&quot;time_range&quot;");
    expect(html).toContain("&quot;camera_setup&quot;");
    expect(html).toContain("&quot;beats&quot;");
    expect(html).toContain("S1");
    expect(html).toContain("00:00-00:06");
    expect(html).toContain("近景手部+银锭特写");
    expect(html).toContain("账房摊开银锭");
    expect(html).not.toContain("视频待生成");
    expect(html).not.toContain("视频已生成");
  });

  // I-1: when scriptData has no matching scene, the primary surface still renders
  // the editable video prompt without legacy missing-script placeholders.
  test("renders prompt editor when scriptData has no matching scene, never renders sentinel string", () => {
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
    expect(html).not.toContain("（无剧本摘录）");
    expect(html).toContain("生成视频 prompt");
    expect(html).not.toContain("剧本到故事板");
  });

  test("falls back to part order for script source and renders prompt refs as names", () => {
    currentStoryboardData = {
      episode_id: "ep_001",
      status: "approved",
      scenes: [
        {
          scene_id: "scn_001",
          shots: [
            {
              prompt: "景别/机位 | 近景\n\n总体描述：@act_001:st_001 在 @loc_001 推开 @prp_001。",
            },
          ],
        },
      ],
    };
    currentScriptData = scriptData;
    currentTree = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    expect(html).toContain("账房摊开银锭。");
    expect(html).toContain("灵霜（洗衣奴装）");
    expect(html).toContain("内宅");
    expect(html).toContain("银锭");
    expect(html).toContain("原始 prompt");
  });

  // I-3: when one scene has multiple parts, the script column must render once
  // (scene-level), not once per part. Each part shows only its own prompt editor.
  test("renders script column once per scene even when scene has multiple parts", () => {
    currentStoryboardData = {
      episode_id: "ep_001",
      status: "approved",
      scenes: [
        {
          scene_id: "scn_001",
          shots: [
            {
              source_refs: [0],
              prompt: "PART1\n\n总体描述：第一段。\n\nS1 | 00:00-00:03 | 近景\n- 运镜：A→B",
            },
            {
              source_refs: [1],
              prompt: "PART2\n\n总体描述：第二段。\n\nS1 | 00:00-00:03 | 中景\n- 运镜：C→D",
            },
          ],
        },
      ],
    };
    currentScriptData = scriptData;
    currentTree = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    const scriptOccurrences = html.split("账房摊开银锭").length - 1;
    expect(scriptOccurrences).toBe(1);
    expect(html).toContain("part_001");
    expect(html).toContain("总体描述：第二段。");
    expect(html).toContain("视频片段轨");
    expect(html).toContain("总体描述：第一段。");
    expect(html).not.toContain("镜头轨");
  });

  // I-2: when storyboard has scenes[].shots[].prompt but editorModel clips are empty
  // (no legacy clips[] array), the main surface must still render — not fall back to
  // the "no clips" empty state.
  test("renders main surface with generationUnits even when editorModel clips are empty", () => {
    // storyboardDataNoScriptMatch uses shots-based storyboard (no clips[] array).
    // buildStoryboardEditorModel will derive synthetic clips from prompts — so clips
    // won't be empty here; the test validates the fast path via generationUnits.
    currentStoryboardData = storyboardDataNoScriptMatch;
    currentScriptData = {};
    currentTree = [{ path: "output/storyboard/approved/ep001_storyboard.json" }];

    const html = renderToStaticMarkup(
      React.createElement(StoryboardView, {
        projectName: "demo-project",
        path: "output/storyboard/approved/ep001_storyboard.json",
      }),
    );

    expect(html).toContain("生成视频 prompt");
    expect(html).not.toContain("当前故事板里还没有可浏览的镜头");
  });
});
