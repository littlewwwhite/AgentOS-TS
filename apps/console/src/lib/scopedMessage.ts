// input: user message and active production object
// output: agent-facing message with AgentOS routing context
// pos: boundary that guides natural-language commands without changing chat transcript text

import {
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  type ProductionObject,
} from "./productionObject";

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
  const trimmedStart = message.trimStart();
  if (trimmedStart.startsWith("/")) return trimmedStart;
  return buildScopedAgentMessage(message, object);
}
