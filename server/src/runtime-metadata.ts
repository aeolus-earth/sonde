import { getAgentBackend } from "./runtime-mode.js";
import {
  hasSharedRateLimitConfig,
  isSharedRateLimitRequired,
} from "./security-config.js";
import { hasGitHubAccess } from "./github.js";
import { hasSupabaseTelemetryConfig, telemetryRequiresServiceRole } from "./supabase.js";
import { getManagedSessionCostThresholds } from "./managed/pricing.js";
import { getManagedRuntimeConfigStatus } from "./managed/config.js";

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
  anthropicConfigError: string | null;
  anthropicAdminConfigured: boolean;
  anthropicAdminConfigError: string | null;
  managedConfigError: string | null;
  costTelemetryConfigured: boolean;
  liveSpendEnabled: boolean;
  telemetryRequiresServiceRole: boolean;
  managedSessionWarnUsd: number;
  managedSessionCriticalUsd: number;
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
  const managedStatus = getManagedRuntimeConfigStatus(env);
  const thresholds = getManagedSessionCostThresholds(env);
  return {
    status: "ok",
    environment: getRuntimeEnvironment(env),
    commitSha: env.SONDE_COMMIT_SHA?.trim() || null,
    schemaVersion: env.SONDE_SCHEMA_VERSION?.trim() || null,
    agentBackend: getAgentBackend(env),
    managedConfigured: managedStatus.managedConfigured,
    sondeMcpConfigured: true,
    githubConfigured: hasGitHubAccess(env),
    anthropicConfigured: managedStatus.anthropic.valid,
    anthropicConfigError: managedStatus.anthropic.error,
    anthropicAdminConfigured: managedStatus.anthropicAdmin.valid,
    anthropicAdminConfigError: managedStatus.anthropicAdmin.error,
    managedConfigError: managedStatus.managedConfigError,
    costTelemetryConfigured: hasSupabaseTelemetryConfig(env),
    liveSpendEnabled: managedStatus.managedConfigured,
    telemetryRequiresServiceRole: telemetryRequiresServiceRole(env),
    managedSessionWarnUsd: thresholds.warnUsd,
    managedSessionCriticalUsd: thresholds.criticalUsd,
    cliGitRef: env.SONDE_CLI_GIT_REF?.trim() || null,
    supabaseProjectRef: getSupabaseProjectRef(env),
    sharedRateLimitConfigured: hasSharedRateLimitConfig(env),
    sharedRateLimitRequired: isSharedRateLimitRequired(env),
  };
}
