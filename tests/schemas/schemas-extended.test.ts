// input: All schema definitions from schemas/
// output: Comprehensive tests for schema validation with edge cases
// pos: Unit test — validates all Zod schemas with valid, invalid, and boundary data

import { describe, it, expect } from "vitest";
import {
  DesignSchema,
  CatalogSchema,
  ScriptSchema,
  AssetManifestSchema,
  ProductionPlanSchema,
  TimelineSchema,
  schemaRegistry,
} from "../../src/schemas/index.js";

describe("schemaRegistry", () => {
  it("has all 6 expected entries", () => {
    const keys = Object.keys(schemaRegistry);
    expect(keys).toContain("design.json");
    expect(keys).toContain("catalog.json");
    expect(keys).toContain("script.json");
    expect(keys).toContain("assets/manifest.json");
    expect(keys).toContain("production/plan.json");
    expect(keys).toContain("output/timeline.json");
    expect(keys.length).toBe(6);
  });
});

describe("DesignSchema", () => {
  const validDesign = {
    title: "Test",
    worldview: "A world",
    style: "anime",
    total_episodes: 2,
    episodes: [
      {
        episode: 1,
        title: "Ep1",
        main_plot: "plot1",
        climax: "climax1",
        cliffhanger: "hook1",
        scenes: [
          { id: "scn_001", time: "day", setting: "int", location: "office", description: "desc" },
        ],
      },
      {
        episode: 2,
        title: "Ep2",
        main_plot: "plot2",
        climax: "climax2",
        cliffhanger: "hook2",
        scenes: [],
      },
    ],
  };

  it("accepts valid design", () => {
    const result = DesignSchema.safeParse(validDesign);
    expect(result.success).toBe(true);
  });

  it("accepts empty episodes array", () => {
    const result = DesignSchema.safeParse({
      ...validDesign,
      total_episodes: 0,
      episodes: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing title", () => {
    const { title: _, ...noTitle } = validDesign;
    const result = DesignSchema.safeParse(noTitle);
    expect(result.success).toBe(false);
  });

  it("rejects non-string title", () => {
    const result = DesignSchema.safeParse({ ...validDesign, title: 123 });
    expect(result.success).toBe(false);
  });

  it("total_episodes accepts any integer (no min constraint)", () => {
    // Schema uses z.number().int() — no explicit min constraint
    const result = DesignSchema.safeParse({ ...validDesign, total_episodes: -1 });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer total_episodes", () => {
    const result = DesignSchema.safeParse({ ...validDesign, total_episodes: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("CatalogSchema", () => {
  const validCatalog = {
    actors: [
      { id: "act_001", name: "Alice", description: "protagonist", visual_tags: ["blonde"] },
    ],
    locations: [
      { id: "loc_001", name: "Office", description: "modern", visual_tags: ["bright"] },
    ],
    props: [
      { id: "prp_001", name: "Sword", description: "ancient", visual_tags: ["glowing"] },
    ],
  };

  it("accepts valid catalog", () => {
    const result = CatalogSchema.safeParse(validCatalog);
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays", () => {
    const result = CatalogSchema.safeParse({
      actors: [],
      locations: [],
      props: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing actors", () => {
    const { actors: _, ...nope } = validCatalog;
    const result = CatalogSchema.safeParse(nope);
    expect(result.success).toBe(false);
  });

  it("rejects actor without id", () => {
    const result = CatalogSchema.safeParse({
      ...validCatalog,
      actors: [{ name: "Alice", description: "test", visual_tags: [] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("ScriptSchema", () => {
  const validScript = {
    title: "Test",
    actors: [{ id: "act_001", name: "Alice" }],
    locations: [{ id: "loc_001", name: "Office" }],
    props: [],
    episodes: [
      {
        episode: 1,
        title: "Ep1",
        scenes: [
          {
            id: "scn_001",
            sequence: 1,
            location: "Office",
            location_id: "loc_001",
            time_of_day: "day",
            cast: [{ actor_id: "act_001", state_id: null }],
            prop_ids: [],
            actions: [
              { sequence: 1, type: "dialogue", content: "Hello", actor_id: "act_001" },
            ],
          },
        ],
      },
    ],
  };

  it("accepts valid script", () => {
    const result = ScriptSchema.safeParse(validScript);
    expect(result.success).toBe(true);
  });

  it("accepts script with optional fields", () => {
    const result = ScriptSchema.safeParse({
      ...validScript,
      worldview: "fantasy",
      style: "anime",
      metadata: { version: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing episodes", () => {
    const { episodes: _, ...nope } = validScript;
    const result = ScriptSchema.safeParse(nope);
    expect(result.success).toBe(false);
  });

  it("action type is a free string (not enum-constrained)", () => {
    // ActionSchema.type is z.string() — accepts any string
    const result = ScriptSchema.safeParse({
      ...validScript,
      episodes: [{
        ...validScript.episodes[0],
        scenes: [{
          ...validScript.episodes[0].scenes[0],
          actions: [{ sequence: 1, type: "custom_type", content: "test" }],
        }],
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer action sequence", () => {
    const result = ScriptSchema.safeParse({
      ...validScript,
      episodes: [{
        ...validScript.episodes[0],
        scenes: [{
          ...validScript.episodes[0].scenes[0],
          actions: [{ sequence: 1.5, type: "dialogue", content: "test" }],
        }],
      }],
    });
    expect(result.success).toBe(false);
  });
});
