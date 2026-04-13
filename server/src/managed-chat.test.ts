import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import WebSocket from "ws";
import { createApp, handleWebSocket } from "./app.js";
import { issueWsSessionToken } from "./ws-session-token.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

interface ManagedMockScenario {
  sessionId: string;
  streamBodies: string[];
  eventLists?: Array<Array<Record<string, unknown>>>;
  invalidSessionIds?: string[];
  onEvents?: (events: Array<Record<string, unknown>>) => void;
  onEventPost?: (events: Array<Record<string, unknown>>) => Response | null | undefined;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseBody(events: Array<Record<string, unknown> | "[DONE]">): string {
  return events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
    .join("");
}

function createManagedMockFetch(scenario: ManagedMockScenario) {
  let nextStreamIndex = 0;
  let nextEventListIndex = 0;
  const invalidSessionIds = new Set(scenario.invalidSessionIds ?? []);
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string"
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url);

    if (url.pathname === "/v1/agents") {
      return jsonResponse({ id: "agent_test_managed" });
    }

    if (url.pathname === "/v1/sessions") {
      return jsonResponse({ id: scenario.sessionId });
    }

    const sessionResourceMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (
      sessionResourceMatch &&
      (init?.method ?? "GET").toUpperCase() === "GET"
    ) {
      if (invalidSessionIds.has(sessionResourceMatch[1] ?? "")) {
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: `Invalid session ID: ${sessionResourceMatch[1]}`,
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return jsonResponse({
        id: sessionResourceMatch[1],
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 250,
          output_tokens: 120,
        },
      });
    }

    const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/(events|stream)$/);
    if (sessionMatch && invalidSessionIds.has(sessionMatch[1] ?? "")) {
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `Invalid session ID: ${sessionMatch[1]}`,
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        }
      );
    }

    if (
      url.pathname === `/v1/sessions/${scenario.sessionId}/events` &&
      (init?.method ?? "GET").toUpperCase() === "GET"
    ) {
      const data =
        scenario.eventLists?.[nextEventListIndex] ??
        scenario.eventLists?.at(-1) ??
        [];
      nextEventListIndex += 1;
      return jsonResponse({ data });
    }

    if (url.pathname === `/v1/sessions/${scenario.sessionId}/events`) {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(rawBody) as { events?: Array<Record<string, unknown>> };
      scenario.onEvents?.(parsed.events ?? []);
      const override = scenario.onEventPost?.(parsed.events ?? []);
      if (override) {
        return override;
      }
      return jsonResponse({});
    }

    if (url.pathname === `/v1/sessions/${scenario.sessionId}/stream`) {
      const body = scenario.streamBodies[nextStreamIndex] ?? scenario.streamBodies.at(-1) ?? "";
      nextStreamIndex += 1;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    throw new Error(`Unexpected fetch: ${url.toString()}`);
  };
}

function createWebSocketServer() {
  const app = createApp();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  app.get("/chat", upgradeWebSocket((c) => handleWebSocket(c)));

  const server = serve({ fetch: app.fetch, port: 0 });
  injectWebSocket(server);
  return server;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    SONDE_AGENT_BACKEND: "managed",
    SONDE_TEST_AUTH_BYPASS_TOKEN: "playwright-smoke-token",
    SONDE_TEST_AUTH_DELAY_MS: "25",
    SONDE_WS_TOKEN_SECRET: "test-ws-secret",
    ANTHROPIC_API_KEY: "test-key",
    SONDE_MANAGED_ENVIRONMENT_ID: "env_test_managed",
    SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT: "1",
  };
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

