// input: Workspace path; project ID; review feedback text
// output: Persistent project memory as markdown; context strings for agent injection
// pos: Memory layer — accumulates reviewer preferences across sessions to improve agent behavior

import fs from "node:fs";
import path from "node:path";

export class ProjectMemory {
  private readonly baseDir: string;

  constructor(workspacePath: string) {
    // Store under <workspace>/.agentos/memory/<projectId>/preferences.md
    this.baseDir = path.join(workspacePath, ".agentos", "memory");
  }

  /**
   * Record a piece of reviewer feedback as a timestamped preference entry.
   * Appends to the project's preferences.md so history is preserved.
   */
  async recordFeedback(projectId: string, feedback: string): Promise<void> {
    const filePath = this.preferencesPath(projectId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const timestamp = new Date().toISOString();
    const entry = `\n## ${timestamp}\n\n${feedback.trim()}\n`;

    // Initialise file with header on first write
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        `# Project Preferences: ${projectId}\n\nReviewer feedback is accumulated here to guide future agent iterations.\n`,
        "utf8",
      );
    }

    fs.appendFileSync(filePath, entry, "utf8");
  }

  /**
   * Load the accumulated memory for a project as a formatted string
   * suitable for injection into an agent's system prompt.
   * Returns an empty string if no memory exists yet.
   */
  async getProjectContext(projectId: string): Promise<string> {
    const filePath = this.preferencesPath(projectId);

    if (!fs.existsSync(filePath)) {
      return "";
    }

    const content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) return "";

    return `<project_memory project_id="${projectId}">\n${content}\n</project_memory>`;
  }

  private preferencesPath(projectId: string): string {
    return path.join(this.baseDir, projectId, "preferences.md");
  }
}
