import { describe, expect, test } from "bun:test";
import {
  STAGE_ORDER,
  STAGE_OWNER,
  MVP_STAGE_ORDER,
  nextStageName,
  isTerminalStageStatus,
} from "../src/lib/workflowModel";

describe("workflowModel", () => {
  test("exposes one canonical stage ordering", () => {
    expect(STAGE_ORDER).toEqual([
      "SCRIPT",
      "VISUAL",
      "STORYBOARD",
      "VIDEO",
      "EDITING",
      "MUSIC",
      "SUBTITLE",
    ]);

    expect(MVP_STAGE_ORDER).toEqual([
      "SCRIPT",
      "VISUAL",
      "STORYBOARD",
      "VIDEO",
    ]);
  });

  test("answers owner, next stage, and terminal status from the same model", () => {
    expect(STAGE_OWNER.SCRIPT).toBe("writer");
    expect(nextStageName("STORYBOARD")).toBe("VIDEO");
    expect(isTerminalStageStatus("approved")).toBe(true);
    expect(isTerminalStageStatus("running")).toBe(false);
  });
});
