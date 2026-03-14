// input: Local file path + AWB COS credentials
// output: Public COS URL + object key
// pos: COS upload infrastructure for awb_upload MCP tool

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getUserInfo, resolveBaseUrl } from "./auth.js";

// ---------------------------------------------------------------------------
// MIME type map
// ---------------------------------------------------------------------------

const CONTENT_TYPE_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha1Hex(data: string): string {
  return crypto.createHash("sha1").update(data).digest("hex");
}

function hmacSha1Hex(key: string, msg: string): string {
  return crypto.createHmac("sha1", key).update(msg).digest("hex");
}

// ---------------------------------------------------------------------------
// COS Authorization (q-sign-algorithm=sha1)
// ---------------------------------------------------------------------------

function buildCosAuth(
  secretId: string,
  secretKey: string,
  method: string,
  uriPath: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>,
): string {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + 900; // 15 min
  const qSignTime = `${now};${expire}`;
  const signKey = hmacSha1Hex(secretKey, qSignTime);

  // Canonical header list (keys lowercased & sorted)
  const sortedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const headerStr = Object.keys(headers)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}=${encodeURIComponent(headers[k]!)}`)
    .join("&");

  // Canonical query list
  const sortedParamKeys = Object.keys(queryParams)
    .map((k) => k.toLowerCase())
    .sort();
  const paramStr = Object.keys(queryParams)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}=${encodeURIComponent(queryParams[k]!)}`)
    .join("&");

  const httpString = `${method.toLowerCase()}\n${uriPath}\n${paramStr}\n${headerStr}\n`;
  const stringToSign = `sha1\n${qSignTime}\n${sha1Hex(httpString)}\n`;
  const signature = hmacSha1Hex(signKey, stringToSign);

  return [
    `q-sign-algorithm=sha1`,
    `q-ak=${secretId}`,
    `q-sign-time=${qSignTime}`,
    `q-key-time=${qSignTime}`,
    `q-header-list=${sortedHeaderKeys.join(";")}`,
    `q-url-param-list=${sortedParamKeys.join(";")}`,
    `q-signature=${signature}`,
  ].join("&");
}

// ---------------------------------------------------------------------------
// getSecret — obtain temporary COS credentials from AWB backend
// ---------------------------------------------------------------------------

interface CosCredential {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  bucket: string;
  region: string;
  path: string;
  credentials?: {
    tmpSecretId: string;
    tmpSecretKey: string;
    sessionToken: string;
  };
}

async function getCosSecret(
  baseUrl: string,
  token: string,
  groupId: string,
  sceneType: string,
): Promise<CosCredential> {
  const url = `${baseUrl}/api/anime/workbench/TencentCloud/getSecret`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sceneType, groupId, projectNo: "" }),
  });

  if (!resp.ok) {
    throw new Error(`getSecret HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = (await resp.json()) as {
    code: number;
    msg?: string;
    data?: CosCredential;
  };

  if (json.code !== 200 || !json.data) {
    throw new Error(
      `getSecret failed: code=${json.code} msg=${json.msg ?? "unknown"}`,
    );
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// uploadFile — PUT file to COS with public-read ACL
// ---------------------------------------------------------------------------

export interface UploadResult {
  url: string;
  objectKey: string;
}

export async function uploadFile(
  filePath: string,
  opts: {
    sceneType?: string;
    baseUrl?: string;
  } = {},
): Promise<UploadResult> {
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const sceneType = opts.sceneType ?? "material-image-edit";

  // Get auth info
  const userInfo = await getUserInfo(baseUrl);
  const { token, groupId } = userInfo;

  if (!groupId) {
    throw new Error("Cannot determine groupId. Run awb_login first.");
  }

  // Get COS temporary credentials
  const credential = await getCosSecret(baseUrl, token, groupId, sceneType);

  // Resolve nested credentials
  const creds = credential.credentials ?? credential;
  const tmpSecretId = creds.tmpSecretId;
  const tmpSecretKey = creds.tmpSecretKey;
  const sessionToken = creds.sessionToken;
  const bucket = credential.bucket || "huimeng-1351980869";
  const region = credential.region || "ap-beijing";
  let cosPath = credential.path || `material/upload/${groupId}/`;
  if (!cosPath.endsWith("/")) cosPath += "/";

  // Build object key
  const filename = path.basename(filePath);
  const timestampMs = Date.now();
  const rand = Math.floor(100000 + Math.random() * 900000);
  const objectKey = `${cosPath}upload-${timestampMs}-${rand}-${filename}`;

  // Read file
  const fileData = fs.readFileSync(filePath);
  const ext = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  const contentType = CONTENT_TYPE_MAP[ext] ?? "application/octet-stream";

  // Build COS request
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const objectKeyEncoded = objectKey
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const cosUrl = `https://${host}/${objectKeyEncoded}`;
  const uriPath = `/${objectKey}`;

  const headersToSign: Record<string, string> = {
    "content-type": contentType,
    host,
    "x-cos-acl": "public-read",
    "x-cos-security-token": sessionToken,
  };

  const auth = buildCosAuth(
    tmpSecretId,
    tmpSecretKey,
    "PUT",
    uriPath,
    {},
    headersToSign,
  );

  // Upload
  const resp = await fetch(cosUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Host: host,
      Authorization: auth,
      "x-cos-acl": "public-read",
      "x-cos-security-token": sessionToken,
    },
    body: fileData,
  });

  if (!resp.ok && resp.status !== 204) {
    const body = await resp.text();
    throw new Error(`COS upload failed, HTTP ${resp.status}: ${body}`);
  }

  return { url: cosUrl, objectKey };
}
