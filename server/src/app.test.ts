import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp, getAllowedOrigins } from "./app.js";
import { resetGitHubCachesForTests } from "./github.js";
import { resetManagedClientStateForTests } from "./managed/client.js";
import { resetManagedSessionCacheForTests } from "./managed/session-cache.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const authToken = "playwright-smoke-token";

beforeEach(() => {
  process.env.SONDE_TEST_AUTH_BYPASS_TOKEN = authToken;
  process.env.NODE_ENV = "test";
  process.env.SONDE_WS_TOKEN_SECRET = "test-ws-secret";
  process.env.SONDE_RUNTIME_AUDIT_TOKEN = "test-runtime-token";
  delete process.env.SONDE_COMMIT_SHA;
  resetGitHubCachesForTests();
  resetManagedClientStateForTests();
  resetManagedSessionCacheForTests();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  resetGitHubCachesForTests();
  resetManagedClientStateForTests();
  resetManagedSessionCacheForTests();
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
    process.env.SONDE_COMMIT_SHA = "abc123";
    process.env.SONDE_SCHEMA_VERSION = "20260407000123";
    process.env.SONDE_CLI_GIT_REF = "refs/heads/staging";
    process.env.ANTHROPIC_API_KEY = "test-key";
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
    process.env.ANTHROPIC_API_KEY = "test-key";
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
      costTelemetryConfigured: boolean;
      liveSpendEnabled: boolean;
      telemetryRequiresServiceRole: boolean;
      cliGitRef: string | null;
      supabaseProjectRef: string | null;
      sharedRateLimitConfigured: boolean;
      sharedRateLimitRequired: boolean;
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
      costTelemetryConfigured: false,
      liveSpendEnabled: false,
      telemetryRequiresServiceRole: false,
      managedSessionWarnUsd: 1,
      managedSessionCriticalUsd: 5,
      cliGitRef: "refs/heads/staging",
      supabaseProjectRef: "oxajsxoedrmvrcatqser",
      sharedRateLimitConfigured: false,
      sharedRateLimitRequired: false,
    });
  });

  it("serves managed cost summary through the admin endpoint", async () => {
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
      latestSuccessfulSync: { id: number } | null;
    };
    assert.equal(body.environment, "staging");
    assert.equal(body.providerSelectedWindowUsd, 3);
    assert.equal(body.estimatedSelectedWindowUsd, 2);
    assert.equal(body.activeSessions, 1);
    assert.equal(body.sessionCount, 2);
    assert.equal(body.latestSuccessfulSync?.id, 42);
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
    };
    assert.equal(body.mode, "estimated_only");
    assert.equal(body.syncRunId, 77);
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

  it("returns a managed prewarm status when managed mode is enabled", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
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
});
