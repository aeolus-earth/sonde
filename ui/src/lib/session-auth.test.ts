import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  getFreshAccessToken,
  SessionReauthRequiredError,
} from "./session-auth";

const baseSession: Session = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 2_000_000_000,
  user: {
    id: "user-1",
    aud: "authenticated",
    role: "authenticated",
    email: "mason@aeolus.earth",
    email_confirmed_at: "2026-04-14T00:00:00.000Z",
    phone: "",
    confirmed_at: "2026-04-14T00:00:00.000Z",
    last_sign_in_at: "2026-04-14T00:00:00.000Z",
    app_metadata: {
      provider: "google",
      providers: ["google"],
    },
    user_metadata: {
      full_name: "Mason",
    },
    identities: [],
    created_at: "2026-04-14T00:00:00.000Z",
    updated_at: "2026-04-14T00:00:00.000Z",
    is_anonymous: false,
  },
};

function createAuthClient(options: {
  session?: Session | null;
  refreshSession?: Session | null;
  getSessionError?: string | null;
  refreshError?: string | null;
}) {
  return {
    getSession: vi.fn(async () => ({
      data: {
        session: options.session ?? null,
      },
      error: options.getSessionError ? { message: options.getSessionError } : null,
    })),
    refreshSession: vi.fn(async () => ({
      data: {
        session: options.refreshSession ?? null,
      },
      error: options.refreshError ? { message: options.refreshError } : null,
    })),
  };
}

describe("getFreshAccessToken", () => {
  it("returns the current token when the session is healthy", async () => {
    const authClient = createAuthClient({
      session: baseSession,
    });

    const token = await getFreshAccessToken({
      authClient,
      now: 1_900_000_000_000,
    });

    expect(token).toBe("access-token");
    expect(authClient.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes when the session is about to expire", async () => {
    const authClient = createAuthClient({
      session: {
        ...baseSession,
        access_token: "stale-token",
        expires_at: 1_900_000_050,
      },
      refreshSession: {
        ...baseSession,
        access_token: "fresh-token",
        expires_at: 1_900_003_600,
      },
    });

    const token = await getFreshAccessToken({
      authClient,
      now: 1_900_000_000_000,
    });

    expect(token).toBe("fresh-token");
    expect(authClient.refreshSession).toHaveBeenCalledOnce();
  });

  it("keeps the current token when expiry metadata is missing", async () => {
    const authClient = createAuthClient({
      session: {
        ...baseSession,
        expires_at: undefined,
      } as Session,
    });

    const token = await getFreshAccessToken({
      authClient,
      now: 1_900_000_000_000,
    });

    expect(token).toBe("access-token");
    expect(authClient.refreshSession).not.toHaveBeenCalled();
  });

  it("throws a reauth error when refresh fails", async () => {
    const authClient = createAuthClient({
      session: {
        ...baseSession,
        access_token: "stale-token",
        expires_at: 1_900_000_050,
      },
      refreshError: "Refresh token invalid",
    });

    await expect(
      getFreshAccessToken({
        authClient,
        now: 1_900_000_000_000,
        reauthMessage: "Sign in again to reconnect chat.",
      }),
    ).rejects.toMatchObject({
      name: SessionReauthRequiredError.name,
      message: "Sign in again to reconnect chat.",
    });
  });

  it("throws a reauth error when there is no session", async () => {
    const authClient = createAuthClient({
      session: null,
    });

    await expect(
      getFreshAccessToken({
        authClient,
        reauthMessage: "Sign in again to load timeline commit history.",
      }),
    ).rejects.toMatchObject({
      name: SessionReauthRequiredError.name,
      message: "Sign in again to load timeline commit history.",
    });
  });
});
