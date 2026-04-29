import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const storyboardData = {
  episode_id: "ep001",
  scenes: [
    {
      scene_id: "scn_001",
      actors: [{ actor_id: "act_001" }],
      shots: [
        {
          source_refs: [0],
          prompt: `PART1\n\n总体描述：废墟街道。\n\n{"shots":[{"shot_id":"S1","time_range":"00:00-00:05","camera_setup":"中景","beats":["林萧拖着废铁"]}]}`,
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
          actions: [{ type: "action", content: "林萧拖着废铁。" }],
        },
      ],
    },
  ],
  actors: [{ actor_id: "act_001", actor_name: "林萧" }],
};

let currentTree: unknown[] = [];
let currentStoryboardData: unknown = storyboardData;

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

mock.module("../src/contexts/ProjectContext", () => ({
  useProject: () => ({
    get tree() {
      return currentTree;
    },
    state: {
      artifacts: {},
      episodes: {
        ep001: {
          storyboard: { artifact: "output/storyboard/approved/ep001_storyboard.json" },
        },
      },
    },
    refresh: () => undefined,
  }),
}));

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
    get data() {
      if (path === "output/script.json") return scriptData;
      return {};
    },
  }),
}));

const { VideoGridView } = await import("../src/components/Viewer/views/VideoGridView");

describe("VideoGridView rendering", () => {
  test("renders review workbench when an episode storyboard exists", () => {
    currentTree = [
      { type: "file", name: "ep001_storyboard.json", path: "output/ep001/ep001_storyboard.json" },
      { type: "file", name: "ep001_scn001_clip001.mp4", path: "output/ep001/scn001/clip001/ep001_scn001_clip001.mp4" },
    ];
    currentStoryboardData = storyboardData;

    const html = renderToStaticMarkup(
      React.createElement(VideoGridView, {
        projectName: "demo-project",
        path: "output/ep001",
      }),
    );

    expect(html).toContain("资产库");
    expect(html).toContain("片段 1");
    expect(html).toContain("生成视频 prompt");
    expect(html).not.toContain("暂无视频文件");
  });

  test("falls back to file grid when no storyboard exists", () => {
    currentTree = [
      { type: "file", name: "a.mp4", path: "output/ep001/scn001/clip001/a.mp4" },
    ];
    currentStoryboardData = null;

    const html = renderToStaticMarkup(
      React.createElement(VideoGridView, {
        projectName: "demo-project",
        path: "output/ep001",
      }),
    );

    expect(html).toContain("未找到分镜结构，按文件展示视频");
    expect(html).toContain("output/ep001/scn001/clip001/a.mp4");
  });
});
