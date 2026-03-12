import { describe, expect, it } from "vitest";
import {
  findOrCreateUser,
  issueGuestSession,
  verifySessionToken,
} from "../src/auth.js";
import { SessionStore } from "../src/session-store.js";

const SECRET = "test-secret";

describe("auth session tokens", () => {
  it("issues and verifies a guest session token", () => {
    const session = issueGuestSession(SECRET, { now: 1_700_000_000_000 });
    const verified = verifySessionToken(session.token, SECRET, {
      now: 1_700_000_001_000,
    });

    expect(verified).toEqual({
      userId: session.userId,
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_086_400_000,
    });
  });

  it("rejects a tampered token", () => {
    const session = issueGuestSession(SECRET);
    const tampered = `${session.token}broken`;

    expect(verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const session = issueGuestSession(SECRET, {
      now: 1_700_000_000_000,
      ttlMs: 1000,
    });

    expect(
      verifySessionToken(session.token, SECRET, {
        now: 1_700_000_002_000,
      }),
    ).toBeNull();
  });
});

describe("findOrCreateUser", () => {
  const NOW = 1_700_000_000_000;

  it("creates a new guest when no existing token is provided", () => {
    const store = new SessionStore();
    const session = findOrCreateUser(store, null, SECRET, { now: NOW });

    expect(session.userId).toMatch(/^guest_/);
    expect(session.token).toBeTruthy();
    expect(session.issuedAt).toBe(NOW);

    // User should be persisted in the store
    const found = store.findUserByToken(session.token);
    expect(found).toEqual({
      userId: session.userId,
      expiresAt: session.expiresAt,
    });
  });

  it("reuses existing user when a valid token is presented", () => {
    const store = new SessionStore();

    // First call: create a user
    const first = findOrCreateUser(store, null, SECRET, { now: NOW });

    // Second call: same token → same user
    const second = findOrCreateUser(store, first.token, SECRET, {
      now: NOW + 1000,
    });

    expect(second.userId).toBe(first.userId);
    expect(second.token).toBe(first.token);
  });

  it("creates a new guest when token signature is invalid", () => {
    const store = new SessionStore();
    const first = findOrCreateUser(store, null, SECRET, { now: NOW });

    const tampered = `${first.token}tampered`;
    const second = findOrCreateUser(store, tampered, SECRET, {
      now: NOW + 1000,
    });

    expect(second.userId).not.toBe(first.userId);
    expect(second.token).not.toBe(first.token);
  });

  it("creates a new guest when token is expired", () => {
    const store = new SessionStore();
    const first = findOrCreateUser(store, null, SECRET, {
      now: NOW,
      ttlMs: 1000,
    });

    // 2 seconds later — token expired
    const second = findOrCreateUser(store, first.token, SECRET, {
      now: NOW + 2000,
    });

    expect(second.userId).not.toBe(first.userId);
  });

  it("creates a new guest when token is valid but user not in DB", () => {
    const store = new SessionStore();

    // Issue a token externally — not persisted to store
    const orphan = issueGuestSession(SECRET, { now: NOW });

    const result = findOrCreateUser(store, orphan.token, SECRET, {
      now: NOW + 1000,
    });

    // Should create a NEW user, not reuse the orphan
    expect(result.userId).not.toBe(orphan.userId);

    // New user should be persisted
    const found = store.findUserByToken(result.token);
    expect(found).toEqual({
      userId: result.userId,
      expiresAt: result.expiresAt,
    });
  });
});
