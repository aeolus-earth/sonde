import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACT_PATH = path.resolve(
  __dirname,
  "../../../config/hosted-environments.json",
);

const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "githubEnvironment",
  "runtimeEnvironment",
  "uiDefaultUrl",
  "agentDefaultUrl",
  "supabaseRedirectUrls",
  "expectedExperimentId",
]);

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanFlag(value, fallback = false) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true";
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(trim(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return Boolean(url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

function normalizeCsv(values) {
  return values.map((value) => value.trim()).filter(Boolean).join(",");
}

export function loadHostedEnvironmentContract(
  contractPath = DEFAULT_CONTRACT_PATH,
) {
  return JSON.parse(fs.readFileSync(contractPath, "utf8"));
}

export function validateHostedEnvironmentContract(contract) {
  const errors = [];

  if (contract?.schemaVersion !== 1) {
    errors.push("Hosted environment contract must declare schemaVersion 1.");
  }

  const parity = contract?.parity;
  if (!parity || typeof parity !== "object") {
    errors.push("Hosted environment contract is missing the parity section.");
  }

  const environments = contract?.environments;
  if (!environments || typeof environments !== "object") {
    errors.push("Hosted environment contract is missing environments.");
    return errors;
  }

  for (const name of ["staging", "production"]) {
    if (!environments[name]) {
      errors.push(`Hosted environment contract is missing '${name}'.`);
      continue;
    }
    for (const key of Object.keys(environments[name])) {
      if (!ALLOWED_ENVIRONMENT_KEYS.has(key)) {
        errors.push(
          `Hosted environment contract '${name}' contains unsupported key '${key}'.`,
        );
      }
    }
    if (!trim(environments[name].runtimeEnvironment)) {
      errors.push(`Hosted environment contract '${name}' is missing runtimeEnvironment.`);
    }
    if (!trim(environments[name].uiDefaultUrl)) {
      errors.push(`Hosted environment contract '${name}' is missing uiDefaultUrl.`);
    } else if (!isValidUrl(environments[name].uiDefaultUrl)) {
      errors.push(
        `Hosted environment contract '${name}' has an invalid uiDefaultUrl.`,
      );
    }
    if (!Array.isArray(environments[name].supabaseRedirectUrls)) {
      errors.push(
        `Hosted environment contract '${name}' is missing supabaseRedirectUrls.`,
      );
    } else if (environments[name].supabaseRedirectUrls.length === 0) {
      errors.push(
        `Hosted environment contract '${name}' must declare at least one Supabase redirect URL.`,
      );
    }
    if (!trim(environments[name].expectedExperimentId)) {
      errors.push(
        `Hosted environment contract '${name}' is missing expectedExperimentId.`,
      );
    }
  }

  if (parity) {
    const requiredParityKeys = [
      "agentBackend",
      "agentUrlRequired",
      "supabaseProjectRefRequired",
      "supabaseAnonKeyRequired",
      "smokeUserRequired",
      "cliAuditTokenRequired",
      "runtimeAuditTokenRequired",
      "googleOAuthRequired",
      "requireManagedAuth",
      "requireSharedRateLimit",
      "storageFileSizeLimit",
      "expectedProgramId",
      "expectedTimelineAuthMode",
      "audit",
      "managedAuthAudit",
    ];
    for (const key of requiredParityKeys) {
      if (!(key in parity)) {
        errors.push(`Hosted environment parity is missing '${key}'.`);
      }
    }
  }

  return errors;
}

export function resolveHostedEnvironment(
  name,
  env = process.env,
  contract = loadHostedEnvironmentContract(),
) {
  const parity = contract.parity ?? {};
  const environment = contract.environments?.[name];
  if (!environment) {
    throw new Error(`Unknown hosted environment '${name}'.`);
  }

  return {
    schemaVersion: contract.schemaVersion,
    name,
    githubEnvironment: trim(environment.githubEnvironment) || name,
    runtimeEnvironment: trim(environment.runtimeEnvironment) || name,
    agentBackend: trim(parity.agentBackend) || "managed",
    uiUrl: trim(env.HOSTED_UI_URL) || trim(environment.uiDefaultUrl),
    agentUrl: trim(env.HOSTED_AGENT_URL) || trim(environment.agentDefaultUrl),
    supabaseProjectRef: trim(env.HOSTED_SUPABASE_PROJECT_REF),
    supabaseAnonKey: trim(env.HOSTED_SUPABASE_ANON_KEY),
    smokeUserEmailConfigured: Boolean(trim(env.HOSTED_SMOKE_USER_EMAIL)),
    smokeUserPasswordConfigured: Boolean(trim(env.HOSTED_SMOKE_USER_PASSWORD)),
    cliAuditTokenConfigured: Boolean(trim(env.HOSTED_CLI_AUDIT_TOKEN)),
    runtimeAuditTokenConfigured: Boolean(trim(env.HOSTED_RUNTIME_AUDIT_TOKEN)),
    redisUrlConfigured: Boolean(trim(env.HOSTED_REDIS_URL)),
    redisTokenConfigured: Boolean(trim(env.HOSTED_REDIS_TOKEN)),
    googleClientIdConfigured: Boolean(trim(env.HOSTED_GOOGLE_CLIENT_ID)),
    googleClientSecretConfigured: Boolean(trim(env.HOSTED_GOOGLE_CLIENT_SECRET)),
    requireSharedRateLimit: parseBooleanFlag(
      env.HOSTED_REQUIRE_SHARED_RATE_LIMIT,
      Boolean(parity.requireSharedRateLimit),
    ),
    requirements: {
      agentUrlRequired: Boolean(parity.agentUrlRequired),
      supabaseProjectRefRequired: Boolean(parity.supabaseProjectRefRequired),
      supabaseAnonKeyRequired: Boolean(parity.supabaseAnonKeyRequired),
      smokeUserRequired: Boolean(parity.smokeUserRequired),
      cliAuditTokenRequired: Boolean(parity.cliAuditTokenRequired),
      runtimeAuditTokenRequired: Boolean(parity.runtimeAuditTokenRequired),
      googleOAuthRequired: Boolean(parity.googleOAuthRequired),
      requireManagedAuth: Boolean(parity.requireManagedAuth),
    },
    storageFileSizeLimit:
      trim(environment.storageFileSizeLimit) ||
      trim(parity.storageFileSizeLimit) ||
      "50MiB",
    supabaseRedirectUrls: Array.isArray(environment.supabaseRedirectUrls)
      ? environment.supabaseRedirectUrls.map((value) => trim(value)).filter(Boolean)
      : [],
    expectedProgramId: trim(environment.expectedProgramId) || trim(parity.expectedProgramId),
    expectedExperimentId: trim(environment.expectedExperimentId),
    expectedTimelineAuthMode:
      trim(environment.expectedTimelineAuthMode) ||
      trim(parity.expectedTimelineAuthMode),
    audit: {
      requireAnthropic: Boolean(parity.audit?.requireAnthropic ?? true),
      requireAgentCommitMatch: Boolean(
        parity.audit?.requireAgentCommitMatch ?? false,
      ),
      requireFirstPartyAgent: Boolean(
        parity.audit?.requireFirstPartyAgent ?? false,
      ),
      waitTimeoutMs: parsePositiveInt(
        String(parity.audit?.waitTimeoutMs ?? ""),
        600000,
      ),
      waitIntervalMs: parsePositiveInt(
        String(parity.audit?.waitIntervalMs ?? ""),
        10000,
      ),
    },
    managedAuthAudit: {
      prompt: trim(parity.managedAuthAudit?.prompt),
      expectSubstring: trim(parity.managedAuthAudit?.expectSubstring),
      staleSession: Boolean(parity.managedAuthAudit?.staleSession),
      requireToolUse: Boolean(parity.managedAuthAudit?.requireToolUse),
      timeoutMs: parsePositiveInt(
        String(parity.managedAuthAudit?.timeoutMs ?? ""),
        180000,
      ),
      prewarmTimeoutMs: parsePositiveInt(
        String(parity.managedAuthAudit?.prewarmTimeoutMs ?? ""),
        300000,
      ),
      retryIntervalMs: parsePositiveInt(
        String(parity.managedAuthAudit?.retryIntervalMs ?? ""),
        10000,
      ),
    },
  };
}

export function validateResolvedHostedEnvironment(resolved) {
  const errors = [];

  if (!resolved.uiUrl) {
    errors.push("HOSTED_UI_URL is required.");
  } else if (!isValidUrl(resolved.uiUrl)) {
    errors.push("HOSTED_UI_URL must be a valid http(s) URL.");
  }

  if (resolved.requirements.agentUrlRequired) {
    if (!resolved.agentUrl) {
      errors.push("HOSTED_AGENT_URL is required.");
    } else if (!isValidUrl(resolved.agentUrl)) {
      errors.push("HOSTED_AGENT_URL must be a valid http(s) URL.");
    }
  } else if (resolved.agentUrl && !isValidUrl(resolved.agentUrl)) {
    errors.push("HOSTED_AGENT_URL must be a valid http(s) URL.");
  }

  if (resolved.requirements.supabaseProjectRefRequired && !resolved.supabaseProjectRef) {
    errors.push("HOSTED_SUPABASE_PROJECT_REF is required.");
  }

  if (resolved.requirements.supabaseAnonKeyRequired) {
    if (!resolved.supabaseAnonKey) {
      errors.push("HOSTED_SUPABASE_ANON_KEY is required.");
    } else if (!resolved.supabaseAnonKey.startsWith("sb_publishable_")) {
      errors.push("HOSTED_SUPABASE_ANON_KEY must be a publishable key.");
    }
  }

  if (resolved.requirements.smokeUserRequired) {
    if (!resolved.smokeUserEmailConfigured) {
      errors.push("HOSTED_SMOKE_USER_EMAIL is required.");
    }
    if (!resolved.smokeUserPasswordConfigured) {
      errors.push("HOSTED_SMOKE_USER_PASSWORD is required.");
    }
  }

  if (resolved.requirements.cliAuditTokenRequired && !resolved.cliAuditTokenConfigured) {
    errors.push("HOSTED_CLI_AUDIT_TOKEN is required.");
  }

  if (
    resolved.requirements.runtimeAuditTokenRequired &&
    !resolved.runtimeAuditTokenConfigured
  ) {
    errors.push("HOSTED_RUNTIME_AUDIT_TOKEN is required.");
  }

  if (resolved.requirements.googleOAuthRequired) {
    if (!resolved.googleClientIdConfigured) {
      errors.push("HOSTED_GOOGLE_CLIENT_ID is required.");
    }
    if (!resolved.googleClientSecretConfigured) {
      errors.push("HOSTED_GOOGLE_CLIENT_SECRET is required.");
    }
  }

  if (resolved.requireSharedRateLimit) {
    if (!resolved.redisUrlConfigured) {
      errors.push("HOSTED_REDIS_URL is required when shared rate limiting is enabled.");
    }
    if (!resolved.redisTokenConfigured) {
      errors.push(
        "HOSTED_REDIS_TOKEN is required when shared rate limiting is enabled.",
      );
    }
  }

  if (!resolved.expectedProgramId) {
    errors.push("Hosted environment contract is missing expectedProgramId.");
  }
  if (!resolved.expectedExperimentId) {
    errors.push("Hosted environment contract is missing expectedExperimentId.");
  }
  if (!resolved.expectedTimelineAuthMode) {
    errors.push("Hosted environment contract is missing expectedTimelineAuthMode.");
  }
  if (!resolved.managedAuthAudit.prompt) {
    errors.push("Hosted environment contract is missing managedAuthAudit.prompt.");
  }
  if (!resolved.managedAuthAudit.expectSubstring) {
    errors.push(
      "Hosted environment contract is missing managedAuthAudit.expectSubstring.",
    );
  }
  if (!resolved.supabaseRedirectUrls.length) {
    errors.push("Hosted environment contract is missing Supabase redirect URLs.");
  }

  return errors;
}

export function formatHostedEnvironmentForGithubOutputs(resolved) {
  return {
    schema_version: String(resolved.schemaVersion),
    github_environment: resolved.githubEnvironment,
    runtime_environment: resolved.runtimeEnvironment,
    agent_backend: resolved.agentBackend,
    ui_url: resolved.uiUrl,
    agent_url: resolved.agentUrl,
    supabase_project_ref: resolved.supabaseProjectRef,
    supabase_anon_key: resolved.supabaseAnonKey,
    require_shared_rate_limit: String(resolved.requireSharedRateLimit),
    site_url: resolved.uiUrl,
    redirect_urls_csv: normalizeCsv(resolved.supabaseRedirectUrls),
    storage_file_size_limit: resolved.storageFileSizeLimit,
    smoke_expected_program_id: resolved.expectedProgramId,
    smoke_expected_experiment_id: resolved.expectedExperimentId,
    smoke_expected_timeline_auth_mode: resolved.expectedTimelineAuthMode,
    audit_require_anthropic: String(resolved.audit.requireAnthropic),
    audit_require_agent_commit_match: String(
      resolved.audit.requireAgentCommitMatch,
    ),
    audit_require_first_party_agent: String(
      resolved.audit.requireFirstPartyAgent,
    ),
    audit_wait_timeout_ms: String(resolved.audit.waitTimeoutMs),
    audit_wait_interval_ms: String(resolved.audit.waitIntervalMs),
    managed_auth_audit_prompt: resolved.managedAuthAudit.prompt,
    managed_auth_audit_expect_substring:
      resolved.managedAuthAudit.expectSubstring,
    managed_auth_audit_stale_session: String(
      resolved.managedAuthAudit.staleSession,
    ),
    managed_auth_audit_require_tool_use: String(
      resolved.managedAuthAudit.requireToolUse,
    ),
    managed_auth_audit_timeout_ms: String(resolved.managedAuthAudit.timeoutMs),
    managed_auth_audit_prewarm_timeout_ms: String(
      resolved.managedAuthAudit.prewarmTimeoutMs,
    ),
    managed_auth_audit_retry_interval_ms: String(
      resolved.managedAuthAudit.retryIntervalMs,
    ),
  };
}

export function formatHostedEnvironmentForLogs(resolved) {
  return {
    schemaVersion: resolved.schemaVersion,
    name: resolved.name,
    githubEnvironment: resolved.githubEnvironment,
    runtimeEnvironment: resolved.runtimeEnvironment,
    agentBackend: resolved.agentBackend,
    uiUrl: resolved.uiUrl,
    agentUrl: resolved.agentUrl,
    supabaseProjectRef: resolved.supabaseProjectRef,
    requireSharedRateLimit: resolved.requireSharedRateLimit,
    storageFileSizeLimit: resolved.storageFileSizeLimit,
    supabaseRedirectUrls: resolved.supabaseRedirectUrls,
    expectedProgramId: resolved.expectedProgramId,
    expectedExperimentId: resolved.expectedExperimentId,
    expectedTimelineAuthMode: resolved.expectedTimelineAuthMode,
    audit: resolved.audit,
    managedAuthAudit: {
      promptConfigured: Boolean(resolved.managedAuthAudit.prompt),
      expectSubstringConfigured: Boolean(resolved.managedAuthAudit.expectSubstring),
      staleSession: resolved.managedAuthAudit.staleSession,
      requireToolUse: resolved.managedAuthAudit.requireToolUse,
      timeoutMs: resolved.managedAuthAudit.timeoutMs,
      prewarmTimeoutMs: resolved.managedAuthAudit.prewarmTimeoutMs,
      retryIntervalMs: resolved.managedAuthAudit.retryIntervalMs,
    },
  };
}
