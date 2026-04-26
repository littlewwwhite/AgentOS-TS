// input: user message and active production object
// output: agent-facing message with explicit production scope
// pos: boundary that makes natural-language commands safer without changing chat transcript text

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
    "[Production Scope]",
    `Object: ${getProductionObjectLabel(object)}`,
    `Default scope: ${scope.defaultScope}`,
    `Affects: ${scope.affects.join(" / ") || "none"}`,
    `Preserve: ${scope.preserves.join(" / ") || "none"}`,
    `Lineage: ${lineage.join(" -> ")}`,
    "",
    "[User Request]",
    message,
  ].join("\n");
}
