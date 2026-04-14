import fs from "node:fs";
import {
  parseBooleanFlag,
  parsePositiveInt,
  requiredEnv,
  resolveWsUrl,
  runChatConversation,
} from "./chat-smoke-lib.mjs";

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    const message =
      body?.msg ||
      body?.message ||
      body?.error_description ||
      body?.error ||
      response.statusText;
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  return body;
}

function readSessionToken(sessionFile) {
  if (!sessionFile) {
    return "";
  }
  const raw = fs.readFileSync(sessionFile, "utf8");
  const parsed = JSON.parse(raw);
  return parsed?.access_token?.trim?.() ?? "";
}

async function mintSessionToken() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
  const email = requiredEnv("SMOKE_USER_EMAIL");
  const password = requiredEnv("SMOKE_USER_PASSWORD");

  const session = await requestJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  return session?.access_token?.trim?.() ?? "";
}

function buildMessagePayload() {
  const prompt = (process.env.MANAGED_AUTH_AUDIT_PROMPT ?? process.env.CHAT_SMOKE_PROMPT ?? "").trim();
  if (!prompt) {
    throw new Error("Set MANAGED_AUTH_AUDIT_PROMPT or CHAT_SMOKE_PROMPT.");
  }
  const staleSession =
    process.env.MANAGED_AUTH_AUDIT_STALE_SESSION === "1" ||
    process.env.CHAT_SMOKE_STALE_SESSION === "1";
  return {
    type: "message",
    content: prompt,
    ...(staleSession
      ? { sessionId: "deadbeef-dead-beef-dead-beefdeadbeef" }
      : {}),
  };
}

function isRetryablePrewarmFailure(status, bodyText) {
  if ([502, 503, 504].includes(status)) {
    return true;
  }
  return /chat runtime is not ready/i.test(bodyText);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function prewarmChatSession(httpBase, token, timeoutMs, retryIntervalMs) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const response = await fetch(`${httpBase.replace(/\/$/, "")}/chat/prewarm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const bodyText = await response.text();
    if (response.ok) {
      return bodyText;
    }
    if (Date.now() >= deadline || !isRetryablePrewarmFailure(response.status, bodyText)) {
      throw new Error(
        `Prewarm request failed (${response.status}): ${bodyText.slice(0, 240)}`
      );
    }
    await sleep(retryIntervalMs);
  }
}

async function resolveAuditToken() {
  const explicitToken = process.env.MANAGED_AUTH_AUDIT_TOKEN?.trim();
  if (explicitToken) {
    return { authMode: "token", token: explicitToken };
  }

  const sessionToken = readSessionToken(process.env.MANAGED_AUTH_AUDIT_SESSION_FILE?.trim() || "");
  if (sessionToken) {
    return { authMode: "session_file", token: sessionToken };
  }

  const mintedToken = await mintSessionToken();
  if (!mintedToken) {
    throw new Error("Could not mint a smoke session token for managed auth audit.");
  }
  return { authMode: "smoke_user", token: mintedToken };
}

async function main() {
  const httpBase = requiredEnv("MANAGED_AUTH_AUDIT_HTTP_BASE");
  const timeoutMs = parsePositiveInt(process.env.MANAGED_AUTH_AUDIT_TIMEOUT_MS, 180_000);
  const prewarmTimeoutMs = parsePositiveInt(
    process.env.MANAGED_AUTH_AUDIT_PREWARM_TIMEOUT_MS,
    300_000
  );
  const retryIntervalMs = parsePositiveInt(
    process.env.MANAGED_AUTH_AUDIT_RETRY_INTERVAL_MS,
    10_000
  );
  const expectedSubstring =
    process.env.MANAGED_AUTH_AUDIT_EXPECT_SUBSTRING?.trim() ||
    process.env.CHAT_SMOKE_EXPECT_SUBSTRING?.trim() ||
    null;
  const requireToolUse = parseBooleanFlag(
    (
      process.env.MANAGED_AUTH_AUDIT_REQUIRE_TOOL_USE ??
      process.env.CHAT_SMOKE_REQUIRE_TOOL_USE ??
      ""
    )
      .trim()
      .toLowerCase()
  );

  const { authMode, token } = await resolveAuditToken();
  const prewarmMessage = await prewarmChatSession(
    httpBase,
    token,
    prewarmTimeoutMs,
    retryIntervalMs
  );
  const outcome = await runChatConversation({
    wsUrl: resolveWsUrl({ httpBase }),
    token,
    messagePayload: buildMessagePayload(),
    timeoutMs,
    expectedSubstring,
    requireToolUse,
  });

  console.log(
    JSON.stringify({
      authMode,
      httpBase,
      prewarmMessage,
      expectedSubstring,
      requireToolUse,
      ...outcome,
    })
  );
}

main().catch((error) => {
  console.error("[run-managed-auth-audit] Failed:", error.message);
  process.exit(1);
});
