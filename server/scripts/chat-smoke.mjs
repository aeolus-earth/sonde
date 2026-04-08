import {
  parseBooleanFlag,
  parsePositiveInt,
  requiredEnv,
  resolveWsUrl,
  runChatConversation,
} from "./chat-smoke-lib.mjs";

function buildMessagePayload() {
  const prompt = (process.env.CHAT_SMOKE_PROMPT ?? "Say hello briefly.").trim();
  const staleSession = process.env.CHAT_SMOKE_STALE_SESSION === "1";
  return {
    type: "message",
    content: prompt,
    ...(staleSession
      ? { sessionId: "deadbeef-dead-beef-dead-beefdeadbeef" }
      : {}),
  };
}

async function main() {
  const wsUrl = resolveWsUrl();
  const token = requiredEnv("CHAT_SMOKE_TOKEN");
  const timeoutMs = parsePositiveInt(process.env.CHAT_SMOKE_TIMEOUT_MS, 45_000);
  const messagePayload = buildMessagePayload();
  const expectedSubstring = process.env.CHAT_SMOKE_EXPECT_SUBSTRING?.trim();
  const requireToolUse = parseBooleanFlag(
    (process.env.CHAT_SMOKE_REQUIRE_TOOL_USE ?? "").trim().toLowerCase()
  );

  console.log(`[chat-smoke] Connecting to ${wsUrl}`);
  const outcome = await runChatConversation({
    wsUrl,
    token,
    messagePayload,
    timeoutMs,
    expectedSubstring,
    requireToolUse,
  });

  console.log("[chat-smoke] Success", JSON.stringify(outcome));
}

main().catch((error) => {
  console.error("[chat-smoke] Failed:", error.message);
  process.exit(1);
});
