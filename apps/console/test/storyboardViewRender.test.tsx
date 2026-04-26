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

mock.module("../src/hooks/useEditableJson", () => ({
  useEditableJson: () => ({
    data: storyboardData,
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
    data: path === "output/script.json" ? scriptData : {},
  }),
}));

mock.module("../src/contexts/ProjectContext", () => ({
  useProject: () => ({
    tree: [{ path: "output/storyboard/approved/ep001_storyboard.json" }],
    refresh: () => undefined,
    state: { artifacts: {} },
  }),
}));

const { StoryboardView } = await import("../src/components/Viewer/views/StoryboardView");

describe("StoryboardView rendering", () => {
  test("renders storyboard generation units instead of the empty storyboard state", () => {
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
});
