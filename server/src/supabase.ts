import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return env.SONDE_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || "development";
}

export function telemetryRequiresServiceRole(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return getRuntimeEnvironment(env) === "production";
}

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

function getSupabaseServiceRoleKey(env: NodeJS.ProcessEnv = process.env): string | null {
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

export function getServiceRoleSupabaseClient(
  env: NodeJS.ProcessEnv = process.env
): SupabaseClient | null {
  const key = getSupabaseServiceRoleKey(env);
  if (!key) return null;
  return createServerSupabaseClient(key);
}

export function createTelemetrySupabaseClient(
  accessToken?: string,
  env: NodeJS.ProcessEnv = process.env
): SupabaseClient {
  const serviceRoleClient = getServiceRoleSupabaseClient(env);
  if (serviceRoleClient) {
    return serviceRoleClient;
  }
  if (telemetryRequiresServiceRole(env)) {
    throw new Error(
      "Managed session telemetry requires SUPABASE_SERVICE_ROLE_KEY in production."
    );
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
  const hasUrl = Boolean(env.VITE_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim());
  if (!hasUrl) {
    return false;
  }
  if (telemetryRequiresServiceRole(env)) {
    return Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  }
  return Boolean(
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      env.SUPABASE_ANON_KEY?.trim() ||
      env.VITE_SUPABASE_ANON_KEY?.trim()
  );
}
