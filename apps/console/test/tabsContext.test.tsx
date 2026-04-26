import { describe, expect, test } from "bun:test";
import { reduceSingleWorkbenchTabs } from "../src/contexts/TabsContext";
import type { Tab } from "../src/types";

describe("TabsContext", () => {
  test("opening pinned objects replaces the single workbench instead of accumulating tabs", () => {
    const script: Tab = { id: "script", path: "output/script.json", title: "剧本", view: "script", pinned: true };
    const episode: Tab = { id: "episode", path: "draft/episodes/ep007.md", title: "ep007", view: "text", pinned: true };

    const first = reduceSingleWorkbenchTabs([], script);
    const second = reduceSingleWorkbenchTabs(first, episode);

    expect(second).toEqual([episode]);
  });
});
