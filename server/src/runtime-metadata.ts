import { getAgentBackend } from "./runtime-mode.js";
import {
  hasSharedRateLimitConfig,
  isSharedRateLimitRequired,
} from "./security-config.js";
import { hasGitHubAccess } from "./github.js";
import { hasSupabaseTelemetryConfig } from "./supabase.js";

export interface RuntimeMetadata {
  status: "ok";
  environment: string;
  commitSha: string | null;
  schemaVersion: string | null;
  agentBackend: "managed";
  managedConfigured: boolean;
  sondeMcpConfigured: boolean;
  githubConfigured: boolean;
  anthropicConfigured: boolean;
  anthropicAdminConfigured: boolean;
  costTelemetryConfigured: boolean;
  liveSpendEnabled: boolean;
  cliGitRef: string | null;
  supabaseProjectRef: string | null;
  sharedRateLimitConfigured: boolean;
  sharedRateLimitRequired: boolean;
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
  const managedConfigured =
    Boolean(env.ANTHROPIC_API_KEY?.trim()) &&
    Boolean(env.SONDE_MANAGED_ENVIRONMENT_ID?.trim()) &&
    (Boolean(env.SONDE_MANAGED_AGENT_ID?.trim()) ||
      env.SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT === "1");
  return {
    status: "ok",
    environment: getRuntimeEnvironment(env),
    commitSha: env.SONDE_COMMIT_SHA?.trim() || null,
    schemaVersion: env.SONDE_SCHEMA_VERSION?.trim() || null,
    agentBackend: getAgentBackend(env),
    managedConfigured,
    sondeMcpConfigured:
      Boolean(env.SONDE_PUBLIC_AGENT_BASE_URL?.trim()) ||
      Boolean(env.SONDE_MANAGED_SONDE_MCP_URL?.trim()) ||
      true,
    githubConfigured: hasGitHubAccess(env),
    anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    anthropicAdminConfigured: Boolean(env.ANTHROPIC_ADMIN_API_KEY?.trim()),
    costTelemetryConfigured: hasSupabaseTelemetryConfig(env),
    liveSpendEnabled: Boolean(env.ANTHROPIC_API_KEY?.trim()) && managedConfigured,
    cliGitRef: env.SONDE_CLI_GIT_REF?.trim() || null,
    supabaseProjectRef: getSupabaseProjectRef(env),
    sharedRateLimitConfigured: hasSharedRateLimitConfig(env),
    sharedRateLimitRequired: isSharedRateLimitRequired(env),
  };
}
