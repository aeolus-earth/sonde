import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.VITE_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim();
  if (!value) {
    throw new Error("Missing SUPABASE_URL / VITE_SUPABASE_URL.");
  }
  return value;
}

function getSupabaseAnonKey(env: NodeJS.ProcessEnv = process.env): string {
  const value =
    env.VITE_SUPABASE_ANON_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim();
  if (!value) {
    throw new Error("Missing SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY.");
  }
  return value;
}

function getSupabaseServiceRoleKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const value = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return value || null;
}

function createServerSupabaseClient(key: string, accessToken?: string): SupabaseClient {
  return createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  return createServerSupabaseClient(getSupabaseAnonKey(), accessToken);
}

export function getServiceRoleSupabaseClient(): SupabaseClient | null {
  const key = getSupabaseServiceRoleKey();
  if (!key) return null;
  return createServerSupabaseClient(key);
}

export function createTelemetrySupabaseClient(
  accessToken?: string
): SupabaseClient {
  const serviceRoleClient = getServiceRoleSupabaseClient();
  if (serviceRoleClient) {
    return serviceRoleClient;
  }
  if (!accessToken?.trim()) {
    throw new Error(
      "Managed session telemetry requires an access token or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createUserSupabaseClient(accessToken);
}

export function hasSupabaseTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    (env.VITE_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim()) &&
      (env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
        env.SUPABASE_ANON_KEY?.trim() ||
        env.VITE_SUPABASE_ANON_KEY?.trim())
  );
}
