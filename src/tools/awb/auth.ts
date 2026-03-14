// input: AWB refreshToken (SID) from ~/.animeworkbench_auth.json
// output: JWT token, userId, groupId for AWB API calls
// pos: Auth infrastructure for all AWB MCP tools — token lifecycle, config I/O, generic API request

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://animeworkbench-pre.lingjingai.cn";
const CONFIG_PATH = path.join(os.homedir(), ".animeworkbench_auth.json");
const TOKEN_MARGIN_MS = 60_000; // Refresh when less than 60s remaining

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

export interface AwbConfig {
  refreshToken: string;
  groupId?: string;
  token?: string;
  expiresAt?: number;
}

export function loadConfig(): AwbConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `AWB config not found at ${CONFIG_PATH}. Run awb_login first.`,
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as AwbConfig;
}

export function saveConfig(config: AwbConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// JWT helpers (decode only, no verification)
// ---------------------------------------------------------------------------

export interface JwtPayload {
  userId?: string;
  groupId?: string;
  userName?: string;
  exp?: number;
  [key: string]: unknown;
}

export function parseJwt(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT format");
  // Base64url → Base64, then decode
  const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(payload, "base64").toString("utf-8");
  return JSON.parse(json) as JwtPayload;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function callRefreshToken(
  baseUrl: string,
  sid: string,
  lastToken?: string,
): Promise<{ token: string; expiresAt: number }> {
  const url = `${baseUrl}/api/anime/user/account/refreshToken`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Attach stale token so server can resolve groupId from it
  if (lastToken) headers["Authorization"] = `Bearer ${lastToken}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ refreshToken: sid }),
  });

  if (!resp.ok) {
    throw new Error(`refreshToken HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = (await resp.json()) as {
    code: number;
    msg?: string;
    data?: { token: string; expireTime: number };
  };

  if (json.code !== 200 || !json.data) {
    throw new Error(
      `refreshToken failed: code=${json.code} msg=${json.msg ?? "unknown"}`,
    );
  }

  return { token: json.data.token, expiresAt: json.data.expireTime };
}

// ---------------------------------------------------------------------------
// getToken — cached, auto-refresh
// ---------------------------------------------------------------------------

export async function getToken(
  baseUrl: string = resolveBaseUrl(),
  forceRefresh = false,
): Promise<string> {
  const config = loadConfig();

  // Return cached token if still valid
  if (
    !forceRefresh &&
    config.token &&
    config.expiresAt &&
    config.expiresAt - Date.now() > TOKEN_MARGIN_MS
  ) {
    return config.token;
  }

  // Refresh
  const { token, expiresAt } = await callRefreshToken(
    baseUrl,
    config.refreshToken,
    config.token ?? undefined,
  );
  config.token = token;
  config.expiresAt = expiresAt;
  saveConfig(config);
  return token;
}

// ---------------------------------------------------------------------------
// getUserInfo
// ---------------------------------------------------------------------------

export interface UserInfo {
  token: string;
  userId: string;
  groupId: string;
  userName: string;
}

export async function getUserInfo(
  baseUrl: string = resolveBaseUrl(),
  forceRefresh = false,
): Promise<UserInfo> {
  const token = await getToken(baseUrl, forceRefresh);
  const jwt = parseJwt(token);
  const config = loadConfig();

  return {
    token,
    userId: jwt.userId ?? "",
    groupId: config.groupId ?? jwt.groupId ?? "",
    userName: jwt.userName ?? "",
  };
}

// ---------------------------------------------------------------------------
// apiRequest — generic AWB API call with 701 auto-refresh & retry
// ---------------------------------------------------------------------------

export interface ApiResponse {
  code: number;
  msg?: string;
  data?: unknown;
}

export async function apiRequest(
  url: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    baseUrl?: string;
    extraHeaders?: Record<string, string>;
    maxRetries?: number;
  } = {},
): Promise<ApiResponse> {
  const {
    method = "GET",
    body,
    extraHeaders,
    maxRetries = 3,
  } = opts;
  const baseUrl = opts.baseUrl ?? resolveBaseUrl();
  let token = opts.token ?? (await getToken(baseUrl));

  const doFetch = async (t: string): Promise<ApiResponse> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${t}`,
      ...extraHeaders,
    };
    const fetchOpts: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchOpts.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await fetch(url, fetchOpts);
        if (!resp.ok) {
          throw new Error(
            `HTTP ${resp.status}: ${await resp.text()}`,
          );
        }
        return (await resp.json()) as ApiResponse;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxRetries - 1) {
          await sleep(2000);
        }
      }
    }
    throw lastError!;
  };

  const result = await doFetch(token);

  // code 701 = token expired, refresh once and retry
  if (result.code === 701) {
    token = await getToken(baseUrl, true);
    return doFetch(token);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveBaseUrl(override?: string): string {
  return override ?? process.env["AWB_BASE_URL"] ?? DEFAULT_BASE_URL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
