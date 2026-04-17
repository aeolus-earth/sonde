import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp, getAllowedOrigins } from "./app.js";
import { resetGitHubCachesForTests } from "./github.js";
import { resetManagedClientStateForTests } from "./managed/client.js";
import { resetManagedSessionCacheForTests } from "./managed/session-cache.js";
import { resetDeviceAuthStateForTests } from "./device-auth.js";
import { resetRequestGuardsForTests } from "./request-guard.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const authToken = "playwright-smoke-token";

beforeEach(() => {
  process.env.SONDE_TEST_AUTH_BYPASS_TOKEN = authToken;
  process.env.NODE_ENV = "test";
  process.env.SONDE_WS_TOKEN_SECRET = "test-ws-secret";
  process.env.SONDE_RUNTIME_AUDIT_TOKEN = "test-runtime-token";
  delete process.env.SONDE_COMMIT_SHA;
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  resetGitHubCachesForTests();
  resetManagedClientStateForTests();
  resetManagedSessionCacheForTests();
  resetDeviceAuthStateForTests();
  resetRequestGuardsForTests();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  resetGitHubCachesForTests();
  resetManagedClientStateForTests();
  resetManagedSessionCacheForTests();
  resetDeviceAuthStateForTests();
  resetRequestGuardsForTests();
});

