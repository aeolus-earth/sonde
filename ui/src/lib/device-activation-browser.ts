import type { Session } from "@supabase/supabase-js";
import { normalizeActivationCode } from "./device-activation";

export const ACTIVATION_CODE_STORAGE_KEY = "sonde-activation-code";

export interface ActivationOAuthClient {
  signInWithOAuth(input: {
    provider: "google";
    options: {
      redirectTo: string;
      queryParams: {
        hd: "aeolus.earth";
      };
    };
  }): Promise<{ error: { message: string } | null }>;
}

export interface ActivationCallbackAuthClient {
  exchangeCodeForSession(code: string): Promise<{ error: { message: string } | null }>;
  getSession(): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
}

export function buildActivationCallbackHref(origin: string, userCode: string): string {
  return `${origin.replace(/\/+$/, "")}/activate/callback?user_code=${encodeURIComponent(userCode)}`;
}

export function buildActivationReturnHref(userCode: string, error?: string): string {
  const params = new URLSearchParams();
  if (userCode) {
    params.set("code", userCode);
  }
  if (error) {
    params.set("error", error);
  }
  return params.size > 0 ? `/activate?${params.toString()}` : "/activate";
}

export async function requestActivationBrowserSignIn({
  rawCode,
  fallbackCode,
  windowOrigin,
  storage,
  authClient,
}: {
  rawCode: string;
  fallbackCode?: string;
  windowOrigin: string;
  storage?: Pick<Storage, "setItem">;
  authClient: ActivationOAuthClient;
}): Promise<{ normalizedCode: string | null; error: string | null }> {
  const normalizedCode = normalizeActivationCode(rawCode || fallbackCode || "");
  if (!normalizedCode) {
    return {
      normalizedCode: null,
      error: "Enter the activation code from your terminal first.",
    };
  }

  storage?.setItem(ACTIVATION_CODE_STORAGE_KEY, normalizedCode);
  const { error } = await authClient.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: buildActivationCallbackHref(windowOrigin, normalizedCode),
      queryParams: {
        hd: "aeolus.earth",
      },
    },
  });

  return {
    normalizedCode,
    error: error?.message ?? null,
  };
}

export async function resolveActivationCallbackHref({
  search,
  storedCode,
  authClient,
}: {
  search: string;
  storedCode: string;
  authClient: ActivationCallbackAuthClient;
}): Promise<string> {
  const params = new URLSearchParams(search);
  const oauthError = params.get("error_description") || params.get("error") || "";
  const oauthCode = params.get("code") || "";
  const userCode = normalizeActivationCode(params.get("user_code") || storedCode || "");

  if (oauthError) {
    return buildActivationReturnHref(userCode, oauthError);
  }

  try {
    if (oauthCode) {
      const exchanged = await authClient.exchangeCodeForSession(oauthCode);
      if (exchanged.error) {
        return buildActivationReturnHref(userCode, exchanged.error.message);
      }
    } else {
      const {
        data: { session },
        error,
      } = await authClient.getSession();
      if (error) {
        return buildActivationReturnHref(userCode, error.message);
      }
      if (!session) {
        return buildActivationReturnHref(userCode, "Activation sign-in did not complete.");
      }
    }
  } catch (error) {
    return buildActivationReturnHref(
      userCode,
      error instanceof Error ? error.message : "Activation sign-in did not complete.",
    );
  }

  return buildActivationReturnHref(userCode);
}
