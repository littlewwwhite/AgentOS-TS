// input: AWB API credentials + task parameters
// output: 6 MCP tools for AWB infrastructure operations
// pos: MCP server definition — awb_get_auth, awb_login, awb_upload, awb_submit_task, awb_poll_task, awb_api_request

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  getUserInfo,
  loadConfig,
  saveConfig,
  apiRequest,
  resolveBaseUrl,
  getToken,
} from "./auth.js";
import { uploadFile } from "./cos.js";

// ---------------------------------------------------------------------------
// 1. awb_get_auth — Check auth status and return token + user info
// ---------------------------------------------------------------------------

export const awbGetAuth = tool(
  "awb_get_auth",
  "Get current AWB authentication status. Returns token, userId, groupId, userName. Reads from ~/.animeworkbench_auth.json and auto-refreshes token if expired.",
  {
    force_refresh: z
      .boolean()
      .optional()
      .describe("Force token refresh even if cached token is still valid"),
    base_url: z
      .string()
      .optional()
      .describe("AWB API base URL override"),
  },
  async ({ force_refresh, base_url }) => {
    try {
      const info = await getUserInfo(
        resolveBaseUrl(base_url),
        force_refresh ?? false,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              token: info.token,
              userId: info.userId,
              groupId: info.groupId,
              userName: info.userName,
            }),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// 2. awb_login — Phone login + group selection
// ---------------------------------------------------------------------------

export const awbLogin = tool(
  "awb_login",
  "Login to AWB platform. Two-step flow: (1) phone_login with phone+code to get session, (2) select_group with group_id to choose team. If only one group exists, it is auto-selected.",
  {
    action: z
      .enum(["phone_login", "select_group"])
      .describe("Login action: phone_login or select_group"),
    phone: z
      .string()
      .optional()
      .describe("Phone number (required for phone_login)"),
    code: z
      .string()
      .optional()
      .describe("SMS verification code (required for phone_login)"),
    group_id: z
      .string()
      .optional()
      .describe(
        "Group ID to select (required for select_group, optional for phone_login if multiple groups)",
      ),
    base_url: z.string().optional().describe("AWB API base URL override"),
  },
  async ({ action, phone, code, group_id, base_url }) => {
    const baseUrl = resolveBaseUrl(base_url);

    try {
      if (action === "phone_login") {
        if (!phone || !code) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "phone and code are required for phone_login",
                }),
              },
            ],
          };
        }

        // Call phoneLogin API
        const url = `${baseUrl}/api/anime/user/account/phoneLogin`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, code }),
        });

        if (!resp.ok) {
          throw new Error(
            `phoneLogin HTTP ${resp.status}: ${await resp.text()}`,
          );
        }

        const json = (await resp.json()) as {
          code: number;
          msg?: string;
          data?: {
            session: string;
            token: string;
            groupMembers?: Array<{
              groupId: string;
              groupName: string;
              relationType?: number;
              character?: number;
            }>;
          };
        };

        if (json.code !== 200 || !json.data) {
          throw new Error(
            `phoneLogin failed: code=${json.code} msg=${json.msg ?? "unknown"}`,
          );
        }

        const { session, token, groupMembers } = json.data;
        const groups = groupMembers ?? [];

        // Auto-select if single group or group_id provided
        const targetGroupId =
          group_id ?? (groups.length === 1 ? groups[0]!.groupId : undefined);

        if (targetGroupId) {
          // Select group and save config
          const switchResult = await switchGroup(baseUrl, token, targetGroupId);
          saveConfig({
            refreshToken: session,
            groupId: targetGroupId,
            token: switchResult.token,
            expiresAt: switchResult.expiresAt,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "logged_in",
                  groupId: targetGroupId,
                  groupName:
                    groups.find((g) => g.groupId === targetGroupId)
                      ?.groupName ?? "",
                }),
              },
            ],
          };
        }

        // Multiple groups — save session, return group list for user to choose
        saveConfig({ refreshToken: session, token });

        const roleLabel = (gm: { relationType?: number; character?: number }) => {
          if (gm.relationType === 1) return "creator";
          if (gm.character === 1) return "director";
          return "member";
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "needs_group_selection",
                groups: groups.map((g) => ({
                  groupId: g.groupId,
                  groupName: g.groupName,
                  role: roleLabel(g),
                })),
              }),
            },
          ],
        };
      }

      // action === "select_group"
      if (!group_id) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "group_id is required for select_group",
              }),
            },
          ],
        };
      }

      const config = loadConfig();
      const token = config.token ?? (await getToken(baseUrl));
      const switchResult = await switchGroup(baseUrl, token, group_id);
      config.groupId = group_id;
      config.token = switchResult.token;
      config.expiresAt = switchResult.expiresAt;
      saveConfig(config);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "group_selected",
              groupId: group_id,
            }),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);

