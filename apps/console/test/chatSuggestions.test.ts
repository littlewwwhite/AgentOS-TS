import { describe, expect, test } from "bun:test";
import { buildChatSuggestions } from "../src/lib/chatSuggestions";

describe("buildChatSuggestions", () => {
  test("suggests bootstrap commands when no project is selected", () => {
    const suggestions = buildChatSuggestions({ hasProject: false });
    expect(suggestions[0]).toContain("新建项目");
  });

  test("suggests continuation commands from current state", () => {
    const suggestions = buildChatSuggestions({
      hasProject: true,
      workflowTone: "review",
      currentStage: "SCRIPT",
    });
    expect(suggestions[0]).toContain("审核");
  });
});
