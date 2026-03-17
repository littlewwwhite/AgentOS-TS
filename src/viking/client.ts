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

export interface VikingFindOptions {
  targetUri?: string;
  limit?: number;
}

export interface VikingAddOptions {
  target?: string;
  reason?: string;
  wait?: boolean;
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
      await this.get("/health");
      return true;
    } catch {
      return false;
    }
  }

  /** Semantic search. Returns matching resources (empty array on none). */
  async find(
    query: string,
    options?: VikingFindOptions,
  ): Promise<VikingSearchResult[]> {
    const body: Record<string, unknown> = { query };
    if (options?.targetUri !== undefined) body.target_uri = options.targetUri;
    if (options?.limit !== undefined) body.limit = options.limit;
    const res = await this.post("/api/v1/search", body);
    const data = (await res.json()) as { result?: { resources?: VikingSearchResult[] } };
    return data.result?.resources ?? [];
  }

  /** Register a file path as a resource. */
  async addResource(
    path: string,
    options?: VikingAddOptions,
  ): Promise<VikingAddResult> {
    const body: Record<string, unknown> = { path };
    if (options?.target !== undefined) body.target = options.target;
    if (options?.reason !== undefined) body.reason = options.reason;
    if (options?.wait !== undefined) body.wait = options.wait;
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

  private async get(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Viking GET ${path}: HTTP ${res.status}`);
    return res;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Viking POST ${path}: HTTP ${res.status}`);
    return res;
  }
}
