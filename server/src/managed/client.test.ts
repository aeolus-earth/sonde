import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createManagedSession, normalizeManagedSessionEvent } from "./client.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    ANTHROPIC_API_KEY: "sk-ant-api03-test-key",
    SONDE_MANAGED_ENVIRONMENT_ID: "env_test_managed",
    SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT: "1",
  };
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

describe("normalizeManagedSessionEvent", () => {
  it("maps streamed Sonde tool_use events onto the custom-tool shape", () => {
    const normalized = normalizeManagedSessionEvent({
      id: "sevt_123",
      type: "agent.tool_use",
      tool_name: "sonde_status",
      tool_use_id: "tool_123",
      input: {},
    });

    assert.equal(normalized.type, "agent.custom_tool_use");
    assert.equal(normalized.name, "sonde_status");
    assert.equal(normalized.id, "sevt_123");
  });

  it("maps streamed built-in tool_use fields without reclassifying the tool type", () => {
    const normalized = normalizeManagedSessionEvent({
      type: "agent.tool_use",
      tool_name: "bash",
      tool_use_id: "tool_456",
      input: { command: "git show HEAD~1 --stat" },
    });

    assert.equal(normalized.type, "agent.tool_use");
    assert.equal(normalized.name, "bash");
    assert.equal(normalized.id, "tool_456");
  });

  it("retries session creation without the repo resource when the rich payload is rejected", async () => {
    process.env.SONDE_GITHUB_TOKEN = "github-test-token";
    process.env.SONDE_MANAGED_DEFAULT_GITHUB_REPO_URL = "https://github.com/aeolus-earth/sonde";

    const agentBodies: Array<Record<string, unknown>> = [];
    const sessionBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

      if (url.pathname === "/v1/agents") {
        agentBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: "agent_test_managed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/v1/sessions") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        sessionBodies.push(body);
        if (sessionBodies.length === 1) {
          return new Response(
            JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "github repository resource rejected",
              },
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({ id: "sesn_test_retry_without_repo" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    };

    const sessionId = await createManagedSession({
      user: {
        id: "user-1",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      },
      sondeToken: "sonde-token",
    });

    assert.equal(sessionId, "sesn_test_retry_without_repo");
    assert.equal(agentBodies.length, 1);
    assert.equal(Array.isArray(agentBodies[0]?.skills), true);
    assert.deepEqual(
      (agentBodies[0]?.skills as Array<{ skill_id?: string }>).map((skill) => skill.skill_id),
      ["pdf", "pptx", "xlsx"]
    );
    assert.equal(sessionBodies.length, 2);
    assert.equal(Array.isArray(sessionBodies[0]?.resources), true);
    assert.equal("resources" in sessionBodies[1]!, false);
  });

  it("fails before fetch when the Anthropic API key is malformed", async () => {
    process.env.ANTHROPIC_API_KEY = "$(python - <<'PY' print('bad') PY)";

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response("{}");
    };

    await assert.rejects(
      () =>
        createManagedSession({
          user: {
            id: "user-1",
            email: "ci-smoke@aeolus.earth",
            name: "CI Smoke",
          },
          sondeToken: "sonde-token",
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes("unevaluated shell or template syntax") &&
        !error.message.includes("python - <<'PY'"),
    );

    assert.equal(fetchCalls, 0);
  });
});
