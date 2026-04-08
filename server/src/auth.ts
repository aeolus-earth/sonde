import { createClient } from "@supabase/supabase-js";

export interface VerifiedUser {
  id: string;
  email?: string;
  name?: string;
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

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

    return {
      id: data.user.id,
      email: data.user.email,
      name:
        (data.user.user_metadata?.full_name as string | undefined) ??
        data.user.email,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[sonde-server] auth.verifyToken exception:", err);
    }
    return null;
  }
}