describe("managed chat websocket", () => {
  it("emits the prewarmed managed session id on first message", async () => {
    const sessionId = "sesn_test_prewarm";
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      streamBodies: [
        sseBody([
          {
            id: "msg-final",
            type: "agent.message",
            content: [{ type: "text", text: "Prewarm path ok." }],
          },
          {
            id: "idle-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const app = createApp();
    const prewarmResponse = await app.request("http://localhost/chat/prewarm", {
      method: "POST",
      headers: {
        Authorization: "Bearer playwright-smoke-token",
      },
    });
    assert.equal(prewarmResponse.status, 200);

    globalThis.fetch = createManagedMockFetch({
      sessionId,
      streamBodies: [
        sseBody([
          {
            id: "msg-final",
            type: "agent.message",
            content: [{ type: "text", text: "Prewarm path ok." }],
          },
          {
            id: "idle-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for managed chat response"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "Say hi." }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    const sessionEvent = messages.find((message) => message.type === "session");
    assert.ok(sessionEvent);
    assert.equal(sessionEvent.sessionId, sessionId);
  });

  it("auto-allows read-only managed bash actions and continues streaming", async () => {
    const sessionId = "sesn_test_auto_allow";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      streamBodies: [
        sseBody([
          {
            id: "tool-read-1",
            type: "agent.tool_use",
            name: "bash",
            input: { command: "git show HEAD~1 --stat" },
          },
          {
            id: "idle-read-1",
            type: "session.status_idle",
            stop_reason: { type: "requires_action", event_ids: ["tool-read-1"] },
          },
          "[DONE]",
        ]),
        sseBody([
          {
            id: "msg-read-final",
            type: "agent.message",
            content: [{ type: "text", text: "Managed auto allow ok." }],
          },
          {
            id: "idle-read-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for managed auto-allow response"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "Inspect the last commit." }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    assert.equal(
      messages.some((message) => message.type === "tool_approval_required"),
      false
    );
    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.tool_confirmation" &&
            event.tool_use_id === "tool-read-1" &&
            event.result === "allow"
        )
      )
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "text_done" &&
          message.content === "Managed auto allow ok."
      )
    );
  });

  it("requests approval for managed Sonde mutations executed through bash", async () => {
    const sessionId = "sesn_test_bash_approval";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      streamBodies: [
        sseBody([
          {
            id: "tool-write-1",
            type: "agent.tool_use",
            name: "bash",
            input: { command: "sonde experiment log -p weather" },
          },
          {
            id: "idle-write-1",
            type: "session.status_idle",
            stop_reason: { type: "requires_action", event_ids: ["tool-write-1"] },
          },
          "[DONE]",
        ]),
        sseBody([
          {
            id: "msg-write-final",
            type: "agent.message",
            content: [{ type: "text", text: "Managed approval ok." }],
          },
          {
            id: "idle-write-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for managed approval response"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "Log an experiment." }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "tool_approval_required") {
          ws.send(
            JSON.stringify({
              type: "approve_tool",
              approvalId: message.approvalId,
            })
          );
        }
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    const approvalEvent = messages.find(
      (message) => message.type === "tool_approval_required"
    );
    assert.ok(approvalEvent);
    assert.equal(approvalEvent.kind, "sonde_write");
    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.tool_confirmation" &&
            event.tool_use_id === "tool-write-1" &&
            event.result === "allow"
        )
      )
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "text_done" &&
          message.content === "Managed approval ok."
      )
    );
  });

  it("recovers managed custom-tool actions from persisted history when the stream ends early", async () => {
    const sessionId = "sesn_test_history_recovery";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      eventLists: [
        [
          {
            id: "hist-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking recent activity." }],
          },
          {
            id: "tool-status-hist-1",
            type: "agent.custom_tool_use",
            name: "sonde_status",
            input: {},
            session_thread_id: "sthr_hist_1",
          },
          {
            id: "tool-recent-hist-1",
            type: "agent.custom_tool_use",
            name: "sonde_recent",
            input: { limit: 10 },
            session_thread_id: "sthr_hist_1",
          },
          {
            id: "idle-hist-1",
            type: "session.status_idle",
            stop_reason: {
              type: "requires_action",
              event_ids: ["tool-status-hist-1", "tool-recent-hist-1"],
            },
          },
        ],
      ],
      streamBodies: [
        sseBody([
          {
            id: "hist-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking recent activity." }],
          },
          "[DONE]",
        ]),
        sseBody([
          {
            id: "msg-history-final",
            type: "agent.message",
            content: [{ type: "text", text: "Recovered tool actions." }],
          },
          {
            id: "idle-history-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for managed history recovery"));
      }, 20_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "What is going on right now?" }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-status-hist-1" &&
            event.session_thread_id === "sthr_hist_1"
        )
      )
    );
    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-recent-hist-1" &&
            event.session_thread_id === "sthr_hist_1"
        )
      )
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "text_done" &&
          message.content === "Recovered tool actions."
      )
    );
  });

  it("waits for managed history to settle before ending a thinking-only turn", async () => {
    const sessionId = "sesn_test_delayed_history_settle";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      eventLists: [
        [],
        [
          {
            id: "delayed-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking program status." }],
          },
          {
            id: "tool-status-delayed-1",
            type: "agent.custom_tool_use",
            name: "sonde_status",
            input: {},
            session_thread_id: "sthr_delayed_1",
          },
          {
            id: "tool-recent-delayed-1",
            type: "agent.custom_tool_use",
            name: "sonde_recent",
            input: { limit: 10 },
            session_thread_id: "sthr_delayed_1",
          },
          {
            id: "idle-delayed-1",
            type: "session.status_idle",
            stop_reason: {
              type: "requires_action",
              event_ids: ["tool-status-delayed-1", "tool-recent-delayed-1"],
            },
          },
        ],
      ],
      streamBodies: [
        sseBody([
          {
            id: "delayed-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking program status." }],
          },
          "[DONE]",
        ]),
        sseBody(["[DONE]"]),
        sseBody([
          {
            id: "msg-delayed-final",
            type: "agent.message",
            content: [{ type: "text", text: "Delayed recovery finished." }],
          },
          {
            id: "idle-delayed-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for delayed managed history recovery"));
      }, 20_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "What is going on right now?" }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-status-delayed-1" &&
            event.session_thread_id === "sthr_delayed_1"
        )
      )
    );
    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-recent-delayed-1" &&
            event.session_thread_id === "sthr_delayed_1"
        )
      )
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "text_done" &&
          message.content === "Delayed recovery finished."
      )
    );
  });

  it("keeps polling when managed idle arrives before the tool events are visible in history", async () => {
    const sessionId = "sesn_test_idle_before_history";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      eventLists: [
        [],
        [
          {
            id: "late-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking current activity." }],
          },
          {
            id: "tool-status-late-1",
            type: "agent.custom_tool_use",
            name: "sonde_status",
            input: {},
            session_thread_id: "sthr_late_1",
          },
          {
            id: "tool-recent-late-1",
            type: "agent.custom_tool_use",
            name: "sonde_recent",
            input: { limit: 10 },
            session_thread_id: "sthr_late_1",
          },
          {
            id: "idle-late-1",
            type: "session.status_idle",
            stop_reason: {
              type: "requires_action",
              event_ids: ["tool-status-late-1", "tool-recent-late-1"],
            },
          },
        ],
      ],
      streamBodies: [
        sseBody([
          {
            id: "late-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking current activity." }],
          },
          {
            id: "idle-late-1",
            type: "session.status_idle",
            stop_reason: {
              type: "requires_action",
              event_ids: ["tool-status-late-1", "tool-recent-late-1"],
            },
          },
          "[DONE]",
        ]),
        sseBody(["[DONE]"]),
        sseBody([
          {
            id: "msg-late-final",
            type: "agent.message",
            content: [{ type: "text", text: "Late history recovery finished." }],
          },
          {
            id: "idle-late-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for the late-history managed recovery"));
      }, 20_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "What is going on right now?" }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-status-late-1" &&
            event.session_thread_id === "sthr_late_1"
        )
      )
    );
    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-recent-late-1" &&
            event.session_thread_id === "sthr_late_1"
        )
      )
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "text_done" &&
          message.content === "Late history recovery finished."
      )
    );
  });

  it("reconciles managed idle events that omit stop_reason in the live stream", async () => {
    const sessionId = "sesn_test_idle_without_stop_reason";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      eventLists: [
        [
          {
            id: "stream-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking current activity." }],
          },
          {
            id: "tool-status-stream-1",
            type: "agent.custom_tool_use",
            name: "sonde_status",
            input: {},
            session_thread_id: "sthr_stream_1",
          },
          {
            id: "tool-recent-stream-1",
            type: "agent.custom_tool_use",
            name: "sonde_recent",
            input: { limit: 10 },
            session_thread_id: "sthr_stream_1",
          },
          {
            id: "idle-stream-1",
            type: "session.status_idle",
            stop_reason: {
              type: "requires_action",
              event_ids: ["tool-status-stream-1", "tool-recent-stream-1"],
            },
          },
        ],
      ],
      streamBodies: [
        sseBody([
          {
            id: "stream-thinking-1",
            type: "agent.message",
            content: [{ type: "thinking", thinking: "Checking current activity." }],
          },
          {
            id: "tool-status-stream-1",
            type: "agent.custom_tool_use",
            name: "sonde_status",
            input: {},
            session_thread_id: "sthr_stream_1",
          },
          {
            id: "tool-recent-stream-1",
            type: "agent.custom_tool_use",
            name: "sonde_recent",
            input: { limit: 10 },
            session_thread_id: "sthr_stream_1",
          },
          {
            id: "idle-stream-1",
            type: "session.status_idle",
          },
          "[DONE]",
        ]),
        sseBody([
          {
            id: "msg-stream-final",
            type: "agent.message",
            content: [{ type: "text", text: "Stream stop-reason recovery finished." }],
          },
          {
            id: "idle-stream-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for the stop-reason managed recovery"));
      }, 20_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "What is going on right now?" }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-status-stream-1" &&
            event.session_thread_id === "sthr_stream_1"
        )
      )
    );
    assert.ok(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.custom_tool_result" &&
            event.custom_tool_use_id === "tool-recent-stream-1" &&
            event.session_thread_id === "sthr_stream_1"
        )
      )
    );
    assert.ok(
      messages.some(
        (message) =>
          message.type === "text_done" &&
          message.content === "Stream stop-reason recovery finished."
      )
    );
  });

  it("rejects a new managed message while a prior turn is waiting on approval", async () => {
    const sessionId = "sesn_test_pending_approval_guard";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      streamBodies: [
        sseBody([
          {
            id: "tool-write-guard-1",
            type: "agent.tool_use",
            name: "bash",
            input: { command: "sonde experiment log -p weather" },
          },
          {
            id: "idle-write-guard-1",
            type: "session.status_idle",
            stop_reason: { type: "requires_action", event_ids: ["tool-write-guard-1"] },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for the managed pending-approval guard"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "Log an experiment." }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "tool_approval_required") {
          ws.send(
            JSON.stringify({
              type: "message",
              content: "Also summarize what changed.",
              sessionId,
            })
          );
          return;
        }
        if (
          message.type === "error" &&
          message.message ===
            "The assistant is still working on your previous request. Wait for it to finish or resolve the pending approval first."
        ) {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    assert.equal(
      messages.some((message) => message.type === "tool_approval_required"),
      true
    );
    assert.equal(
      recordedEvents.flat().filter((event) => event.type === "user.message").length,
      1
    );
  });

  it("replays pending managed approvals after reconnect", async () => {
    const sessionId = "sesn_test_reconnect_approval";
    const recordedEvents: Array<Array<Record<string, unknown>>> = [];
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      onEvents(events) {
        recordedEvents.push(events);
      },
      streamBodies: [
        sseBody([
          {
            id: "tool-write-reconnect-1",
            type: "agent.tool_use",
            name: "bash",
            input: { command: "sonde experiment log -p weather" },
          },
          {
            id: "idle-write-reconnect-1",
            type: "session.status_idle",
            stop_reason: { type: "requires_action", event_ids: ["tool-write-reconnect-1"] },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    let capturedSessionId: string | null = null;
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for the initial managed approval"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", content: "Log an experiment." }));
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message.type === "session") {
          capturedSessionId = String(message.sessionId);
        }
        if (message.type === "tool_approval_required") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    assert.equal(capturedSessionId, sessionId);

    const resumedMessages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for the resumed managed approval"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "resume_session",
            sessionId,
          })
        );
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        resumedMessages.push(message);
        if (message.type === "tool_approval_required") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    const replayedApproval = resumedMessages.find(
      (message) => message.type === "tool_approval_required"
    );
    assert.ok(replayedApproval);
    assert.equal(replayedApproval.toolUseID, "tool-write-reconnect-1");
    assert.equal(replayedApproval.kind, "sonde_write");
    assert.equal(
      recordedEvents.some((batch) =>
        batch.some(
          (event) =>
            event.type === "user.tool_confirmation" &&
            event.tool_use_id === "tool-write-reconnect-1" &&
            event.result === "deny"
        )
      ),
      false
    );
  });

  it("replaces a stale requested session id with a fresh managed session", async () => {
    const sessionId = "sesn_test_fresh_after_stale";
    globalThis.fetch = createManagedMockFetch({
      sessionId,
      invalidSessionIds: ["deadbeef-dead-beef-dead-beefdeadbeef"],
      streamBodies: [
        sseBody([
          {
            id: "msg-fresh-final",
            type: "agent.message",
            content: [{ type: "text", text: "Fresh session recovered." }],
          },
          {
            id: "idle-fresh-final",
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          },
          "[DONE]",
        ]),
      ],
    });

    const server = createWebSocketServer();
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const wsToken = issueWsSessionToken("playwright-smoke-token", {
        id: "e2e-user",
        email: "ci-smoke@aeolus.earth",
        name: "CI Smoke",
      });
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/chat?ws_token=${encodeURIComponent(wsToken)}`
      );
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for managed stale-session recovery"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "message",
            content: "Say hello briefly.",
            sessionId: "deadbeef-dead-beef-dead-beefdeadbeef",
          })
        );
      });

      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        messages.push(message);
        if (message.type === "done") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).finally(() => {
      server.close();
    });

    const errors = messages
      .filter((message) => message.type === "error")
      .map((message) => String(message.message ?? ""));
    assert.equal(errors.length, 0);

    const sessionEvent = messages.find((message) => message.type === "session");
    assert.ok(sessionEvent);
    assert.equal(sessionEvent.sessionId, sessionId);

    const finalText = messages.find((message) => message.type === "text_done");
    assert.ok(finalText);
    assert.equal(finalText.content, "Fresh session recovered.");
  });
});
