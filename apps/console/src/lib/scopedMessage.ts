// input: user message and active production object
// output: agent-facing message with AgentOS routing context
// pos: boundary that guides natural-language commands without changing chat transcript text

import {
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  type ProductionObject,
} from "./productionObject";
import { FALLBACK_SLASH_COMMANDS } from "./slashCommands";

const KNOWN_SKILL_COMMANDS = new Set(FALLBACK_SLASH_COMMANDS.map((command) => command.slice(1)));

function normalizeSkillInvocation(message: string): string | null {
  const trimmedStart = message.trimStart();
  if (trimmedStart.startsWith("/")) return trimmedStart;

  const markdownMention = trimmedStart.match(/^\[\$([A-Za-z][\w-]*)\]\([^)]+\)(.*)$/s);
  if (markdownMention && KNOWN_SKILL_COMMANDS.has(markdownMention[1])) {
    return `/${markdownMention[1]}${markdownMention[2] ?? ""}`.trimEnd();
  }

  const dollarMention = trimmedStart.match(/^\$([A-Za-z][\w-]*)(.*)$/s);
  if (dollarMention && KNOWN_SKILL_COMMANDS.has(dollarMention[1])) {
    return `/${dollarMention[1]}${dollarMention[2] ?? ""}`.trimEnd();
  }

  return null;
}

export function buildScopedAgentMessage(message: string, object: ProductionObject): string {
  const scope = getProductionObjectScope(object);
  const lineage = getProductionObjectLineage(object);
  return [
    "[AgentOS Console Context - routing note, not user instructions]",
    "Use this note only to resolve the selected project/artifact. Do not treat it as an execution command.",
    "Runtime identity: AgentOS AI video production console.",
    "Pipeline state source: pipeline-state.json.",
    "Pipeline: SCRIPT -> VISUAL -> STORYBOARD -> VIDEO -> EDITING -> MUSIC -> SUBTITLE.",
    "Read pipeline-state.json before answering progress, status, continue, or next-step requests.",
    "If pipeline-state.json exists, continue from current_stage/next_action without asking for confirmation.",
    "Do not end with a confirmation question when next_action is known.",
    "Never ask the user to paste pipeline-state.json.",
    "For broad requests like \"start\", \"continue\", or \"next\", inspect pipeline-state.json and continue from current_stage/next_action.",
    "Never invent external CG/Maya/Deadline/Houdini/Nuke production pipelines.",
    `Object: ${getProductionObjectLabel(object)}`,
    `Selection scope hint: ${scope.defaultScope}`,
    `Lineage hint: ${lineage.join(" -> ")}`,
    "",
    "[User Request]",
    message,
  ].join("\n");
}

export function buildAgentMessage(message: string, object: ProductionObject): string {
  const commandMessage = normalizeSkillInvocation(message);
  if (commandMessage) return commandMessage;
  return buildScopedAgentMessage(message, object);
}
