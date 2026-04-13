import { createClient } from "@supabase/supabase-js";

export interface VerifiedUser {
  id: string;
  email?: string;
  name?: string;
  isAdmin?: boolean;
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const normalized = segments[1]!
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segments[1]!.length / 4) * 4, "=");
    const payload = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getBypassToken(): string | null {
  if (process.env.NODE_ENV !== "test") {
    return null;
  }
  const token = process.env.SONDE_TEST_AUTH_BYPASS_TOKEN?.trim();
  return token ? token : null;
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_ANON_KEY (or VITE_ prefixed variants)"
    );
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

export async function verifyToken(
  accessToken: string
): Promise<VerifiedUser | null> {
  const bypassToken = getBypassToken();
  if (bypassToken && accessToken === bypassToken) {
    return {
      id: "e2e-user",
      email: "ci-smoke@aeolus.earth",
      name: "CI Smoke",
      isAdmin: true,
    };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      if (process.env.NODE_ENV !== "production" && error) {
        console.error("[sonde-server] auth.getUser failed:", error.message);
      }
      return null;
    }

    const claims = decodeJwtPayload(accessToken);
    const appMetadata =
      claims?.app_metadata && typeof claims.app_metadata === "object"
        ? (claims.app_metadata as Record<string, unknown>)
        : null;

    return {
      id: data.user.id,
      email: data.user.email,
      name:
        (data.user.user_metadata?.full_name as string | undefined) ??
        data.user.email,
      isAdmin:
        appMetadata?.is_admin === true ||
        appMetadata?.isAdmin === true ||
        data.user.app_metadata?.is_admin === true ||
        data.user.app_metadata?.isAdmin === true,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[sonde-server] auth.verifyToken exception:", err);
    }
    return null;
  }
}
