import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PipelineState, TreeNode } from "../src/types";

const baseState: PipelineState = {
  version: 1,
  updated_at: "2026-04-26T12:00:00Z",
  current_stage: "VIDEO",
  next_action: "review storyboard blockers",
  last_error: null,
  stages: {
    SCRIPT: { status: "validated", artifacts: ["output/script.json"] },
    VISUAL: { status: "validated", artifacts: ["output/actors/actors.json"] },
    STORYBOARD: { status: "stale", artifacts: [] },
    VIDEO: { status: "not_started", artifacts: [] },
  },
  episodes: {
    ep001: {
      storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
      video: { status: "not_started" },
      editing: { status: "not_started" },
      music: { status: "not_started" },
      subtitle: { status: "not_started" },
    },
  },
  artifacts: {
    "output/script.json": {
      kind: "canonical",
      owner_role: "screenwriter",
      status: "approved",
      editable: true,
      revision: 1,
      depends_on: [],
      invalidates: [],
    },
  },
  change_requests: [],
};

const baseTree: TreeNode[] = [
  { path: "source.txt", name: "source.txt", type: "file", size: 128 },
  { path: "pipeline-state.json", name: "pipeline-state.json", type: "file", size: 256 },
  { path: "output/script.json", name: "script.json", type: "file", size: 512 },
];

const projectContext = {
  current: {
    name: "demo-project",
    state: baseState,
    tree: baseTree,
    refresh: () => undefined,
  },
};

const tabsContext = {
  current: {
    openPath: mock(() => undefined),
  },
};

mock.module("../src/contexts/ProjectContext", () => ({
  useProject: () => projectContext.current,
}));

mock.module("../src/contexts/TabsContext", () => ({
  useTabs: () => tabsContext.current,
}));

const {
  OverviewView,
  ProductionInboxPanel,
  WorkflowProgressStrip,
} = await import("../src/components/Viewer/views/OverviewView");

describe("OverviewView chrome", () => {
  test("renders current MVP workflow strip without post-production stages", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowProgressStrip, {
        items: [
          { key: "SCRIPT", label: "剧本", state: "current" },
          { key: "VISUAL", label: "素材", state: "idle" },
          { key: "STORYBOARD", label: "分镜", state: "idle" },
          { key: "VIDEO", label: "视频", state: "idle" },
        ],
      }),
    );

    expect(html).not.toContain("输入");
    expect(html).toContain("剧本");
    expect(html).toContain("分镜");
    expect(html).toContain("视频");
    expect(html).not.toContain("剪辑");
  });

  test("renders production inbox before passive workflow status", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionInboxPanel, {
        items: [
          {
            key: "cr_001",
            kind: "change_request",
            priority: "blocked",
            cta: "去返修",
            stage: "STORYBOARD",
            title: "返修 STORYBOARD",
            reason: "镜头节奏过慢",
            path: "output/storyboard/approved/ep001_storyboard.json",
            status: "change_requested",
          },
        ],
        onOpen: () => undefined,
      }),
    );

    expect(html).toContain("Production Inbox");
    expect(html).toContain("返修 STORYBOARD");
    expect(html).toContain("镜头节奏过慢");
    expect(html).toContain("去返修");
  });

  test("renders inert inbox items as status text when no entry path exists", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionInboxPanel, {
        items: [
          {
            key: "stale:STORYBOARD",
            kind: "stale",
            priority: "blocked",
            cta: "重新生成",
            stage: "STORYBOARD",
            title: "重新生成 STORYBOARD",
            reason: "STORYBOARD 已因上游变化失效，不能继续使用旧结果。",
            status: "stale",
          },
        ],
        onOpen: () => undefined,
      }),
    );

    expect(html).toContain("等待产物入口");
    expect(html).not.toContain(">重新生成<");
  });

  test("renders OverviewView with inbox before workflow and workspace after detailed queues", () => {
    projectContext.current = {
      name: "demo-project",
      state: baseState,
      tree: baseTree,
      refresh: () => undefined,
    };
    tabsContext.current.openPath.mockClear();

    const html = renderToStaticMarkup(React.createElement(OverviewView));

    const inboxIndex = html.indexOf("Production Inbox");
    const workflowIndex = html.indexOf("当前流程状态");
    const reviewQueueIndex = html.indexOf("待审核");
    const changeQueueIndex = html.indexOf("返修队列");
    const staleQueueIndex = html.indexOf("失效队列");
    const workspaceIndex = html.indexOf("工作区");

    expect(inboxIndex).toBeGreaterThanOrEqual(0);
    expect(workflowIndex).toBeGreaterThan(inboxIndex);
    expect(reviewQueueIndex).toBeGreaterThan(workflowIndex);
    expect(changeQueueIndex).toBeGreaterThan(reviewQueueIndex);
    expect(staleQueueIndex).toBeGreaterThan(changeQueueIndex);
    expect(workspaceIndex).toBeGreaterThan(staleQueueIndex);
  });
});
