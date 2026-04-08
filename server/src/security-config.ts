import { timingSafeEqual, createHash } from "node:crypto";

function getEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.SONDE_ENVIRONMENT?.trim() ||
    env.NODE_ENV?.trim() ||
    "development"
  );
}

function isStrictEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const current = getEnvironment(env);
  return current === "production" || current === "staging";
}

function normalizeSecret(
  value: string | undefined,
  fallback: string | null,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed) return trimmed;
  return fallback;
}

export function getWsTokenSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return normalizeSecret(
    env.SONDE_WS_TOKEN_SECRET,
    isStrictEnvironment(env) ? null : "sonde-dev-ws-token-secret",
  );
}

export function getRuntimeAuditToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return normalizeSecret(
    env.SONDE_RUNTIME_AUDIT_TOKEN,
    isStrictEnvironment(env) ? null : "sonde-dev-runtime-audit-token",
  );
}

export function getGitHubAllowedRepos(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  return new Set(
    (env.SONDE_GITHUB_ALLOWED_REPOS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hasGitHubServerToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.GITHUB_TOKEN?.trim() ||
      env.GH_TOKEN?.trim() ||
      env.SONDE_GITHUB_TOKEN?.trim(),
  );
}

function hasSharedRedisRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const url =
    env.SONDE_REDIS_REST_URL?.trim() || env.UPSTASH_REDIS_REST_URL?.trim() || "";
  const token =
    env.SONDE_REDIS_REST_TOKEN?.trim() || env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  return Boolean(url && token);
}

export function isSharedRateLimitRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw =
    env.SONDE_REQUIRE_SHARED_RATE_LIMIT?.trim().toLowerCase() ||
    env.SONDE_REQUIRE_SHARED_REDIS?.trim().toLowerCase() ||
    "";
  return raw === "1" || raw === "true";
}

export function hasSharedRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasSharedRedisRateLimitConfig(env);
}

export function assertSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const bypass = env.SONDE_TEST_AUTH_BYPASS_TOKEN?.trim();
  if (bypass && env.NODE_ENV !== "test") {
    throw new Error(
      "SONDE_TEST_AUTH_BYPASS_TOKEN may only be set when NODE_ENV=test",
    );
  }

  if (!isStrictEnvironment(env)) return;

  if (!getWsTokenSecret(env)) {
    throw new Error(
      "SONDE_WS_TOKEN_SECRET is required in staging and production",
    );
  }

  if (!getRuntimeAuditToken(env)) {
    throw new Error(
      "SONDE_RUNTIME_AUDIT_TOKEN is required in staging and production",
    );
  }

  if (
    isSharedRateLimitRequired(env) &&
    !hasSharedRedisRateLimitConfig(env)
  ) {
    throw new Error(
      "Shared Redis rate limiting is required when SONDE_REQUIRE_SHARED_RATE_LIMIT is enabled. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }

  if (hasGitHubServerToken(env) && getGitHubAllowedRepos(env).size === 0) {
    throw new Error(
      "SONDE_GITHUB_ALLOWED_REPOS must be set when a server GitHub token is configured",
    );
  }
}

export function constantTimeSecretEquals(
  expected: string | null,
  provided: string,
): boolean {
  if (!expected) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
