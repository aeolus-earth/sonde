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
          UPSTASH_REDIS_REST_URL: "https://upstash.example.com",
          UPSTASH_REDIS_REST_TOKEN: "redis",
        }),
      /NODE_ENV=test/,
    );
  });

  it("requires runtime audit, websocket, and redis config in strict environments", () => {
    assert.throws(
      () =>
        assertSecurityConfig({
          NODE_ENV: "staging",
          SONDE_WS_TOKEN_SECRET: "ws",
          SONDE_RUNTIME_AUDIT_TOKEN: "audit",
        }),
      /Shared Redis rate limiting is required/,
    );
  });
});
