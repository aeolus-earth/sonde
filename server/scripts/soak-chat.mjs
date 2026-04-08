import {
  parseBooleanFlag,
  parsePositiveInt,
  resolveWsUrl,
  runChatConversation,
} from "./chat-smoke-lib.mjs";

function normalizeExpectedSubstring(value) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "__SKIP__") {
    return null;
  }
  return trimmed;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  );
  return sorted[index];
}

function getTokens() {
  const rawTokens =
    process.env.SOAK_CHAT_TOKENS?.trim() || process.env.SOAK_CHAT_TOKEN?.trim() || "";
  const tokens = rawTokens
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("Set SOAK_CHAT_TOKENS or SOAK_CHAT_TOKEN.");
  }

  return tokens;
}

async function runOneChat({
  index,
  wsUrl,
  token,
  prompt,
  timeoutMs,
  expectedSubstring,
  requireToolUse,
}) {
  const startedAt = Date.now();
  try {
    const outcome = await runChatConversation({
      wsUrl,
      token,
      timeoutMs,
      expectedSubstring,
      requireToolUse,
      messagePayload: {
        type: "message",
        content: prompt,
      },
    });
    return {
      ok: true,
      index,
      durationMs: outcome.durationMs ?? Date.now() - startedAt,
      eventStats: outcome.eventStats,
      finalText: outcome.finalText,
    };
  } catch (error) {
    return {
      ok: false,
      index,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const wsUrl = resolveWsUrl({
    explicitWsUrl: process.env.SOAK_CHAT_WS_URL?.trim(),
    httpBase: process.env.SOAK_CHAT_HTTP_BASE?.trim(),
  });
  const tokens = getTokens();
  const concurrency = parsePositiveInt(process.env.SOAK_CHAT_CONCURRENCY, 10);
  const rounds = parsePositiveInt(process.env.SOAK_CHAT_ROUNDS, 1);
  const timeoutMs = parsePositiveInt(process.env.SOAK_CHAT_TIMEOUT_MS, 90_000);
  const prompt =
    process.env.SOAK_CHAT_PROMPT?.trim() ||
    "Use Sonde tools to list one accessible program id and briefly explain what you found.";
  const expectedSubstring = normalizeExpectedSubstring(
    process.env.SOAK_CHAT_EXPECT_SUBSTRING
  );
  const requireToolUse = parseBooleanFlag(
    (process.env.SOAK_CHAT_REQUIRE_TOOL_USE ?? "1").trim().toLowerCase()
  );

  const totalRuns = concurrency * rounds;
  const tasks = Array.from({ length: totalRuns }, (_, index) =>
    runOneChat({
      index,
      wsUrl,
      token: tokens[index % tokens.length],
      prompt,
      timeoutMs,
      expectedSubstring,
      requireToolUse,
    })
  );

  const results = await Promise.all(tasks);
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  const durations = successes.map((result) => result.durationMs);

  const summary = {
    totalRuns,
    successCount: successes.length,
    failureCount: failures.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    expectedSubstring,
    failures,
  };

  console.log("[soak-chat] Summary", JSON.stringify(summary));

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[soak-chat] Failed:", error.message);
  process.exit(1);
});
