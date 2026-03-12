import { describe, expect, it } from "vitest";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  appendTokenSearchParam,
  buildAuthorizationHeaders,
  ensureAuthSession,
  fetchAuthSession,
  readStoredAuthSession,
  storeAuthSession,
  type StoredAuthSession,
} from "../../web/lib/auth-session";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe("auth-session", () => {
  it("stores and restores a valid auth session", () => {
    const storage = new MemoryStorage();
    const session: StoredAuthSession = {
      userId: "guest_123",
      token: "signed-token",
      issuedAt: 1_000,
      expiresAt: 5_000,
    };

    storeAuthSession(storage, session);

    expect(readStoredAuthSession(storage, 2_000)).toEqual(session);
  });

  it("drops expired auth sessions", () => {
    const storage = new MemoryStorage();
    storeAuthSession(storage, {
      userId: "guest_123",
      token: "signed-token",
      issuedAt: 1_000,
      expiresAt: 1_500,
    });

    expect(readStoredAuthSession(storage, 2_000)).toBeNull();
    expect(storage.getItem("agentos.auth.session")).toBeNull();
  });

  it("builds bearer headers only when a token is present", () => {
    expect(buildAuthorizationHeaders("signed-token")).toEqual({
      authorization: "Bearer signed-token",
    });
    expect(buildAuthorizationHeaders(null)).toEqual({});
  });

  it("appends auth token to resource urls", () => {
    expect(
      appendTokenSearchParam(
        "http://localhost:3001/api/projects/p/files/download?path=%2Fworkspace%2Fa.png",
        "signed-token",
      ),
    ).toBe(
      "http://localhost:3001/api/projects/p/files/download?path=%2Fworkspace%2Fa.png&token=signed-token",
    );
  });

  it("fetches auth session from the backend session endpoint", async () => {
    const urls: string[] = [];

    const session = await fetchAuthSession(
      "http://localhost:3001",
      async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            userId: "guest_123",
            token: "signed-token",
            issuedAt: 1_000,
            expiresAt: 5_000,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    expect(urls).toEqual(["http://localhost:3001/api/auth/session"]);
    expect(session).toEqual({
      userId: "guest_123",
      token: "signed-token",
      issuedAt: 1_000,
      expiresAt: 5_000,
    });
  });

  it("reuses a non-expired stored session without requesting a new one", async () => {
    const storage = new MemoryStorage();
    const session: StoredAuthSession = {
      userId: "guest_stored",
      token: "stored-token",
      issuedAt: 1_000,
      expiresAt: 5_000,
    };
    let fetchCalls = 0;

    storeAuthSession(storage, session);

    const resolved = await ensureAuthSession("http://localhost:3001", {
      storage,
      now: 2_000,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 500 });
      },
    });

    expect(fetchCalls).toBe(0);
    expect(resolved).toEqual(session);
  });

  it("requests and persists a new session after stored session expiry", async () => {
    const storage = new MemoryStorage();
    let fetchCalls = 0;

    storeAuthSession(storage, {
      userId: "guest_expired",
      token: "expired-token",
      issuedAt: 1_000,
      expiresAt: 1_500,
    });

    const resolved = await ensureAuthSession("http://localhost:3001", {
      storage,
      now: 2_000,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            userId: "guest_fresh",
            token: "fresh-token",
            issuedAt: 2_000,
            expiresAt: 8_000,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(fetchCalls).toBe(1);
    expect(resolved).toEqual({
      userId: "guest_fresh",
      token: "fresh-token",
      issuedAt: 2_000,
      expiresAt: 8_000,
    });
    expect(readStoredAuthSession(storage, 2_500)).toEqual(resolved);
  });

  it("keeps legacy token and userId fallback compatible without requesting a new session", async () => {
    const storage = new MemoryStorage();
    let fetchCalls = 0;

    storage.setItem(AUTH_TOKEN_STORAGE_KEY, "legacy-token");
    storage.setItem(AUTH_USER_STORAGE_KEY, "guest_legacy");

    const resolved = await ensureAuthSession("http://localhost:3001", {
      storage,
      now: 2_000,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 500 });
      },
    });

    expect(fetchCalls).toBe(0);
    expect(resolved).toEqual({
      userId: "guest_legacy",
      token: "legacy-token",
      issuedAt: 2_000,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
  });
});
