import { describe, expect, test } from "bun:test";
import { viewerScrollResetKey } from "../src/components/Viewer/Viewer";

describe("viewer scroll reset key", () => {
  test("changes when switching projects or active workbench object", () => {
    const overview = { id: "tab-1", path: "", view: "overview" as const };

    expect(viewerScrollResetKey("demo", overview)).not.toBe(
      viewerScrollResetKey("c1", overview),
    );
    expect(viewerScrollResetKey("demo", overview)).not.toBe(
      viewerScrollResetKey("demo", { id: "tab-2", path: "source.txt", view: "text" as const }),
    );
  });

  test("can include overview state revisions so refreshed overview opens at the top", () => {
    const overview = { id: "tab-1", path: "", view: "overview" as const };

    expect(viewerScrollResetKey("demo", overview, "old")).not.toBe(
      viewerScrollResetKey("demo", overview, "new"),
    );
  });
});
