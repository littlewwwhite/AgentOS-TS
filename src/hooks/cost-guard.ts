// input: PreToolUse events (all tools)
// output: Allow or deny based on budget limits
// pos: Cost boundary — placeholder for future per-session budget tracking

import type { PreToolUseHook } from "./types.js";

export const costGuard: PreToolUseHook = async (_input) => {
  // Placeholder: future implementation will track token/API usage per session
  return {};
};
