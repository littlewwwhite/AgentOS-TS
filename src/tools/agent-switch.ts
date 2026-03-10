// input: Shared mutable signal object
// output: MCP tools for LLM-driven agent switching
// pos: Communication bridge — LLM expresses intent, orchestrator executes switch

import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

// ---------- Signal ----------

export interface SwitchSignal {
  switchRequest: { agent: string; task: string } | null;
  returnRequest: { summary: string } | null;
}

export function createSwitchSignal(): SwitchSignal {
  return { switchRequest: null, returnRequest: null };
}

// ---------- Tools ----------

export function createSwitchToAgent(signal: SwitchSignal, agentNames: string[]) {
  return tool(
    "switch_to_agent",
    `Switch to a specialized agent. Available: ${agentNames.join(", ")}.\n` +
    "Use when user requests domain work that should be handled by a sub-agent.\n" +
    "The agent will receive the task and work in its own context with full history.",
    { agent: z.enum(agentNames as [string, ...string[]]), task: z.string() },
    async ({ agent, task }) => {
      signal.switchRequest = { agent, task };
      return { content: [{ type: "text" as const, text: `Switching to ${agent}...` }] };
    },
  );
}

export function createReturnToMain(signal: SwitchSignal) {
  return tool(
    "return_to_main",
    "Return to the main orchestrator after completing the assigned task.\n" +
    "ONLY call when you have produced concrete deliverables.\n" +
    "Do NOT call for: greetings, status checks, or incomplete work.",
    { summary: z.string().describe("Brief summary of what was accomplished") },
    async ({ summary }) => {
      signal.returnRequest = { summary };
      return { content: [{ type: "text" as const, text: "Returning to main..." }] };
    },
  );
}

// ---------- Dispatch Servers ----------

/** Create MCP servers for signal-driven dispatch.
 *  - masterServer: switch_to_agent only (for main orchestrator)
 *  - agentServer: return_to_main only (legacy, unused)
 *  - fullServer: both tools (for agents that can switch + return)
 */
export function createDispatchServers(signal: SwitchSignal, agentNames: string[]) {
  const switchTool = createSwitchToAgent(signal, agentNames);
  const returnTool = createReturnToMain(signal);
  return {
    masterServer: createSdkMcpServer({
      name: "switch",
      tools: [switchTool],
    }),
    agentServer: createSdkMcpServer({
      name: "switch",
      tools: [returnTool],
    }),
    fullServer: createSdkMcpServer({
      name: "switch",
      tools: [switchTool, returnTool],
    }),
  };
}
