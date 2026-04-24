import { describe, expect, test } from "bun:test";
import { buildWorkspaceSummary } from "../src/lib/workspaceSummary";
import type { TreeNode } from "../src/types";

describe("buildWorkspaceSummary", () => {
  test("summarizes artifact-first workspace folders for users", () => {
    const tree: TreeNode[] = [
      { path: "source.txt", name: "source.txt", type: "file" },
      { path: "input/novel.md", name: "novel.md", type: "file" },
      { path: "draft/design.json", name: "design.json", type: "file" },
      { path: "output/script.json", name: "script.json", type: "file" },
      { path: "pipeline-state.json", name: "pipeline-state.json", type: "file" },
    ];

    const summary = buildWorkspaceSummary("c1", tree);

    expect(summary.rootPath).toBe("workspace/c1");
    expect(summary.sourceFiles.map((file) => file.path)).toEqual(["source.txt", "input/novel.md"]);
    expect(summary.draftCount).toBe(1);
    expect(summary.outputCount).toBe(1);
    expect(summary.controlFiles.map((file) => file.path)).toEqual(["pipeline-state.json"]);
  });
});