/** Call updateCurrentGroup API to switch active team, returns new token data. */
async function switchGroup(
  baseUrl: string,
  token: string,
  groupId: string,
): Promise<{ token: string; expiresAt: number }> {
  const url = `${baseUrl}/api/anime/user/group/updateCurrentGroup`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ groupId }),
  });

  if (!resp.ok) {
    throw new Error(
      `updateCurrentGroup HTTP ${resp.status}: ${await resp.text()}`,
    );
  }

  const json = (await resp.json()) as {
    code: number;
    msg?: string;
    data?: { token: string; expireTime: number };
  };

  if (json.code !== 200 || !json.data) {
    throw new Error(
      `updateCurrentGroup failed: code=${json.code} msg=${json.msg ?? "unknown"}`,
    );
  }

  return { token: json.data.token, expiresAt: json.data.expireTime };
}

// ---------------------------------------------------------------------------
// 3. awb_upload — Upload file to COS
// ---------------------------------------------------------------------------

export const awbUpload = tool(
  "awb_upload",
  "Upload a local file to Tencent COS via AWB credentials. Automatically obtains temporary COS credentials, uploads with public-read ACL, and returns the accessible URL.",
  {
    file_path: z.string().describe("Absolute path to the local file to upload"),
    scene_type: z
      .string()
      .optional()
      .describe(
        "COS scene type: 'material-image-edit' (default, for images) or 'material-video-create' (for videos)",
      ),
    base_url: z.string().optional().describe("AWB API base URL override"),
  },
  async ({ file_path, scene_type, base_url }) => {
    try {
      const result = await uploadFile(file_path, {
        sceneType: scene_type,
        baseUrl: base_url,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// 4. awb_submit_task — Submit image/video creation tasks
// ---------------------------------------------------------------------------

const TASK_ENDPOINTS: Record<string, { submit: string; query: string }> = {
  imageCreate: {
    submit: "/api/material/creation/imageCreate",
    query: "/api/material/creation/imageCreateGet",
  },
  imageEdit: {
    submit: "/api/material/creation/imageEdit",
    query: "/api/material/creation/imageEditGet",
  },
  videoCreate: {
    submit: "/api/material/creation/videoCreate",
    query: "/api/material/creation/videoCreateGet",
  },
};

export const awbSubmitTask = tool(
  "awb_submit_task",
  "Submit an image/video creation task to AWB. Returns taskId for polling.",
  {
    task_type: z
      .enum(["imageCreate", "imageEdit", "videoCreate"])
      .describe("Type of creation task"),
    model_code: z.string().describe("Model code for generation"),
    prompt: z
      .string()
      .optional()
      .describe("Task prompt (mapped to taskPrompt)"),
    prompt_params: z
      .record(z.string())
      .optional()
      .describe(
        "Additional prompt parameters as key-value pairs (mapped to promptParams)",
      ),
    base_url: z.string().optional().describe("AWB API base URL override"),
  },
  async ({ task_type, model_code, prompt, prompt_params, base_url }) => {
    const baseUrl = resolveBaseUrl(base_url);

    try {
      const endpoint = TASK_ENDPOINTS[task_type];
      if (!endpoint) {
        throw new Error(`Unknown task_type: ${task_type}`);
      }

      const body: Record<string, unknown> = { modelCode: model_code };
      if (prompt !== undefined) body.taskPrompt = prompt;
      if (prompt_params !== undefined) body.promptParams = prompt_params;

      const result = await apiRequest(
        `${baseUrl}${endpoint.submit}`,
        { method: "POST", body, baseUrl },
      );

      if (result.code !== 200) {
        throw new Error(
          `submit ${task_type} failed: code=${result.code} msg=${result.msg ?? "unknown"}`,
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ taskId: result.data }),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// 5. awb_poll_task — Poll task status until completion or timeout
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["SUCCESS", "FAIL", "FAILED"]);
const MAX_CONSECUTIVE_ERRORS = 10;

export const awbPollTask = tool(
  "awb_poll_task",
  "Poll an AWB creation task until it completes, fails, or times out. Blocks until terminal status. Returns task result including resultFileList on success.",
  {
    task_id: z.string().describe("Task ID from awb_submit_task"),
    task_type: z
      .enum(["imageCreate", "imageEdit", "videoCreate"])
      .describe("Type of creation task (determines which query endpoint to use)"),
    interval: z
      .number()
      .optional()
      .describe("Polling interval in seconds (default: 3)"),
    timeout: z
      .number()
      .optional()
      .describe("Maximum wait time in seconds (default: 300)"),
    base_url: z.string().optional().describe("AWB API base URL override"),
  },
  async ({ task_id, task_type, interval, timeout, base_url }) => {
    const baseUrl = resolveBaseUrl(base_url);
    const pollInterval = (interval ?? 3) * 1000;
    const pollTimeout = (timeout ?? 300) * 1000;

    try {
      const endpoint = TASK_ENDPOINTS[task_type];
      if (!endpoint) {
        throw new Error(`Unknown task_type: ${task_type}`);
      }

      const queryUrl = `${baseUrl}${endpoint.query}?taskId=${task_id}`;
      const startTime = Date.now();
      let consecutiveErrors = 0;

      while (Date.now() - startTime < pollTimeout) {
        try {
          const result = await apiRequest(queryUrl, { baseUrl });

          if (result.code !== 200) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              throw new Error(
                `${MAX_CONSECUTIVE_ERRORS} consecutive errors, last: code=${result.code} msg=${result.msg ?? "unknown"}`,
              );
            }
          } else {
            consecutiveErrors = 0;
            const data = result.data as {
              taskStatus?: string;
              taskQueueNum?: number;
              resultFileList?: string[];
              resultFileDisplayList?: string[];
              errorMsg?: string;
            } | null;

            if (data?.taskStatus && TERMINAL_STATUSES.has(data.taskStatus)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      status: data.taskStatus,
                      resultFileList: data.resultFileList ?? [],
                      resultFileDisplayList: data.resultFileDisplayList ?? [],
                      errorMsg: data.errorMsg,
                    }),
                  },
                ],
              };
            }

            // Log progress if queue position available
            if (data?.taskQueueNum !== undefined && data.taskQueueNum > 0) {
              // Still in queue, continue polling
            }
          }
        } catch (e) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw e;
          }
        }

        await new Promise((r) => setTimeout(r, pollInterval));
      }

      // Timeout
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "TIMEOUT",
              errorMsg: `Task did not complete within ${timeout ?? 300} seconds`,
            }),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// 6. awb_api_request — Generic AWB API call
// ---------------------------------------------------------------------------

export const awbApiRequest = tool(
  "awb_api_request",
  "Make an authenticated API request to any AWB endpoint. Handles token injection and 701 auto-refresh. Use this for endpoints not covered by other awb_* tools.",
  {
    path: z
      .string()
      .describe(
        "API path (e.g. /api/material/creation/listElements). Will be appended to base_url.",
      ),
    method: z
      .enum(["GET", "POST", "PUT", "DELETE"])
      .optional()
      .describe("HTTP method (default: GET)"),
    body: z
      .record(z.unknown())
      .optional()
      .describe("Request body (JSON object, for POST/PUT)"),
    base_url: z.string().optional().describe("AWB API base URL override"),
  },
  async ({ path, method, body, base_url }) => {
    const baseUrl = resolveBaseUrl(base_url);
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    try {
      const result = await apiRequest(url, {
        method: method ?? "GET",
        body,
        baseUrl,
      });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  },
);
