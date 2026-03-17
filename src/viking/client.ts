// input: OPENVIKING_URL env var, fetch API
// output: VikingClient class + request/response interfaces
// pos: Lightweight HTTP client for OpenViking REST API — reusable by MCP tools and orchestrator

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface VikingClientOptions {
  /** Server URL. Falls back to OPENVIKING_URL env, then http://localhost:1933 */
  url?: string;
  apiKey: string;
  agentId: string;
  /** Request timeout in milliseconds (default 10 000) */
  timeoutMs?: number;
}

export interface VikingSearchResult {
  uri: string;
  score: number;
  content: string;
}

export interface VikingFsEntry {
  name: string;
  type: string;
  uri: string;
}

export interface VikingAddResult {
  uri: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class VikingClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  private readonly apiKey: string;
  private readonly agentId: string;

  constructor(opts: VikingClientOptions) {
    this.baseUrl =
      opts.url ?? process.env.OPENVIKING_URL ?? "http://localhost:1933";
    this.apiKey = opts.apiKey;
    this.agentId = opts.agentId;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  // ---- public API --------------------------------------------------------

  /** Returns true if the server is reachable, false on any error. */
  async health(): Promise<boolean> {
    try {
      const res = await this.get("/health");
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Semantic search. Returns matching resources (empty array on none). */
  async find(
    query: string,
    options?: Record<string, unknown>,
  ): Promise<VikingSearchResult[]> {
    const body = { query, ...options };
    const res = await this.post("/api/v1/search", body);
    const data = (await res.json()) as { result?: { resources?: VikingSearchResult[] } };
    return data.result?.resources ?? [];
  }

  /** Register a file path as a resource. */
  async addResource(
    path: string,
    options?: Record<string, unknown>,
  ): Promise<VikingAddResult> {
    const body = { path, ...options };
    const res = await this.post("/api/v1/resources", body);
    return (await res.json()) as VikingAddResult;
  }

  /** List filesystem entries under a URI. */
  async ls(uri: string): Promise<VikingFsEntry[]> {
    const res = await this.get(
      `/api/v1/fs/ls?uri=${encodeURIComponent(uri)}`,
    );
    return (await res.json()) as VikingFsEntry[];
  }

  // ---- internals ---------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
      "X-Agent-Id": this.agentId,
    };
  }

  private get(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
