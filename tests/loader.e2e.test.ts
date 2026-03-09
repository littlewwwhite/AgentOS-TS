// E2E validation: real agent YAML → loader → permissions enforcement
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { loadAgentConfigs, loadSkillContents } from "../src/loader.js";
import { buildAgents } from "../src/agents.js";
import { createCanUseTool, type AgentFilePolicy } from "../src/permissions.js";

const AGENTS_DIR = path.resolve("agents");
const SKILLS_DIR = path.resolve("skills");
const hasAgents = await fs.access(AGENTS_DIR).then(() => true).catch(() => false);
const hasSkills = await fs.access(SKILLS_DIR).then(() => true).catch(() => false);

// Simulate a real workspace root for permission testing
const WORKSPACE = "/workspace/test-project";

// --- Helper: build canUseTool from real agent YAMLs ---

async function buildCanUseTool() {
  const agentConfigs = await loadAgentConfigs(AGENTS_DIR);
  const policies: Record<string, AgentFilePolicy> = {};
  for (const [name, config] of Object.entries(agentConfigs)) {
    if (config.filePolicy) policies[name] = config.filePolicy;
  }
  return { canUseTool: createCanUseTool(WORKSPACE, policies), agentConfigs };
}

// --- Tests ---

describe.skipIf(!hasAgents)("agent isolation E2E — real YAML → canUseTool enforcement", () => {

  // ===== screenwriter =====

  describe("screenwriter", () => {
    it("can write draft/** and output/script.json", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "screenwriter" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/draft/ep01.md` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/draft/episodes/ep01.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/output/script.json` }, agent)).behavior).toBe("allow");
    });

    it("cannot write assets/** or production/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "screenwriter" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/assets/hero.png` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/production/video.mp4` }, agent)).behavior).toBe("deny");
    });

    it("can read source.txt and draft/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "screenwriter" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/source.txt` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/draft/outline.md` }, agent)).behavior).toBe("allow");
    });

    it("cannot read assets/** or production/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "screenwriter" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/assets/hero.png` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/production/video.mp4` }, agent)).behavior).toBe("deny");
    });
  });

  // ===== art-director =====

  describe("art-director", () => {
    it("can write assets/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "art-director" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/assets/hero.png` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/assets/scenes/bg.jpg` }, agent)).behavior).toBe("allow");
    });

    it("cannot write draft/** or production/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "art-director" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/draft/ep01.md` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/production/video.mp4` }, agent)).behavior).toBe("deny");
    });

    it("can read output/script.json, draft/catalog.json, assets/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "art-director" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/output/script.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/draft/catalog.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/assets/manifest.json` }, agent)).behavior).toBe("allow");
    });

    it("cannot read draft/ep01.md or source.txt", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "art-director" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/draft/ep01.md` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/source.txt` }, agent)).behavior).toBe("deny");
    });

    it("Bash writes to assets/** are allowed", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "art-director" };

      expect((await canUseTool("Bash", { command: "cp tmp.png assets/hero.png" }, agent)).behavior).toBe("allow");
    });

    it("Bash writes outside assets/** are denied", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "art-director" };

      expect((await canUseTool("Bash", { command: "echo x > draft/hack.txt" }, agent)).behavior).toBe("deny");
    });
  });

  // ===== video-producer =====

  describe("video-producer", () => {
    it("can write production/** only", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "video-producer" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/production/ep01.mp4` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/assets/hero.png` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/draft/ep01.md` }, agent)).behavior).toBe("deny");
    });

    it("can read output/script.json, assets/**, storyboard/**, production/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "video-producer" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/output/script.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/assets/hero.png` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/storyboard/ep01.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/production/ep01.mp4` }, agent)).behavior).toBe("allow");
    });

    it("Bash writes to production/** are allowed", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "video-producer" };

      expect((await canUseTool("Bash", { command: "mv tmp.mp4 production/ep01.mp4" }, agent)).behavior).toBe("allow");
    });

    it("Bash writes outside production/** are denied", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "video-producer" };

      expect((await canUseTool("Bash", { command: "rm assets/hero.png" }, agent)).behavior).toBe("deny");
    });
  });

  // ===== post-production =====

  describe("post-production", () => {
    it("can write editing/audio_plan.json and audio/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "post-production" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/editing/audio_plan.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/audio/bgm.mp3` }, agent)).behavior).toBe("allow");
    });

    it("cannot write editing/video.json or production/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "post-production" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/editing/video.json` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/production/ep01.mp4` }, agent)).behavior).toBe("deny");
    });

    it("can read output/script.json, editing/**, audio/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "post-production" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/output/script.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/editing/timeline.json` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/audio/bgm.mp3` }, agent)).behavior).toBe("allow");
    });

    it("cannot read assets/** or draft/**", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "post-production" };

      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/assets/hero.png` }, agent)).behavior).toBe("deny");
      expect((await canUseTool("Read", { file_path: `${WORKSPACE}/draft/ep01.md` }, agent)).behavior).toBe("deny");
    });
  });

  // ===== skill-creator (no file-policy) =====

  describe("skill-creator (unrestricted within workspace)", () => {
    it("can write anywhere inside workspace", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "skill-creator" };

      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/any/path.txt` }, agent)).behavior).toBe("allow");
      expect((await canUseTool("Write", { file_path: `${WORKSPACE}/draft/ep01.md` }, agent)).behavior).toBe("allow");
    });

    it("cannot write outside workspace", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "skill-creator" };

      expect((await canUseTool("Write", { file_path: "/etc/passwd" }, agent)).behavior).toBe("deny");
    });

    it("Bash cannot write outside workspace", async () => {
      const { canUseTool } = await buildCanUseTool();
      const agent = { agentID: "skill-creator" };

      expect((await canUseTool("Bash", { command: "echo x > /tmp/leak.txt" }, agent)).behavior).toBe("deny");
    });
  });

  // ===== Cross-cutting: workspace escape =====

  describe("workspace escape prevention (all agents)", () => {
    it("denies Write outside workspace for restricted agents", async () => {
      const { canUseTool } = await buildCanUseTool();

      for (const name of ["screenwriter", "art-director", "video-producer", "post-production"]) {
        const result = await canUseTool("Write", { file_path: "/etc/passwd" }, { agentID: name });
        expect(result.behavior, `${name} should not escape workspace via Write`).toBe("deny");
      }
    });

    it("denies Bash writes outside workspace for restricted agents", async () => {
      const { canUseTool } = await buildCanUseTool();

      for (const name of ["art-director", "video-producer", "post-production"]) {
        const result = await canUseTool("Bash", { command: "cp secret.txt /tmp/stolen.txt" }, { agentID: name });
        expect(result.behavior, `${name} should not escape workspace via Bash`).toBe("deny");
      }
    });

    it("denies path traversal via ../", async () => {
      const { canUseTool } = await buildCanUseTool();

      const result = await canUseTool(
        "Write",
        { file_path: `${WORKSPACE}/../../../etc/passwd` },
        { agentID: "screenwriter" },
      );
      expect(result.behavior).toBe("deny");
    });
  });
});

// --- Build integration ---

describe.skipIf(!hasAgents || !hasSkills)("loader E2E — buildAgents", () => {
  it("can build agent definitions from loaded configs and skills", async () => {
    const agentConfigs = await loadAgentConfigs(AGENTS_DIR);
    const skillContents = await loadSkillContents(SKILLS_DIR);
    const agents = buildAgents(agentConfigs, skillContents, {
      storage: {},
      image: {},
      video: {},
      audio: {},
      script: {},
    });

    expect(Object.keys(agents).length).toBe(Object.keys(agentConfigs).length);

    for (const [, agent] of Object.entries(agents)) {
      expect(agent.description.length).toBeGreaterThan(0);
      expect(agent.prompt.length).toBeGreaterThan(0);
      expect(agent.maxTurns).toBeGreaterThan(0);
    }
  });
});
