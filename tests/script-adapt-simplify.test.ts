// input: script-adapt skill after reference simplification
// output: Verifies deleted files are gone, surviving files contain expected content, no broken references
// pos: Integration test — validates 4-point simplification of NTS pipeline

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_DIR = path.resolve(
  "agents/screenwriter/.claude/skills/script-adapt",
);
const REFS_DIR = path.join(SKILL_DIR, "references");

// --- 1. Deleted files must not exist ---

const DELETED_REFS = ["phase3-extraction.md", "style-options.md"];

describe("script-adapt simplify: deleted references", () => {
  for (const file of DELETED_REFS) {
    it(`${file} is deleted`, async () => {
      const exists = await fs
        .access(path.join(REFS_DIR, file))
        .then(() => true)
        .catch(() => false);
      expect(exists, `${file} should NOT exist`).toBe(false);
    });
  }
});

// --- 2. Surviving reference files ---

const EXPECTED_REFS = [
  "phase1-design.md",
  "phase2-writing.md",
  "script-format.md",
  "shared-domain.md",
  "writing-rules.md",
];

describe("script-adapt simplify: surviving references", () => {
  it("has exactly 5 reference files", async () => {
    const entries = await fs.readdir(REFS_DIR);
    const mdFiles = entries.filter((e) => e.endsWith(".md")).sort();
    expect(mdFiles).toEqual(EXPECTED_REFS);
  });
});

// --- 3. style-options merged into phase1-design ---

describe("script-adapt simplify: style-options merged", () => {
  let phase1Content: string;

  it("phase1-design.md contains style options table", async () => {
    phase1Content = await fs.readFile(
      path.join(REFS_DIR, "phase1-design.md"),
      "utf-8",
    );
    // All 6 style names must appear
    expect(phase1Content).toContain("虐心催泪");
    expect(phase1Content).toContain("打脸逆袭");
    expect(phase1Content).toContain("甜宠撒糖");
    expect(phase1Content).toContain("权谋机锋");
    expect(phase1Content).toContain("悬疑钩子");
    expect(phase1Content).toContain("燃情热血");
  });

  it("phase1-design.md style field references the options", async () => {
    phase1Content ??= await fs.readFile(
      path.join(REFS_DIR, "phase1-design.md"),
      "utf-8",
    );
    expect(phase1Content).toMatch(/风格选项/);
  });
});

// --- 4. phase2-writing simplified ---

describe("script-adapt simplify: phase2-writing slimmed", () => {
  let phase2Content: string;

  it("uses references to writing-rules.md instead of inline rules", async () => {
    phase2Content = await fs.readFile(
      path.join(REFS_DIR, "phase2-writing.md"),
      "utf-8",
    );
    // Track 2 and 3 should reference sections, not inline the rules
    expect(phase2Content).toMatch(/writing-rules\.md`?\s*§2/);
    expect(phase2Content).toMatch(/writing-rules\.md`?\s*§1/);
  });

  it("has 7 checks not 9", async () => {
    phase2Content ??= await fs.readFile(
      path.join(REFS_DIR, "phase2-writing.md"),
      "utf-8",
    );
    expect(phase2Content).toContain("七项专项检查");
    expect(phase2Content).not.toContain("九项专项检查");
  });

  it("merged checks: 语言质量 and 写作规则合规 exist", async () => {
    phase2Content ??= await fs.readFile(
      path.join(REFS_DIR, "phase2-writing.md"),
      "utf-8",
    );
    expect(phase2Content).toContain("语言质量");
    expect(phase2Content).toContain("写作规则合规");
  });

  it("old separate checks are gone", async () => {
    phase2Content ??= await fs.readFile(
      path.join(REFS_DIR, "phase2-writing.md"),
      "utf-8",
    );
    // "去 AI 味" and "对白润色" should not appear as separate check names in the table
    // They are merged into "语言质量"
    const checkTable = phase2Content.slice(
      phase2Content.indexOf("七项专项检查"),
    );
    // Should not have a table row starting with "| N | 去 AI 味"
    expect(checkTable).not.toMatch(/\|\s*\d+\s*\|\s*去 AI 味\s*\|/);
    expect(checkTable).not.toMatch(/\|\s*\d+\s*\|\s*对白润色\s*\|/);
    expect(checkTable).not.toMatch(/\|\s*\d+\s*\|\s*节奏规则\s*\|/);
  });
});

// --- 5. SKILL.md reference loading table ---

describe("script-adapt simplify: SKILL.md consistency", () => {
  let skillContent: string;

  it("Phase 1 loads 2 files (not 3)", async () => {
    skillContent = await fs.readFile(
      path.join(SKILL_DIR, "SKILL.md"),
      "utf-8",
    );
    // Phase 1 row should have phase1-design.md and shared-domain.md, NOT style-options.md
    expect(skillContent).not.toContain("style-options.md");
  });

  it("Phase 3 has no reference files", async () => {
    skillContent ??= await fs.readFile(
      path.join(SKILL_DIR, "SKILL.md"),
      "utf-8",
    );
    // Phase 3 row should say "无" not "phase3-extraction.md"
    expect(skillContent).not.toContain("phase3-extraction.md");
    expect(skillContent).toMatch(/Phase 3.*无/);
  });

  it("Phase 3 section has anti-degradation constraint", async () => {
    skillContent ??= await fs.readFile(
      path.join(SKILL_DIR, "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("反降级约束");
    expect(skillContent).toContain("严禁");
  });

  it("does not reference any deleted files", async () => {
    skillContent ??= await fs.readFile(
      path.join(SKILL_DIR, "SKILL.md"),
      "utf-8",
    );
    for (const deleted of DELETED_REFS) {
      expect(
        skillContent,
        `SKILL.md should not reference ${deleted}`,
      ).not.toContain(deleted);
    }
  });
});

// --- 6. No cross-reference to deleted files in surviving references ---

describe("script-adapt simplify: no broken cross-references", () => {
  it("no surviving reference mentions deleted files", async () => {
    for (const ref of EXPECTED_REFS) {
      const content = await fs.readFile(path.join(REFS_DIR, ref), "utf-8");
      for (const deleted of DELETED_REFS) {
        expect(
          content,
          `${ref} should not reference ${deleted}`,
        ).not.toContain(deleted);
      }
    }
  });
});
