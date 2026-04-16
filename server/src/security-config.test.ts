import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertSecurityConfig,
  getInternalAdminTokenStatus,
  hasSharedRateLimitConfig,
  isSharedRateLimitRequired,
} from "./security-config.js";

describe("assertSecurityConfig", () => {
  it("allows test-only bypass configuration in test", () => {
    assert.doesNotThrow(() =>
      assertSecurityConfig({
        NODE_ENV: "test",
        SONDE_TEST_AUTH_BYPASS_TOKEN: "test-bypass",
      }),
    );
  });

  it("rejects bypass configuration outside test", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "production",
          SONDE_TEST_AUTH_BYPASS_TOKEN: "test-bypass",
          SONDE_WS_TOKEN_SECRET: "ws",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
        }),
      /NODE_ENV=test/,
    );
  });

  it("requires runtime audit and websocket config in strict environments", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "staging",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
        }),
      /SONDE_WS_TOKEN_SECRET is required/,
    );
  });

  it("requires shared redis config only when explicitly enabled", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "staging",
          SONDE_WS_TOKEN_SECRET: "ws",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
          SONDE_REQUIRE_SHARED_RATE_LIMIT: "true",
        }),
      /Shared Redis rate limiting is required/,
    );
  });

  it("requires managed Anthropic runtime config in strict environments", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "production",
          SONDE_WS_TOKEN_SECRET: "ws",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
          SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
          SUPABASE_SERVICE_ROLE_KEY: "service-role",
        }),
      /ANTHROPIC_API_KEY is not configured/,
    );
  });

  it("rejects malformed managed Anthropic auth in strict environments", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "production",
          SONDE_WS_TOKEN_SECRET: "ws",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
          SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
          SUPABASE_SERVICE_ROLE_KEY: "service-role",
          ANTHROPIC_API_KEY: "$(python - <<'PY' print('bad') PY)",
          SONDE_MANAGED_ENVIRONMENT_ID: "env_prod",
          SONDE_MANAGED_AGENT_ID: "agent_prod",
        }),
      /unevaluated shell or template syntax/,
    );
  });

  it("requires a dedicated device auth encryption key in strict environments", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "production",
          SONDE_WS_TOKEN_SECRET: "ws",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
          SONDE_ALLOWED_ORIGINS: "https://sonde-neon.vercel.app",
          SUPABASE_SERVICE_ROLE_KEY: "service-role",
          ANTHROPIC_API_KEY: "sk-ant-valid",
          SONDE_MANAGED_ENVIRONMENT_ID: "env_prod",
          SONDE_MANAGED_AGENT_ID: "agent_prod",
        }),
      /SONDE_DEVICE_AUTH_ENCRYPTION_KEY is not configured/,
    );
  });

  it("validates the internal admin token as a single-line secret", () => {
    const missing = getInternalAdminTokenStatus({});
    assert.equal(missing.valid, false);
    assert.match(missing.error ?? "", /SONDE_INTERNAL_ADMIN_TOKEN/);

    const malformed = getInternalAdminTokenStatus({
      SONDE_INTERNAL_ADMIN_TOKEN: "bad token",
    });
    assert.equal(malformed.valid, false);
    assert.match(malformed.error ?? "", /single-line header-safe secret/);

    const valid = getInternalAdminTokenStatus({
      SONDE_INTERNAL_ADMIN_TOKEN: "internal-admin-token",
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.value, "internal-admin-token");
  });

  // Fallback-chain branch coverage for security-config env vars.
  //
  // Every env-var with a `foo || bar || baz` fallback needs one test per
  // branch. Previously, tests set only the "first" variable in each chain,
  // so a regression that dropped a later-branch read (e.g. UPSTASH_*)
  // would pass silently. Mirrors the coverage pattern established for
  // `getCommitSha` in runtime-metadata.test.ts.

  describe("GitHub server token fallback chain", () => {
    // Chain: GITHUB_TOKEN || GH_TOKEN || SONDE_GITHUB_TOKEN
    // Tested via assertSecurityConfig, which throws when the token is
    // configured without an allowlist. Each branch should independently
    // activate the throw.
    const strictBase = {
      NODE_ENV: "staging",
      SONDE_WS_TOKEN_SECRET: "ws",
      SONDE_RUNTIME_AUDIT_TOKEN: "audit",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      ANTHROPIC_API_KEY: "sk-ant-valid",
      SONDE_MANAGED_ENVIRONMENT_ID: "env_staging",
      SONDE_MANAGED_AGENT_ID: "agent_staging",
      SONDE_DEVICE_AUTH_ENCRYPTION_KEY:
        "dev-key-that-is-at-least-32-characters-long-0000",
      SONDE_ALLOWED_ORIGINS: "https://sonde-staging.vercel.app",
    } as const;

    it("detects GITHUB_TOKEN and requires allowlist", () => {
      assert.throws(
        () => assertSecurityConfig({ ...strictBase, GITHUB_TOKEN: "ghp_example" }),
        /SONDE_GITHUB_ALLOWED_REPOS must be set/,
      );
    });

    it("detects GH_TOKEN and requires allowlist", () => {
      assert.throws(
        () => assertSecurityConfig({ ...strictBase, GH_TOKEN: "ghp_example" }),
        /SONDE_GITHUB_ALLOWED_REPOS must be set/,
      );
    });

    it("detects SONDE_GITHUB_TOKEN and requires allowlist", () => {
      assert.throws(
        () =>
          assertSecurityConfig({
            ...strictBase,
            SONDE_GITHUB_TOKEN: "ghp_example",
          }),
        /SONDE_GITHUB_ALLOWED_REPOS must be set/,
      );
    });

    it("does not throw when no GitHub token is set", () => {
      assert.doesNotThrow(() => assertSecurityConfig(strictBase));
    });
  });

  describe("shared Redis rate-limit URL/token fallback chain", () => {
    // URL chain: SONDE_REDIS_REST_URL || UPSTASH_REDIS_REST_URL
    // Token chain: SONDE_REDIS_REST_TOKEN || UPSTASH_REDIS_REST_TOKEN
    // Both must be present for `hasSharedRateLimitConfig` to return true.

    it("detects SONDE_* Redis URL and token pair", () => {
      assert.equal(
        hasSharedRateLimitConfig({
          SONDE_REDIS_REST_URL: "https://redis.example.com",
          SONDE_REDIS_REST_TOKEN: "redis-token",
        }),
        true,
      );
    });

    it("detects UPSTASH_* Redis URL and token pair", () => {
      assert.equal(
        hasSharedRateLimitConfig({
          UPSTASH_REDIS_REST_URL: "https://redis.example.com",
          UPSTASH_REDIS_REST_TOKEN: "redis-token",
        }),
        true,
      );
    });

    it("accepts mixed SONDE_URL + UPSTASH_TOKEN pairing", () => {
      // The chain is independent per-variable, so either namespace works
      // for URL and token. This pins that independence.
      assert.equal(
        hasSharedRateLimitConfig({
          SONDE_REDIS_REST_URL: "https://redis.example.com",
          UPSTASH_REDIS_REST_TOKEN: "redis-token",
        }),
        true,
      );
    });

    it("returns false when only URL is set (token missing)", () => {
      assert.equal(
        hasSharedRateLimitConfig({
          SONDE_REDIS_REST_URL: "https://redis.example.com",
        }),
        false,
      );
    });

    it("returns false when only token is set (URL missing)", () => {
      assert.equal(
        hasSharedRateLimitConfig({
          SONDE_REDIS_REST_TOKEN: "redis-token",
        }),
        false,
      );
    });

    it("returns false when neither is set", () => {
      assert.equal(hasSharedRateLimitConfig({}), false);
    });

    it("treats whitespace-only values as unset", () => {
      assert.equal(
        hasSharedRateLimitConfig({
          SONDE_REDIS_REST_URL: "   ",
          SONDE_REDIS_REST_TOKEN: "redis-token",
        }),
        false,
      );
    });
  });

  describe("shared rate-limit requirement flag fallback chain", () => {
    // Chain: SONDE_REQUIRE_SHARED_RATE_LIMIT || SONDE_REQUIRE_SHARED_REDIS

    it("recognizes SONDE_REQUIRE_SHARED_RATE_LIMIT=true", () => {
      assert.equal(
        isSharedRateLimitRequired({
          SONDE_REQUIRE_SHARED_RATE_LIMIT: "true",
        }),
        true,
      );
    });

    it("recognizes SONDE_REQUIRE_SHARED_RATE_LIMIT=1", () => {
      assert.equal(
        isSharedRateLimitRequired({
          SONDE_REQUIRE_SHARED_RATE_LIMIT: "1",
        }),
        true,
      );
    });

    it("recognizes the legacy SONDE_REQUIRE_SHARED_REDIS alias", () => {
      assert.equal(
        isSharedRateLimitRequired({
          SONDE_REQUIRE_SHARED_REDIS: "true",
        }),
        true,
      );
    });

    it("prefers the primary variable over the legacy alias", () => {
      // If the primary is set to a non-truthy value and the alias is
      // truthy, the primary wins (no fallthrough). Primary is empty →
      // alias is checked → returns true.
      assert.equal(
        isSharedRateLimitRequired({
          SONDE_REQUIRE_SHARED_RATE_LIMIT: "",
          SONDE_REQUIRE_SHARED_REDIS: "true",
        }),
        true,
      );
    });

    it("returns false when neither is set", () => {
      assert.equal(isSharedRateLimitRequired({}), false);
    });

    it("returns false for any non-truthy value", () => {
      for (const value of ["false", "0", "no", "off", "yes", ""]) {
        assert.equal(
          isSharedRateLimitRequired({ SONDE_REQUIRE_SHARED_RATE_LIMIT: value }),
          value === "1" || value === "true",
          `expected value="${value}" to map to ${value === "1" || value === "true"}`,
        );
      }
    });
  });
});
