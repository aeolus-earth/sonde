#!/usr/bin/env node
/**
 * End-to-end chat test — authenticates with Supabase, opens WebSocket,
 * sends a message, and verifies the agent responds.
 *
 * Usage:
 *   node scripts/test-chat.mjs <email> <password>
 *   node scripts/test-chat.mjs --token <supabase-jwt>
 *
 * Requires server running on localhost:3001.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { fetchChatSessionToken } from "./chat-smoke-lib.mjs";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVER_URL = "ws://localhost:3001/chat";
const HTTP_BASE = "http://localhost:3001";
const TIMEOUT_MS = 60_000;

async function getToken() {
  if (process.argv[2] === "--token" && process.argv[3]) {
    return process.argv[3];
  }
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: node scripts/test-chat.mjs <email> <password>");
    console.error("   or: node scripts/test-chat.mjs --token <jwt>");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Auth failed:", error.message);
    process.exit(1);
  }
  return data.session.access_token;
}

async function testChat(wsUrl) {
  return new Promise((resolve, reject) => {
    const messages = [];
    let authReady = false;
    let gotResponse = false;
    let messageSent = false;

    const timer = setTimeout(() => {
      ws.close();
      if (!gotResponse) {
        console.error("\n❌ TIMEOUT — no agent response after", TIMEOUT_MS / 1000, "s");
        console.error("Messages received:", messages.map((m) => m.type).join(", "));
        reject(new Error("timeout"));
      }
    }, TIMEOUT_MS);

    console.log("Connecting to", wsUrl, "...");
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      console.log("✓ WebSocket connected");
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);

      switch (msg.type) {
        case "auth_ok":
          authReady = true;
          if (!messageSent) {
            messageSent = true;
            console.log("→ Sending: 'hello, confirm you can use Sonde tools'");
            ws.send(
              JSON.stringify({
                type: "message",
                content: "hello, confirm you can use Sonde tools and tell me what runtime you are using",
                mentions: [],
              })
            );
          }
          break;

        case "session":
          console.log("✓ Session:", msg.sessionId.slice(0, 12) + "...");
          break;

        case "text_delta":
          if (!gotResponse) {
            console.log("✓ First text_delta received — agent is responding");
            gotResponse = true;
          }
          process.stdout.write(msg.content);
          break;

        case "text_done":
          console.log("\n✓ text_done — full response received");
          break;

        case "tool_use_start":
          console.log(`✓ Tool call: ${msg.tool} (id: ${msg.id.slice(0, 8)})`);
          break;

        case "tool_use_end":
          console.log(`✓ Tool result: ${msg.id.slice(0, 8)} — ${(msg.output || "").slice(0, 100)}`);
          break;

        case "model_info":
          console.log("✓ Model:", msg.model);
          break;

        case "error":
          console.error("✗ Error:", msg.message);
          break;

        case "done":
          console.log("\n✓ Done — agent finished");
          clearTimeout(timer);
          ws.close();
          if (authReady && gotResponse) {
            console.log("\n✅ TEST PASSED — first message got a response");
            resolve(true);
          } else {
            console.error("\n❌ TEST FAILED — chat completed before auth or response");
            reject(new Error("no response"));
          }
          break;
      }
    });

    ws.on("close", (code) => {
      if (code === 4001) {
        console.error("✗ Auth rejected (4001) — token invalid or expired");
        clearTimeout(timer);
        reject(new Error("auth"));
      }
    });

    ws.on("error", (err) => {
      console.error("✗ WS error:", err.message);
      clearTimeout(timer);
      reject(err);
    });
  });
}

try {
  const token = await getToken();
  const wsToken = await fetchChatSessionToken(HTTP_BASE, token);
  const url = new URL(SERVER_URL);
  url.searchParams.set("ws_token", wsToken);
  console.log("Token:", token.slice(0, 30) + "...\n");
  await testChat(url.toString());
  process.exit(0);
} catch (err) {
  process.exit(1);
}
