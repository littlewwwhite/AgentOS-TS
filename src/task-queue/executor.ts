// input: API configs from registry, task params from queue
// output: External API interactions (submit, poll, download)
// pos: Execution layer — bridges task queue with external API providers

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import type { ApiConfig } from "./registry.js";

export interface PollResult {
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface TaskExecutor {
  /** Submit task to external API, return external ID for tracking. */
  submit(params: Record<string, unknown>): Promise<string>;

  /** Poll external API for task status by external ID. */
  poll(externalId: string): Promise<PollResult>;

  /** Download result artifacts to local path. */
  download(result: Record<string, unknown>, destPath: string): Promise<string[]>;
}

// -- Auth helper --

interface AuthData {
  token?: string;
  accessToken?: string;
  [key: string]: unknown;
}

function readAuthToken(authFile: string): string {
  const resolved = authFile.startsWith("~")
    ? path.join(process.env.HOME ?? "", authFile.slice(1))
    : authFile;

  if (!fs.existsSync(resolved)) {
    throw new Error(`Auth file not found: ${resolved}`);
  }

  const data = JSON.parse(fs.readFileSync(resolved, "utf-8")) as AuthData;
  const token = data.token ?? data.accessToken;
  if (!token) {
    throw new Error(`No token found in auth file: ${resolved}`);
  }
  return token;
}

// -- Dot-path accessor --

function getByPath(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// -- Animeworkbench executor (image & video) --

export class AnimeworkbenchExecutor implements TaskExecutor {
  constructor(private config: ApiConfig) {}

  async submit(params: Record<string, unknown>): Promise<string> {
    const token = readAuthToken(this.config.authFile);
    const url = `${this.config.baseUrl}${this.config.endpoints.submit.path}`;

    const response = await fetch(url, {
      method: this.config.endpoints.submit.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Submit failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    if (body.code !== 200) {
      throw new Error(`API error: ${body.msg ?? JSON.stringify(body)}`);
    }

    const externalId = getByPath(body, this.config.endpoints.externalIdField);
    if (typeof externalId !== "string") {
      throw new Error(`Unexpected response: missing external ID at ${this.config.endpoints.externalIdField}`);
    }

    return externalId;
  }

  async poll(externalId: string): Promise<PollResult> {
    const token = readAuthToken(this.config.authFile);
    const baseUrl = `${this.config.baseUrl}${this.config.endpoints.poll.path}`;
    const url = `${baseUrl}?taskId=${encodeURIComponent(externalId)}`;

    const response = await fetch(url, {
      method: this.config.endpoints.poll.method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    if (body.code !== 200) {
      throw new Error(`API error: ${body.msg ?? JSON.stringify(body)}`);
    }

    const rawStatus = getByPath(body, this.config.endpoints.statusField);
    const status = this.mapStatus(String(rawStatus));

    const result: PollResult = { status };

    if (status === "completed") {
      const resultData = getByPath(body, this.config.endpoints.resultField);
      result.result = { files: resultData };
    }

    if (status === "failed") {
      const data = body.data as Record<string, unknown> | undefined;
      result.error = (data?.errorMsg as string) ?? "Unknown error";
    }

    return result;
  }

  async download(
    result: Record<string, unknown>,
    destPath: string,
  ): Promise<string[]> {
    const files = result.files as string[] | undefined;
    if (!files || files.length === 0) {
      throw new Error("No files in result to download");
    }

    await fsp.mkdir(destPath, { recursive: true });
    const downloaded: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const fileUrl = files[i];
      const ext = this.guessExtension(fileUrl);
      const filename = `result_${i}${ext}`;
      const filePath = path.join(destPath, filename);

      const response = await fetch(fileUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Download failed: ${response.status} for ${fileUrl}`);
      }

      const fileStream = fs.createWriteStream(filePath);
      // Stream response body to file
      const writer = Writable.toWeb(fileStream);
      await response.body.pipeTo(writer);

      downloaded.push(filePath);
    }

    return downloaded;
  }

  private mapStatus(raw: string): PollResult["status"] {
    const { statusMapping } = this.config;
    if (statusMapping.completed.includes(raw)) return "completed";
    if (statusMapping.failed.includes(raw)) return "failed";
    if (statusMapping.processing.includes(raw)) return "processing";
    if (statusMapping.pending.includes(raw)) return "pending";
    return "processing"; // default to processing for unknown statuses
  }

  private guessExtension(url: string): string {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext || ".bin";
  }
}

// -- Executor factory --

export function createExecutor(config: ApiConfig): TaskExecutor {
  // All animeworkbench APIs share the same request pattern
  return new AnimeworkbenchExecutor(config);
}
