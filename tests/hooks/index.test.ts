import { describe, expect, it } from "vitest";

import { buildHooks } from "../../src/hooks/index.js";
import { schemaValidator } from "../../src/hooks/schema-validator.js";

describe("buildHooks", () => {
  it("returns SDK hook matchers for PreToolUse and PostToolUse", () => {
    const hooks = buildHooks();

    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PreToolUse?.[0]?.hooks).toHaveLength(2);
    expect(hooks.PostToolUse?.[0]?.hooks).toHaveLength(1);
  });

  it("does not register the custom cost guard hook", () => {
    const hooks = buildHooks();

    expect(hooks.PreToolUse?.[0]?.hooks).toEqual(
      expect.arrayContaining([schemaValidator]),
    );
    expect(hooks.PreToolUse?.[0]?.hooks).toHaveLength(2);
  });
});
