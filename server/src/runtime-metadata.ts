import { isSandboxMode } from "./agent.js";

export interface RuntimeMetadata {
  status: "ok";
  environment: string;
  commitSha: string | null;
  schemaVersion: string | null;
  agentBackend: "sandbox" | "direct";
  daytonaConfigured: boolean;
  anthropicConfigured: boolean;
  bypassAuthEnabled: boolean;
  cliGitRef: string | null;
  supabaseProjectRef: string | null;
}

export function getRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.SONDE_ENVIRONMENT?.trim() ||
    env.NODE_ENV?.trim() ||
    "development"
  );
}

export function getSupabaseProjectRef(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const rawUrl = (env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "").trim();
  if (!rawUrl) return null;

  try {
    const hostname = new URL(rawUrl).hostname;
    const projectRef = hostname.split(".")[0]?.trim() ?? "";
    return projectRef || null;
  } catch {
    return null;
  }
}

export function getRuntimeMetadata(
  env: NodeJS.ProcessEnv = process.env
): RuntimeMetadata {
  return {
    status: "ok",
    environment: getRuntimeEnvironment(env),
    commitSha: env.SONDE_COMMIT_SHA?.trim() || null,
    schemaVersion: env.SONDE_SCHEMA_VERSION?.trim() || null,
    agentBackend: isSandboxMode() ? "sandbox" : "direct",
    daytonaConfigured: Boolean(env.DAYTONA_API_KEY?.trim()),
    anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    bypassAuthEnabled: Boolean(env.SONDE_TEST_AUTH_BYPASS_TOKEN?.trim()),
    cliGitRef: env.SONDE_CLI_GIT_REF?.trim() || null,
    supabaseProjectRef: getSupabaseProjectRef(env),
  };
}
