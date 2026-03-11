// input: API config YAML files from apis/ directory
// output: Typed API configurations for task executors
// pos: Config layer — decouples API details from executor logic

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface ApiRateLimit {
  maxConcurrent: number;
  delayMs: number;
}

export interface ApiPollingStrategy {
  intervalMs: number;
  maxWaitMs: number;
}

export interface ApiEndpoints {
  submit: { method: string; path: string };
  poll: { method: string; path: string };
  statusField: string;
  resultField: string;
  externalIdField: string;
}

export interface ApiStatusMapping {
  pending: string[];
  processing: string[];
  completed: string[];
  failed: string[];
}

export interface ApiConfig {
  name: string;
  provider: string;
  baseUrl: string;
  authType: "bearer";
  authFile: string;
  endpoints: ApiEndpoints;
  statusMapping: ApiStatusMapping;
  polling: ApiPollingStrategy;
  rateLimit: ApiRateLimit;
}

export class ApiRegistry {
  private configs = new Map<string, ApiConfig>();

  constructor(apisDir?: string) {
    if (apisDir) {
      this.loadFromDir(apisDir);
    }
  }

  register(config: ApiConfig): void {
    this.configs.set(config.name, config);
  }

  get(name: string): ApiConfig | undefined {
    return this.configs.get(name);
  }

  getByProvider(provider: string): ApiConfig | undefined {
    for (const config of this.configs.values()) {
      if (config.provider === provider) return config;
    }
    return undefined;
  }

  list(): ApiConfig[] {
    return [...this.configs.values()];
  }

  private loadFromDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      const config = YAML.parse(content) as ApiConfig;
      if (config.name) {
        this.configs.set(config.name, config);
      }
    }
  }
}
