import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import WebSocket from "ws";
import { createApp, handleWebSocket } from "./app.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    SONDE_AGENT_BACKEND: "direct",
    SONDE_TEST_AGENT_MOCK: "1",
    SONDE_TEST_AUTH_BYPASS_TOKEN: "playwright-smoke-token",
    SONDE_TEST_AUTH_DELAY_MS: "25",
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("chat websocket session recovery", () => {
  it("recovers from a stale resume session on the first message", async () => {
    const app = createApp();
    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
    app.get("/chat", upgradeWebSocket((c) => handleWebSocket(c)));

    const server = serve({ fetch: app.fetch, port: 0 });
    injectWebSocket(server);
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;

    const messages: Array<Record<string, unknown>> = [];

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for chat response"));
      }, 10_000);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "auth",
            token: "playwright-smoke-token",
          })
        );
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
    assert.ok(
      !errors.includes("Claude Code process exited with code 1"),
      `Unexpected stale-resume error leaked to client: ${errors.join(", ")}`
    );

    const finalText = messages.find((message) => message.type === "text_done");
    assert.ok(finalText);
    assert.match(String(finalText.content ?? ""), /^Mock response:/);

    const authOk = messages.find((message) => message.type === "auth_ok");
    assert.ok(authOk, "Expected auth_ok before chat completion");
  });
});
