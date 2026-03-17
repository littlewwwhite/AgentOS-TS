// input: VikingClient class + options from ./client.js
// output: Singleton lifecycle (initViking / getVikingClient / resetViking) + re-exports
// pos: Public barrel — all viking imports go through here

export { VikingClient } from "./client.js";
export type {
  VikingClientOptions,
  VikingSearchResult,
  VikingFsEntry,
  VikingAddResult,
} from "./client.js";

import { VikingClient, type VikingClientOptions } from "./client.js";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: VikingClient | null = null;

/**
 * Create the Viking singleton if it doesn't exist yet.
 * Subsequent calls return the same instance (options are ignored after first init).
 */
export function initViking(options?: Partial<VikingClientOptions>): VikingClient {
  if (instance) return instance;
  instance = new VikingClient({
    apiKey: options?.apiKey ?? process.env.OPENVIKING_API_KEY ?? "",
    agentId: options?.agentId ?? process.env.OPENVIKING_AGENT_ID ?? "agentos",
    url: options?.url,
    timeoutMs: options?.timeoutMs,
  });
  return instance;
}

/** Returns the singleton or null if not yet initialised. */
export function getVikingClient(): VikingClient | null {
  return instance;
}

/** Tear down the singleton (for tests / shutdown). */
export function resetViking(): void {
  instance = null;
}
