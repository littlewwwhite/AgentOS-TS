import { describe, expect, test } from "bun:test";
import { validateEditableArtifact } from "../src/lib/artifactValidators";

describe("validateEditableArtifact", () => {
  test("accepts minimal valid design.json", () => {
    const result = validateEditableArtifact("draft/design.json", {
      title: "测试项目",
      total_episodes: 10,
      episodes: [{ episode: 1, title: "第一集" }],
    });

    expect(result.ok).toBe(true);
  });

  test("accepts minimal valid catalog.json", () => {
    const result = validateEditableArtifact("draft/catalog.json", {
      actors: [{ name: "白行风" }],
      locations: [{ name: "灵霜寝宫" }],
      props: [{ name: "轮椅" }],
    });

    expect(result.ok).toBe(true);
  });

  test("does not require catalog ids because parser owns id assignment", () => {
    const result = validateEditableArtifact("draft/catalog.json", {
      actors: [{ name: "白行风", aliases: ["男主"] }],
      locations: [{ name: "灵霜寝宫" }],
      props: [{ name: "轮椅" }],
    });

    expect(result.ok).toBe(true);
  });

  test("rejects script.json without episode ids", () => {
    const result = validateEditableArtifact("output/script.json", {
      episodes: [{ scenes: [] }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("episode_id");
    }
  });

  test("rejects draft storyboard without prompt fields", () => {
    const result = validateEditableArtifact("output/storyboard/draft/ep001_storyboard.json", {
      episode_id: "ep001",
      status: "draft",
      scenes: [
        {
          scene_id: "scn_001",
          shots: [{ source_refs: ["beat_001"] }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("prompt");
    }
  });

  test("accepts episode-level draft storyboard", () => {
    const result = validateEditableArtifact("output/storyboard/draft/ep001_storyboard.json", {
      episode_id: "ep001",
      status: "draft",
      scenes: [
        {
          scene_id: "scn_001",
          shots: [{ source_refs: ["beat_001"], prompt: "镜头提示词" }],
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  test("accepts minimal runtime storyboard", () => {
    const result = validateEditableArtifact("output/ep001/ep001_storyboard.json", {
      episode_id: "ep_001",
      scenes: [
        {
          scene_id: "scn_001",
          clips: [
            {
              clip_id: "clip_001",
              shots: [{ shot_id: "shot_001", partial_prompt: "镜头提示词" }],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
  });
});
