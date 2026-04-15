import { getAgentBackend } from "./runtime-mode.js";
import {
  hasSharedRateLimitConfig,
  getInternalAdminTokenStatus,
  isSharedRateLimitRequired,
} from "./security-config.js";
import { hasGitHubAccess } from "./github.js";
import { hasSupabaseTelemetryConfig, telemetryRequiresServiceRole } from "./supabase.js";
import { getManagedSessionCostThresholds } from "./managed/pricing.js";
import { getManagedRuntimeConfigStatus } from "./managed/config.js";
import { getDeviceAuthRuntimeStatus } from "./device-auth.js";

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
  managedCostProviderConfigured: boolean;
  managedCostProviderConfigError: string | null;
  managedCostReconcileConfigured: boolean;
  managedCostReconcileConfigError: string | null;
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
  deviceAuthEnabled: boolean;
  deviceAuthConfigError: string | null;
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

/**
 * Resolves the deployed commit SHA from the first-set env var.
 *
 * Order: SONDE_COMMIT_SHA (explicit override) → RAILWAY_GIT_COMMIT_SHA
 * (platform-provided on Railway) → VERCEL_GIT_COMMIT_SHA (platform-provided
 * on Vercel) → null.
 *
 * Keep this the single source of truth — startup logs, /health, and
 * /health/runtime all call through here so a future platform swap or
 * override rule is a one-line change.
 */
export function getCommitSha(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return (
    env.SONDE_COMMIT_SHA?.trim() ||
    env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    null
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
  const internalAdminStatus = getInternalAdminTokenStatus(env);
  const deviceAuthStatus = getDeviceAuthRuntimeStatus(env);
  const thresholds = getManagedSessionCostThresholds(env);
  const telemetryConfigured = hasSupabaseTelemetryConfig(env);
  return {
    status: "ok",
    environment: getRuntimeEnvironment(env),
    commitSha: getCommitSha(env),
    schemaVersion: env.SONDE_SCHEMA_VERSION?.trim() || null,
    agentBackend: getAgentBackend(env),
    managedConfigured: managedStatus.managedConfigured,
    sondeMcpConfigured: true,
    githubConfigured: hasGitHubAccess(env),
    anthropicConfigured: managedStatus.anthropic.valid,
    anthropicConfigError: managedStatus.anthropic.error,
    anthropicAdminConfigured: managedStatus.anthropicAdmin.valid,
    anthropicAdminConfigError: managedStatus.anthropicAdmin.error,
    managedCostProviderConfigured: managedStatus.anthropicAdmin.valid,
    managedCostProviderConfigError: managedStatus.anthropicAdmin.error,
    managedCostReconcileConfigured: internalAdminStatus.valid,
    managedCostReconcileConfigError: internalAdminStatus.error,
    managedConfigError: managedStatus.managedConfigError,
    costTelemetryConfigured: telemetryConfigured,
    liveSpendEnabled: managedStatus.managedConfigured && telemetryConfigured,
    telemetryRequiresServiceRole: telemetryRequiresServiceRole(env),
    managedSessionWarnUsd: thresholds.warnUsd,
    managedSessionCriticalUsd: thresholds.criticalUsd,
    cliGitRef: env.SONDE_CLI_GIT_REF?.trim() || null,
    supabaseProjectRef: getSupabaseProjectRef(env),
    sharedRateLimitConfigured: hasSharedRateLimitConfig(env),
    sharedRateLimitRequired: isSharedRateLimitRequired(env),
    deviceAuthEnabled: deviceAuthStatus.enabled,
    deviceAuthConfigError: deviceAuthStatus.configError,
  };
}
