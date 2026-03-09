// input: CLI arguments + .env file
// output: Starts REPL session via orchestrator
// pos: Application entry point — loads env, resolves config, delegates to REPL

import fs from "node:fs/promises";
import path from "node:path";
import { repl } from "./orchestrator.js";
import { loadEnvToProcess } from "./env.js";

// ---------- CLI config ----------

interface CliConfig {
  projectName?: string;
  inspiration?: string;
  agentsDir: string;
  skillsDir: string;
  model?: string;
  resume?: string;
  continueConversation: boolean;
}

function parseArgs(argv: string[]): CliConfig | "help" {
  const positional: string[] = [];
  let resume: string | undefined;
  let continueConversation = false;
  let model: string | undefined;
  let agentsDir = "agents";
  let skillsDir = "skills";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--resume" && i + 1 < argv.length) resume = argv[++i];
    else if (arg === "--continue" || arg === "-c") continueConversation = true;
    else if (arg === "--model" && i + 1 < argv.length) model = argv[++i];
    else if (arg === "--agents" && i + 1 < argv.length) agentsDir = argv[++i];
    else if (arg === "--skills" && i + 1 < argv.length) skillsDir = argv[++i];
    else if (arg === "--help" || arg === "-h") return "help";
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  return {
    projectName: positional[0],
    agentsDir,
    skillsDir,
    model: model ?? process.env.AGENTOS_MODEL,
    resume,
    continueConversation,
    // inspirationFile deferred — read in main()
    inspiration: positional[1], // temporarily holds file path
  };
}

const HELP = `Usage: agentos [project-name] [source-file] [options]

Options:
  --resume <id>    Resume a previous session by ID
  --continue, -c   Continue last session for this project
  --model <model>  Override model (env: AGENTOS_MODEL)
  --agents <dir>   Agents directory (default: agents)
  --skills <dir>   Skills directory (default: skills)
  -h, --help       Show this help`;

async function main(): Promise<void> {
  // Load .env before anything else
  loadEnvToProcess(path.resolve(".env"));

  const config = parseArgs(process.argv.slice(2));
  if (config === "help") {
    console.log(HELP);
    process.exit(0);
  }

  // Resolve inspiration file → content
  if (config.inspiration) {
    const filePath = config.inspiration;
    try {
      config.inspiration = await fs.readFile(filePath, "utf-8");
    } catch {
      console.error(`Cannot read source file: ${filePath}`);
      process.exit(1);
    }
  }

  await repl(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
