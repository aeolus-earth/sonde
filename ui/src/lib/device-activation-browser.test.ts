import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVATION_CODE_STORAGE_KEY,
  buildActivationCallbackHref,
  requestActivationBrowserSignIn,
  resolveActivationCallbackHref,
} from "./device-activation-browser";

const activationSession: Session = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1_900_000_000,
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

describe("device activation browser helpers", () => {
  it("builds the hosted activation callback URL", () => {
    expect(
      buildActivationCallbackHref("https://sonde-staging.vercel.app/", "ABCD-2345"),
    ).toBe("https://sonde-staging.vercel.app/activate/callback?user_code=ABCD-2345");
  });

  it("starts Google sign-in with the hosted callback URL and domain restriction", async () => {
    const setItem = vi.fn();
    const signInWithOAuth = vi.fn(async () => ({ error: null }));

    const result = await requestActivationBrowserSignIn({
      rawCode: "ab cd 23 45",
      windowOrigin: "https://sonde-neon.vercel.app",
      storage: { setItem },
      authClient: { signInWithOAuth },
    });

    expect(result).toEqual({
      normalizedCode: "ABCD-2345",
      error: null,
    });
    expect(setItem).toHaveBeenCalledWith(ACTIVATION_CODE_STORAGE_KEY, "ABCD-2345");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://sonde-neon.vercel.app/activate/callback?user_code=ABCD-2345",
        queryParams: {
          hd: "aeolus.earth",
        },
      },
    });
  });

  it("returns a validation error when the activation code is missing", async () => {
    const signInWithOAuth = vi.fn();

    const result = await requestActivationBrowserSignIn({
      rawCode: "bad",
      windowOrigin: "https://sonde-neon.vercel.app",
      authClient: { signInWithOAuth },
    });

    expect(result).toEqual({
      normalizedCode: null,
      error: "Enter the activation code from your terminal first.",
    });
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("resolves the callback through the existing activation session when no OAuth code is present", async () => {
    const href = await resolveActivationCallbackHref({
      search: "?user_code=ABCD-2345",
      storedCode: "",
      authClient: {
        exchangeCodeForSession: vi.fn(async () => ({ error: null })),
        getSession: vi.fn(async () => ({
          data: {
            session: activationSession,
          },
          error: null,
        })),
      },
    });

    expect(href).toBe("/activate?code=ABCD-2345");
  });

  it("surfaces code-exchange failures back on the activation page", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({
      error: { message: "The redirect URI is not allowed." },
    }));

    const href = await resolveActivationCallbackHref({
      search: "?code=oauth-code&user_code=ABCD-2345",
      storedCode: "",
      authClient: {
        exchangeCodeForSession,
        getSession: vi.fn(async () => ({
          data: { session: null },
          error: null,
        })),
      },
    });

    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(href).toBe(
      "/activate?code=ABCD-2345&error=The+redirect+URI+is+not+allowed.",
    );
  });

  it("surfaces OAuth provider errors back on the activation page", async () => {
    const href = await resolveActivationCallbackHref({
      search: "?error=access_denied&error_description=User+denied+access&user_code=ABCD-2345",
      storedCode: "",
      authClient: {
        exchangeCodeForSession: vi.fn(async () => ({ error: null })),
        getSession: vi.fn(async () => ({
          data: { session: null },
          error: null,
        })),
      },
    });

    expect(href).toBe("/activate?code=ABCD-2345&error=User+denied+access");
  });
});
