#!/usr/bin/env bun
// input: skills/ (submodule), agents/*.yaml (manifests with skills config)
// output: agents/{agent}/.claude/skills/{skill}/ (synced copies)
// pos: Build tool — syncs canonical skills into agent-local directories with path/tool transforms

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillOverride {
  "allowed-tools"?: string[];
}

interface AgentYaml {
  name: string;
  description: string;
  mcpServers?: string[];
  skills?: Record<string, SkillOverride | null>;
}

interface SyncAction {
  agent: string;
  skill: string;
  type: "copy" | "skip" | "remove";
  details?: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const AGENTS_DIR = path.join(ROOT, "agents");

// Directories to exclude from skill copy (not part of the skill itself)
const SKIP_ENTRIES = new Set([".git", "node_modules", "__pycache__", ".DS_Store", "CHANGELOG.md"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadAgentYamls(): Promise<AgentYaml[]> {
  const entries = await fs.readdir(AGENTS_DIR);
  const yamls: AgentYaml[] = [];

  for (const file of entries.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
    const text = await fs.readFile(path.join(AGENTS_DIR, file), "utf-8");
    const parsed = yaml.parse(text) as AgentYaml;
    if (parsed?.name && parsed.skills) {
      yamls.push(parsed);
    }
  }

  return yamls;
}

/**
 * Parse SKILL.md frontmatter (between `---` delimiters) and body.
 */
function parseFrontmatter(content: string): { frontmatter: string; body: string; raw: Record<string, unknown> } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: content, raw: {} };
  return {
    frontmatter: match[1],
    body: match[2],
    raw: yaml.parse(match[1]) as Record<string, unknown>,
  };
}

/**
 * Rebuild SKILL.md from parsed frontmatter object and body.
 */
function buildSkillMd(frontmatterObj: Record<string, unknown>, body: string): string {
  // Serialize frontmatter preserving key order
  const fm = yaml.stringify(frontmatterObj, { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n${body}`;
}

/**
 * Transform reference paths in SKILL.md body:
 *   references/X  →  ${CLAUDE_SKILL_DIR}/{name}-references/X
 *   ${CLAUDE_SKILL_DIR}/references/X  →  ${CLAUDE_SKILL_DIR}/{name}-references/X
 *
 * Avoids double-rewriting by using a negative lookbehind for [a-z0-9-],
 * which prevents matching `references/` inside `{name}-references/`.
 */
function rewriteReferencePaths(body: string, skillName: string): string {
  const prefixed = `\${CLAUDE_SKILL_DIR}/${skillName}-references/`;

  // Already fully qualified with skill-name prefix — no change needed
  if (body.includes(`${skillName}-references/`)) return body;

  // Replace ${CLAUDE_SKILL_DIR}/references/ first (exact string match)
  let result = body.replaceAll(
    "${CLAUDE_SKILL_DIR}/references/",
    prefixed,
  );

  // Replace bare references/ paths, but NOT when preceded by [a-z0-9-]
  // (avoids matching `{name}-references/` created by the step above)
  result = result.replaceAll(
    /(?<![a-z0-9-])references\//g,
    prefixed,
  );

  return result;
}

/**
 * Copy a directory recursively, skipping entries in SKIP_ENTRIES.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Remove a directory recursively (rm -rf equivalent).
 */
async function rmDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Compute a simple content hash for diff detection.
 */
async function fileContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── Core Sync Logic ──────────────────────────────────────────────────────────

async function syncSkill(
  agent: AgentYaml,
  skillName: string,
  override: SkillOverride | null,
  dryRun: boolean,
  diffMode: boolean,
): Promise<SyncAction> {
  const srcDir = path.join(SKILLS_DIR, skillName);
  const destDir = path.join(AGENTS_DIR, agent.name, ".claude", "skills", skillName);
  const refsName = `${skillName}-references`;

  // Verify source skill exists
  try {
    await fs.access(path.join(srcDir, "SKILL.md"));
  } catch {
    return { agent: agent.name, skill: skillName, type: "skip", details: "source SKILL.md not found" };
  }

  // Read and transform SKILL.md
  const srcContent = (await fs.readFile(path.join(srcDir, "SKILL.md"), "utf-8"));
  const { raw: fmObj, body } = parseFrontmatter(srcContent);

  // Apply allowed-tools override
  if (override?.["allowed-tools"]) {
    fmObj["allowed-tools"] = override["allowed-tools"];
  }

  // Rewrite reference paths in body
  const transformedBody = rewriteReferencePaths(body, skillName);
  const transformedContent = buildSkillMd(fmObj, transformedBody);

  if (diffMode) {
    const existing = await fileContent(path.join(destDir, "SKILL.md"));
    if (existing !== null && existing !== transformedContent) {
      console.log(`\n--- ${agent.name}/${skillName}/SKILL.md`);
      console.log("+++ (synced from skills/${skillName})");
      // Simple line-level diff display
      const oldLines = existing.split("\n");
      const newLines = transformedContent.split("\n");
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        const old = oldLines[i] ?? "";
        const cur = newLines[i] ?? "";
        if (old !== cur) {
          if (old) console.log(`  - L${i + 1}: ${old}`);
          if (cur) console.log(`  + L${i + 1}: ${cur}`);
        }
      }
    } else if (existing === null) {
      console.log(`  [NEW] ${agent.name}/${skillName}/SKILL.md`);
    } else {
      console.log(`  [OK]  ${agent.name}/${skillName}/SKILL.md (no changes)`);
    }
    return { agent: agent.name, skill: skillName, type: "copy", details: "diff shown" };
  }

  if (dryRun) {
    const existing = await fileContent(path.join(destDir, "SKILL.md"));
    const changed = existing !== transformedContent;
    console.log(`  [${changed ? "UPDATE" : "OK"}] ${agent.name}/${skillName}/SKILL.md`);
    return { agent: agent.name, skill: skillName, type: "copy", details: changed ? "would update" : "unchanged" };
  }

  // -- Actual sync --

  // Clean destination
  await rmDir(destDir);
  await fs.mkdir(destDir, { recursive: true });

  // Write transformed SKILL.md
  await fs.writeFile(path.join(destDir, "SKILL.md"), transformedContent, "utf-8");

  // Copy references/ → {name}-references/
  const srcRefs = path.join(srcDir, "references");
  try {
    await fs.access(srcRefs);
    await copyDir(srcRefs, path.join(destDir, refsName));
  } catch {
    // no references dir — that's fine
  }

  // Copy scripts/ as-is
  const srcScripts = path.join(srcDir, "scripts");
  try {
    await fs.access(srcScripts);
    await copyDir(srcScripts, path.join(destDir, "scripts"));
  } catch {
    // no scripts dir
  }

  // Copy assets/ as-is
  const srcAssets = path.join(srcDir, "assets");
  try {
    await fs.access(srcAssets);
    await copyDir(srcAssets, path.join(destDir, "assets"));
  } catch {
    // no assets dir
  }

  // Copy resources/ as-is (some skills like script-writer use this)
  const srcResources = path.join(srcDir, "resources");
  try {
    await fs.access(srcResources);
    await copyDir(srcResources, path.join(destDir, "resources"));
  } catch {
    // no resources dir
  }

  return { agent: agent.name, skill: skillName, type: "copy", details: "synced" };
}

/**
 * Remove skill directories from agents that are no longer declared in YAML.
 */
async function cleanOrphans(
  agent: AgentYaml,
  declaredSkills: Set<string>,
  dryRun: boolean,
): Promise<SyncAction[]> {
  const skillsDir = path.join(AGENTS_DIR, agent.name, ".claude", "skills");
  const actions: SyncAction[] = [];

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (declaredSkills.has(entry.name)) continue;

      if (dryRun) {
        console.log(`  [REMOVE] ${agent.name}/${entry.name}/ (orphan)`);
      } else {
        await rmDir(path.join(skillsDir, entry.name));
        console.log(`  Removed orphan: ${agent.name}/${entry.name}/`);
      }
      actions.push({ agent: agent.name, skill: entry.name, type: "remove", details: "orphan" });
    }
  } catch {
    // skills dir doesn't exist yet
  }

  return actions;
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const diffMode = args.includes("--diff");
  const filterAgent = args.find((a) => !a.startsWith("--"));

  console.log(`sync-skills: skills/ → agents/.claude/skills/`);
  if (dryRun) console.log("  Mode: dry-run (no changes)");
  if (diffMode) console.log("  Mode: diff (showing changes)");
  if (filterAgent) console.log(`  Filter: agent=${filterAgent}`);
  console.log();

  const agents = await loadAgentYamls();
  const allActions: SyncAction[] = [];

  for (const agent of agents) {
    if (filterAgent && agent.name !== filterAgent) continue;
    if (!agent.skills) {
      console.log(`[SKIP] ${agent.name}: no skills declared in YAML`);
      continue;
    }

    console.log(`[SYNC] ${agent.name}`);
    const skillEntries = Object.entries(agent.skills);
    const declaredSkills = new Set(skillEntries.map(([name]) => name));

    for (const [skillName, override] of skillEntries) {
      const action = await syncSkill(agent, skillName, override, dryRun, diffMode);
      allActions.push(action);
    }

    // Clean orphan skills (in agent but not in YAML)
    const orphans = await cleanOrphans(agent, declaredSkills, dryRun || diffMode);
    allActions.push(...orphans);
  }

  // Summary
  const synced = allActions.filter((a) => a.type === "copy").length;
  const removed = allActions.filter((a) => a.type === "remove").length;
  const skipped = allActions.filter((a) => a.type === "skip").length;
  console.log(`\nDone: ${synced} synced, ${removed} removed, ${skipped} skipped`);

  if (skipped > 0) {
    console.log("\nWarnings:");
    for (const a of allActions.filter((a) => a.type === "skip")) {
      console.log(`  ${a.agent}/${a.skill}: ${a.details}`);
    }
  }
}

main().catch((err) => {
  console.error("sync-skills failed:", err);
  process.exit(1);
});
