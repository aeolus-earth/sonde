import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSecurityConfig } from "./security-config.js";

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
});
