// input: Secret key, SessionStore instance, existing tokens
// output: Guest auth sessions with HMAC-signed tokens, user reuse via DB lookup
// pos: Auth layer — token issuance, verification, and user identity persistence

import crypto from "node:crypto";
import type { SessionStore } from "./session-store.js";

export interface AuthSession {
  userId: string;
  token: string;
  issuedAt: number;
  expiresAt: number;
}

export interface VerifiedSession {
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface IssueSessionOptions {
  now?: number;
  ttlMs?: number;
}

export interface VerifySessionOptions {
  now?: number;
}

type TokenPayload = {
  sub: string;
  iat: number;
  exp: number;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf-8");
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createGuestUserId(): string {
  return `guest_${crypto.randomUUID()}`;
}

export function issueGuestSession(
  secret: string,
  options: IssueSessionOptions = {},
): AuthSession {
  const issuedAt = options.now ?? Date.now();
  const expiresAt = issuedAt + (options.ttlMs ?? 24 * 60 * 60 * 1000);
  const userId = createGuestUserId();
  const payload: TokenPayload = {
    sub: userId,
    iat: issuedAt,
    exp: expiresAt,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);

  return {
    userId,
    token: `${encodedPayload}.${signature}`,
    issuedAt,
    expiresAt,
  };
}

export function verifySessionToken(
  token: string,
  secret: string,
  options: VerifySessionOptions = {},
): VerifiedSession | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (signature.length !== expectedSignature.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<TokenPayload>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    const now = options.now ?? Date.now();
    if (payload.exp <= now) {
      return null;
    }

    return {
      userId: payload.sub,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function scopeProjectId(userId: string, projectId: string): string {
  return `${userId}:${projectId}`;
}

export function extractLogicalProjectId(scopedProjectId: string): string {
  const index = scopedProjectId.indexOf(":");
  return index === -1 ? scopedProjectId : scopedProjectId.slice(index + 1);
}

/**
 * Reuse an existing user when a valid token is presented, or create a new guest.
 * This ensures browser refreshes preserve user identity via localStorage-cached tokens.
 */
export function findOrCreateUser(
  store: SessionStore,
  existingToken: string | null,
  secret: string,
  options: IssueSessionOptions = {},
): AuthSession {
  if (existingToken) {
    const verified = verifySessionToken(existingToken, secret, { now: options.now });
    if (verified) {
      const persisted = store.findUserByToken(existingToken);
      if (persisted && persisted.expiresAt > (options.now ?? Date.now())) {
        return {
          userId: persisted.userId,
          token: existingToken,
          issuedAt: verified.issuedAt,
          expiresAt: verified.expiresAt,
        };
      }
    }
  }

  const session = issueGuestSession(secret, options);
  store.persistUser({
    userId: session.userId,
    token: session.token,
    createdAt: session.issuedAt,
    expiresAt: session.expiresAt,
  });
  return session;
}