describe("createApp", () => {
  it("combines local and hosted browser origins", () => {
    const origins = getAllowedOrigins({
      SONDE_ALLOWED_ORIGINS:
        "https://sonde-staging.vercel.app, https://sonde-neon.vercel.app/",
    });

    assert.deepEqual(origins, [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
      "http://localhost:4174",
      "http://127.0.0.1:4174",
      "https://sonde-staging.vercel.app",
      "https://sonde-neon.vercel.app",
    ]);
  });

  it("returns a minimal public health response", async () => {
    // /health is liveness-only by contract — the deployed-stack audit fails
    // if it leaks any metadata. Commit SHA lives on /health/runtime instead.
    process.env.SONDE_COMMIT_SHA = "abc123";
    process.env.SONDE_ENVIRONMENT = "production";
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test-key";
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    const app = createApp();

    const response = await app.request("http://localhost/health");
    assert.equal(response.status, 200);

    const body = (await response.json()) as { status: string };
    assert.deepEqual(body, { status: "ok" });
  });

  it("returns runtime metadata only with the audit bearer token", async () => {
    process.env.SONDE_COMMIT_SHA = "abc123";
    process.env.SONDE_SCHEMA_VERSION = "20260407000123";
    process.env.SONDE_CLI_GIT_REF = "refs/heads/staging";
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test-key";
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    const app = createApp();

    const unauthorized = await app.request("http://localhost/health/runtime");
    assert.equal(unauthorized.status, 401);

    const response = await app.request("http://localhost/health/runtime", {
      headers: {
        Authorization: "Bearer test-runtime-token",
      },
    });
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      status: string;
      environment: string;
      commitSha: string | null;
      schemaVersion: string | null;
      agentBackend: string;
      managedConfigured: boolean;
      managedConfigError: string | null;
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
      costTelemetryConfigured: boolean;
      liveSpendEnabled: boolean;
      telemetryRequiresServiceRole: boolean;
      cliGitRef: string | null;
      supabaseProjectRef: string | null;
      sharedRateLimitConfigured: boolean;
      sharedRateLimitRequired: boolean;
      deviceAuthEnabled: boolean;
      deviceAuthConfigError: string | null;
    };

    assert.deepEqual(body, {
      status: "ok",
      environment: "test",
      commitSha: "abc123",
      schemaVersion: "20260407000123",
      agentBackend: "managed",
      managedConfigured: false,
      managedConfigError:
        "SONDE_MANAGED_ENVIRONMENT_ID is not configured.",
      sondeMcpConfigured: true,
      githubConfigured: false,
      anthropicConfigured: true,
      anthropicConfigError: null,
      anthropicAdminConfigured: false,
      anthropicAdminConfigError: "ANTHROPIC_ADMIN_API_KEY is not configured.",
      managedCostProviderConfigured: false,
      managedCostProviderConfigError: "ANTHROPIC_ADMIN_API_KEY is not configured.",
      managedCostReconcileConfigured: false,
      managedCostReconcileConfigError: "SONDE_INTERNAL_ADMIN_TOKEN is not configured.",
      costTelemetryConfigured: false,
      liveSpendEnabled: false,
      telemetryRequiresServiceRole: false,
      managedSessionWarnUsd: 1,
      managedSessionCriticalUsd: 5,
      cliGitRef: "refs/heads/staging",
      supabaseProjectRef: "oxajsxoedrmvrcatqser",
      sharedRateLimitConfigured: false,
      sharedRateLimitRequired: false,
      deviceAuthEnabled: true,
      deviceAuthConfigError: null,
    });
  });

  it("returns public device-auth health without secrets", async () => {
    process.env.SONDE_PUBLIC_APP_ORIGIN = "https://sonde-neon.vercel.app";
    const app = createApp();

    const response = await app.request("http://localhost/auth/device/health");
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      status: string;
      enabled: boolean;
    };

    assert.deepEqual(body, {
      status: "ok",
      enabled: true,
    });
  });

  it("reports when device-auth configuration is unavailable", async () => {
    process.env.SONDE_ENVIRONMENT = "production";
    delete process.env.SONDE_PUBLIC_APP_ORIGIN;
    delete process.env.SONDE_ALLOWED_ORIGINS;
    delete process.env.SONDE_DEVICE_AUTH_ENCRYPTION_KEY;
    const app = createApp();

    const response = await app.request("http://localhost/auth/device/health");
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      status: string;
      enabled: boolean;
    };

    assert.deepEqual(body, {
      status: "ok",
      enabled: false,
    });
  });

  it("exchanges opaque agent tokens through service-role validation and Supabase Auth", async () => {
    process.env.VITE_SUPABASE_URL = "https://utvmqjssbkzpumsdpgdy.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "sb_publishable_test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const tokenId = "00000000-0000-0000-0000-000000000042";
    const agentEmail = `agent-${tokenId}@aeolus.earth`;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);

      if (url.pathname === "/rest/v1/rpc/exchange_agent_token") {
        const body = (await request.json()) as { p_token_hash: string };
        assert.match(body.p_token_hash, /^[0-9a-f]{64}$/);
        assert.equal(request.headers.get("authorization"), "Bearer service-role-key");
        return new Response(
          JSON.stringify({
            token_id: tokenId,
            name: "hosted-cli-audit",
            programs: ["weather-intervention", "shared"],
            expires_at: "2026-07-17T02:00:00Z",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.pathname === "/auth/v1/admin/users" && request.method === "GET") {
        assert.equal(request.headers.get("authorization"), "Bearer service-role-key");
        return new Response(JSON.stringify({ users: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/auth/v1/admin/users" && request.method === "POST") {
        assert.equal(request.headers.get("authorization"), "Bearer service-role-key");
        const body = (await request.json()) as {
          email: string;
          email_confirm: boolean;
          app_metadata: {
            agent: boolean;
            programs: string[];
            token_id: string;
            token_name: string;
          };
        };
        assert.equal(body.email, agentEmail);
        assert.equal(body.email_confirm, true);
        assert.deepEqual(body.app_metadata, {
          agent: true,
          programs: ["weather-intervention", "shared"],
          token_id: tokenId,
          token_name: "hosted-cli-audit",
          agent_name: "hosted-cli-audit",
        });
        return new Response(JSON.stringify({ id: "auth-user-id", email: agentEmail }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/auth/v1/admin/generate_link") {
        assert.equal(request.headers.get("authorization"), "Bearer service-role-key");
        const body = (await request.json()) as { type: string; email: string };
        assert.deepEqual(body, { type: "magiclink", email: agentEmail });
        return new Response(JSON.stringify({ hashed_token: "magic-link-hash" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/auth/v1/verify") {
        assert.equal(request.headers.get("authorization"), "Bearer sb_publishable_test");
        const body = (await request.json()) as { type: string; token_hash: string };
        assert.deepEqual(body, { type: "magiclink", token_hash: "magic-link-hash" });
        return new Response(
          JSON.stringify({
            access_token: "agent-access-jwt",
            token_type: "bearer",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };
    const app = createApp();

    const response = await app.request("http://localhost/auth/agent/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "sonde_ak_test-token",
        cli_version: "0.1.0",
        host_label: "ssh://stormbox",
      }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      access_token: string;
      token_type: string;
      programs: string[];
    };
    assert.equal(body.access_token, "agent-access-jwt");
    assert.equal(body.token_type, "bearer");
    assert.deepEqual(body.programs, ["weather-intervention", "shared"]);
  });

  it("rejects legacy password-bundle tokens at the exchange endpoint", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/auth/agent/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "sonde_bt_password-envelope" }),
    });

    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { type: string; message: string } };
    assert.equal(body.error.type, "unauthorized");
    assert.equal(body.error.message, "Invalid or expired agent token.");
  });

  it("completes a device login request without a localhost callback", async () => {
    const app = createApp();

    const startResponse = await app.request("http://localhost/auth/device/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        cli_version: "0.1.0",
        host_label: "ssh://stormbox",
        remote_hint: true,
        login_method: "device",
        request_metadata: {
          platform: "linux",
        },
      }),
    });
    assert.equal(startResponse.status, 200);
    const started = (await startResponse.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    };
    assert.match(started.user_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(started.verification_uri, "http://localhost:5173/activate");
    assert.match(
      started.verification_uri_complete,
      /^http:\/\/localhost:5173\/activate\?code=/,
    );

    const pendingPoll = await app.request("http://localhost/auth/device/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device_code: started.device_code,
      }),
    });
    assert.equal(pendingPoll.status, 200);
    assert.deepEqual(await pendingPoll.json(), {
      status: "authorization_pending",
      interval: started.interval,
    });

    const introspectResponse = await app.request("http://localhost/auth/device/introspect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_code: started.user_code,
      }),
    });
    assert.equal(introspectResponse.status, 200);
    const details = (await introspectResponse.json()) as {
      status: string;
      host_label: string | null;
      cli_version: string | null;
      remote_hint: boolean;
      login_method: string | null;
    };
    assert.equal(details.status, "pending");
    assert.equal(details.host_label, "ssh://stormbox");
    assert.equal(details.cli_version, "0.1.0");
    assert.equal(details.remote_hint, true);
    assert.equal(details.login_method, "device");

    const approveResponse = await app.request("http://localhost/auth/device/approve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        user_code: started.user_code,
        decision: "approve",
        session: {
          access_token: authToken,
          refresh_token: "refresh-token",
          user: {
            id: "e2e-user",
            email: "ci-smoke@aeolus.earth",
            app_metadata: { programs: ["shared"] },
            user_metadata: { full_name: "CI Smoke" },
          },
        },
      }),
    });
    assert.equal(approveResponse.status, 200);
    const approved = (await approveResponse.json()) as { status: string };
    assert.equal(approved.status, "approved");

    const approvedPoll = await app.request("http://localhost/auth/device/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device_code: started.device_code,
      }),
    });
    assert.equal(approvedPoll.status, 200);
    const completed = (await approvedPoll.json()) as {
      status: string;
      interval: number;
      session?: {
        access_token: string;
        refresh_token: string;
        user: { id: string; email?: string | null };
      };
    };
    assert.equal(completed.status, "approved");
    assert.equal(completed.interval, started.interval);
    assert.equal(completed.session?.access_token, authToken);
    assert.equal(completed.session?.refresh_token, "refresh-token");
    assert.equal(completed.session?.user.id, "e2e-user");

    const consumedPoll = await app.request("http://localhost/auth/device/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device_code: started.device_code,
      }),
    });
    assert.equal(consumedPoll.status, 200);
    assert.deepEqual(await consumedPoll.json(), {
      status: "expired_token",
      interval: started.interval,
    });
  });

  it("serves managed cost summary through the admin endpoint", async () => {
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-ant-admin-test-key";
    process.env.SONDE_INTERNAL_ADMIN_TOKEN = "internal-admin-token";
    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      if (url.pathname.endsWith("/rest/v1/managed_sessions")) {
        if (url.searchParams.get("select") === "session_id") {
          return new Response(JSON.stringify([{ session_id: "sesn_live" }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify([
            {
              session_id: "sesn_1",
              status: "active",
              created_at: new Date().toISOString(),
              estimated_total_cost_usd: 1.5,
            },
            {
              session_id: "sesn_2",
              status: "archived",
              created_at: new Date().toISOString(),
              estimated_total_cost_usd: 0.5,
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.pathname.endsWith("/rest/v1/anthropic_cost_sync_runs")) {
        return new Response(
          JSON.stringify([
            {
              id: 42,
              requested_by: "admin-user",
              environment: "staging",
              mode: "provider",
              success: true,
              starting_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
              ending_at: new Date().toISOString(),
              bucket_count: 2,
              total_cost_usd: 3,
              error_message: null,
              summary: { window_days: 7 },
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.pathname.endsWith("/rest/v1/anthropic_cost_buckets")) {
        return new Response(
          JSON.stringify([
            { id: 1, sync_run_id: 42, amount_usd: 1.25 },
            { id: 2, sync_run_id: 42, amount_usd: 1.75 },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const app = createApp();
    const response = await app.request(
      "http://localhost/admin/managed-costs/summary?days=7&environment=staging",
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      environment: string;
      providerSelectedWindowUsd: number;
      estimatedSelectedWindowUsd: number;
      activeSessions: number;
      sessionCount: number;
      providerStatus: {
        mode: string;
        reason: string;
        reconcileConfigured: boolean;
      };
      latestSuccessfulSync: { id: number } | null;
    };
    assert.equal(body.environment, "staging");
    assert.equal(body.providerSelectedWindowUsd, 3);
    assert.equal(body.estimatedSelectedWindowUsd, 2);
    assert.equal(body.activeSessions, 1);
    assert.equal(body.sessionCount, 2);
    assert.equal(body.providerStatus.mode, "provider");
    assert.equal(body.providerStatus.reason, "ok");
    assert.equal(body.providerStatus.reconcileConfigured, true);
    assert.equal(body.latestSuccessfulSync?.id, 42);
  });

  it("marks provider costs unavailable when only non-matching or estimated syncs exist", async () => {
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-ant-admin-test-key";
    delete process.env.SONDE_INTERNAL_ADMIN_TOKEN;

    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      if (url.pathname.endsWith("/rest/v1/managed_sessions")) {
        if (url.searchParams.get("select") === "session_id") {
          return new Response(JSON.stringify([{ session_id: "sesn_live_old" }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname.endsWith("/rest/v1/anthropic_cost_sync_runs")) {
        return new Response(
          JSON.stringify([
            {
              id: 9,
              requested_by: "admin-user",
              environment: "staging",
              mode: "estimated_only",
              success: true,
              starting_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
              ending_at: new Date().toISOString(),
              bucket_count: 0,
              total_cost_usd: 0,
              error_message: null,
              summary: { window_days: 7, reason: "estimated_only" },
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            },
            {
              id: 7,
              requested_by: "admin-user",
              environment: "staging",
              mode: "provider",
              success: true,
              starting_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
              ending_at: new Date().toISOString(),
              bucket_count: 1,
              total_cost_usd: 12,
              error_message: null,
              summary: { window_days: 30 },
              created_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const app = createApp();
    const response = await app.request(
      "http://localhost/admin/managed-costs/summary?days=7&environment=staging",
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      providerSelectedWindowUsd: number;
      activeSessions: number;
      providerStatus: {
        mode: string;
        reason: string;
        reconcileConfigured: boolean;
      };
      latestSuccessfulSync: { id: number } | null;
      latestAttemptedSync: { id: number } | null;
    };
    assert.equal(body.providerSelectedWindowUsd, 0);
    assert.equal(body.activeSessions, 1);
    assert.equal(body.providerStatus.mode, "estimated_only");
    assert.equal(body.providerStatus.reason, "estimated_only");
    assert.equal(body.providerStatus.reconcileConfigured, false);
    assert.equal(body.latestSuccessfulSync, null);
    assert.equal(body.latestAttemptedSync?.id, 9);
  });

  it("requires the internal admin token for scheduled cost reconciliation", async () => {
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.SONDE_INTERNAL_ADMIN_TOKEN = "internal-admin-token";
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      if (
        url.pathname.endsWith("/rest/v1/anthropic_cost_sync_runs") &&
        (init?.method ?? (input instanceof Request ? input.method : "GET")) === "POST"
      ) {
        return new Response(JSON.stringify({ id: 77 }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const app = createApp();
    const unauthorized = await app.request("http://localhost/internal/managed-costs/reconcile", {
      method: "POST",
    });
    assert.equal(unauthorized.status, 401);

    const response = await app.request("http://localhost/internal/managed-costs/reconcile", {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-admin-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ days: 3 }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      mode: string;
      syncRunId: number | null;
      reason: string | null;
    };
    assert.equal(body.mode, "estimated_only");
    assert.equal(body.syncRunId, 77);
    assert.equal(body.reason, "missing_admin_api_key");
  });

  it("lists live managed sessions outside the historical window", async () => {
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      if (url.pathname.endsWith("/rest/v1/managed_sessions")) {
        return new Response(
          JSON.stringify([
            {
              session_id: "sesn_live_old",
              status: "idle",
              created_at: "2026-01-01T00:00:00.000Z",
              estimated_total_cost_usd: 4,
            },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json", "content-range": "0-0/1" },
          },
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const app = createApp();
    const response = await app.request(
      "http://localhost/admin/managed-sessions?environment=staging&scope=live&days=1",
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      total: number;
      items: Array<{ session_id: string; status: string }>;
    };
    assert.equal(body.total, 1);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.session_id, "sesn_live_old");
    assert.equal(body.items[0]?.status, "idle");
  });

  it("returns runtime metadata from the admin runtime endpoint", async () => {
    process.env.SONDE_COMMIT_SHA = "admin-runtime-sha";
    process.env.SONDE_ENVIRONMENT = "staging";
    const app = createApp();

    const response = await app.request("http://localhost/admin/runtime", {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      environment: string;
      commitSha: string | null;
      agentBackend: string;
    };
    assert.equal(body.environment, "staging");
    assert.equal(body.commitSha, "admin-runtime-sha");
    assert.equal(body.agentBackend, "managed");
  });

  it("returns a structured 404 for missing managed session details", async () => {
    process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      if (url.pathname.endsWith("/rest/v1/managed_sessions")) {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const app = createApp();
    const response = await app.request("http://localhost/admin/managed-sessions/missing", {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    assert.equal(response.status, 404);
    const body = (await response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(body.error.type, "managed_session_missing");
    assert.equal(body.error.message, "Managed session not found.");
  });

  it("initializes the remote Sonde MCP endpoint for authenticated users", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/mcp/sonde", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "sonde-test", version: "0.0.0" },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const body = await response.text();
    assert.match(body, /"serverInfo":\{"name":"sonde","version":"0\.1\.0"\}/);
    assert.match(body, /"tools":\{"listChanged":true\}/);
  });

  it("mints a chat session token from an authenticated request", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/chat/session-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      token: string;
      expires_at: string;
    };
    assert.ok(body.token.length > 20);
    assert.ok(body.expires_at.length > 0);
  });

  it("ignores frame-auth websocket bypass in production", async () => {
    process.env.SONDE_ENVIRONMENT = "production";
    process.env.SONDE_CHAT_ALLOW_FRAME_AUTH = "1";
    const app = createApp();

    const response = await app.request("http://localhost/chat", {
      headers: {
        Upgrade: "websocket",
      },
    });

    assert.equal(response.status, 401);
  });

  it("returns a managed prewarm status when managed mode is enabled", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test-key";
    process.env.SONDE_MANAGED_ENVIRONMENT_ID = "env_123";
    process.env.SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT = "1";
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

      if (url.pathname === "/v1/agents") {
        return new Response(JSON.stringify({ id: "agent_test_prewarm" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/v1/sessions") {
        return new Response(JSON.stringify({ id: "sesn_test_prewarm" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };
    const app = createApp();

    const response = await app.request("http://localhost/chat/prewarm", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      status: string;
      backend: string;
      session_id: string;
    };
    assert.equal(body.status, "ready");
    assert.equal(body.backend, "managed");
    assert.equal(body.session_id, "sesn_test_prewarm");
  });

  it("returns a structured prewarm error when managed auth is malformed", async () => {
    process.env.ANTHROPIC_API_KEY = "$(python - <<'PY' print('bad') PY)";
    process.env.SONDE_MANAGED_ENVIRONMENT_ID = "env_123";
    process.env.SONDE_MANAGED_AGENT_ID = "agent_123";
    const app = createApp();

    const response = await app.request("http://localhost/chat/prewarm", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    assert.equal(response.status, 503);
    const body = (await response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(body.error.type, "chat_runtime_unavailable");
    assert.match(body.error.message, /unevaluated shell or template syntax/);
    assert.doesNotMatch(body.error.message, /python - <<'PY'/);
  });

  it("rejects unauthenticated GitHub proxy requests", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/github/repos/aeolus-earth/sonde/commits"
    );
    assert.equal(response.status, 401);

    const body = (await response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(body.error.type, "unauthorized");
  });

  it("returns CORS headers for configured hosted origins", async () => {
    process.env.SONDE_ALLOWED_ORIGINS = "https://sonde-staging.vercel.app";
    const app = createApp();

    const response = await app.request(
      "http://localhost/github/repos/aeolus-earth/sonde/commits",
      {
        headers: {
          Origin: "https://sonde-staging.vercel.app",
        },
      }
    );

    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://sonde-staging.vercel.app"
    );
  });

  it("returns CORS headers for admin routes on configured hosted origins", async () => {
    process.env.SONDE_ALLOWED_ORIGINS = "https://sonde-neon.vercel.app";
    const app = createApp();

    const response = await app.request("http://localhost/admin/managed-costs/reconcile", {
      method: "OPTIONS",
      headers: {
        Origin: "https://sonde-neon.vercel.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://sonde-neon.vercel.app",
    );
    assert.match(
      response.headers.get("access-control-allow-headers") ?? "",
      /authorization/i,
    );
  });

  it("serves commit history through the proxy with branch diagnostics", async () => {
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

      if (url.pathname === "/repos/aeolus-earth/sonde") {
        return new Response(
          JSON.stringify({
            default_branch: "main",
            html_url: "https://github.com/aeolus-earth/sonde",
            private: false,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4998",
              "x-ratelimit-reset": "2000000000",
              "x-ratelimit-used": "2",
            },
          }
        );
      }

      if (url.pathname === "/repos/aeolus-earth/sonde/commits") {
        assert.equal(url.searchParams.get("sha"), "feature/test");
        assert.equal(url.searchParams.get("per_page"), "25");
        return new Response(
          JSON.stringify([
            {
              sha: "0123456789abcdef",
              commit: {
                message: "Stabilize timeline smoke",
                author: {
                  name: "Mason Lee",
                  date: "2026-04-07T00:00:00Z",
                },
              },
              html_url: "https://github.com/aeolus-earth/sonde/commit/01234567",
              author: {
                login: "mlee27",
                avatar_url: "https://avatars.example.com/mlee27.png",
              },
            },
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4998",
              "x-ratelimit-reset": "2000000000",
              "x-ratelimit-used": "2",
            },
          }
        );
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const app = createApp();
    const response = await app.request(
      "http://localhost/github/repos/aeolus-earth/sonde/commits?branch=feature%2Ftest&per_page=25",
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      commits: Array<{ shortSha: string; firstLine: string }>;
      diagnostics: {
        requestedBranch: string | null;
        resolvedBranch: string;
        upstreamRequests: number;
      };
      repo: { defaultBranch: string };
    };

    assert.equal(body.commits.length, 1);
    assert.equal(body.commits[0]?.shortSha, "01234567");
    assert.equal(body.commits[0]?.firstLine, "Stabilize timeline smoke");
    assert.equal(body.diagnostics.requestedBranch, "feature/test");
    assert.equal(body.diagnostics.resolvedBranch, "feature/test");
    assert.equal(body.diagnostics.upstreamRequests, 2);
    assert.equal(body.repo.defaultBranch, "main");
  });

  it("rejects non-allowlisted repos when a server GitHub token is configured", async () => {
    process.env.GITHUB_TOKEN = "server-token";
    process.env.SONDE_GITHUB_ALLOWED_REPOS = "aeolus-earth/sonde";

    const app = createApp();
    const response = await app.request(
      "http://localhost/github/repos/private-org/private-repo/commits",
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }
    );

    assert.equal(response.status, 403);
    const body = (await response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(body.error.type, "repo_not_allowed");
    assert.match(body.error.message, /private-org\/private-repo/);
  });

  // Every auth-gated endpoint must reject requests that arrive without a
  // valid session token. Individual happy-path tests rely on
  // SONDE_TEST_AUTH_BYPASS_TOKEN; these tests confirm the real auth gate
  // still fires when the bypass token isn't presented. Prevents a class
  // of regression where an endpoint silently stops requiring auth.
  const AUTH_GATED_ENDPOINTS: Array<{
    name: string;
    method: "GET" | "POST";
    path: string;
    body?: string;
  }> = [
    { name: "POST /auth/device/introspect", method: "POST", path: "/auth/device/introspect", body: "{}" },
    { name: "POST /auth/device/approve", method: "POST", path: "/auth/device/approve", body: "{}" },
    { name: "GET /admin/runtime", method: "GET", path: "/admin/runtime" },
    { name: "GET /admin/managed-costs/summary", method: "GET", path: "/admin/managed-costs/summary" },
    { name: "GET /admin/managed-sessions", method: "GET", path: "/admin/managed-sessions" },
    { name: "GET /admin/managed-sessions/:id", method: "GET", path: "/admin/managed-sessions/abc-123" },
    { name: "POST /admin/managed-costs/reconcile", method: "POST", path: "/admin/managed-costs/reconcile", body: "{}" },
    { name: "POST /mcp/sonde", method: "POST", path: "/mcp/sonde", body: "{}" },
    { name: "POST /chat/session-token", method: "POST", path: "/chat/session-token", body: "{}" },
    { name: "POST /chat/prewarm", method: "POST", path: "/chat/prewarm", body: "{}" },
  ];

  for (const endpoint of AUTH_GATED_ENDPOINTS) {
    it(`rejects ${endpoint.name} without an Authorization header`, async () => {
      // Intentionally leave the bypass token set so the test mirrors the
      // real staging/prod config: the auth middleware must refuse
      // unauthenticated requests even when the bypass token is configured.
      process.env.ANTHROPIC_API_KEY = "sk-ant-api03-test-key";
      process.env.VITE_SUPABASE_URL = "https://oxajsxoedrmvrcatqser.supabase.co";
      const app = createApp();

      const init: RequestInit = { method: endpoint.method };
      if (endpoint.body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = endpoint.body;
      }

      const response = await app.request(`http://localhost${endpoint.path}`, init);
      assert.equal(
        response.status,
        401,
        `${endpoint.name} should return 401 without auth, got ${response.status}`,
      );

      const body = (await response.json()) as {
        error?: { type: string; message: string };
      };
      assert.ok(body.error, `${endpoint.name} 401 response should include an error object`);
      assert.equal(body.error?.type, "unauthorized");
    });
  }

  // Admin-vs-user 403 coverage intentionally deferred: asserting "authed
  // but not admin → 403" requires mocking verifyToken to return
  // isAdmin: false, which TypeScript's ES module lock makes awkward
  // without invasive refactoring. The 401 tests above catch the larger
  // class of regression (endpoint dropping auth entirely); the
  // authed-user-not-admin path can be added when we extract the auth
  // middleware behind a seam that's easier to stub.
});
