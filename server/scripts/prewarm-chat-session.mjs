function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const httpBase = requiredEnv("CHAT_PREWARM_HTTP_BASE").replace(/\/$/, "");
  const token = requiredEnv("CHAT_PREWARM_TOKEN");
  const timeoutMs = parsePositiveInt(process.env.CHAT_PREWARM_TIMEOUT_MS, 300_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`[chat-prewarm] Prewarming via ${httpBase}/chat/prewarm`);
    const response = await fetch(`${httpBase}/chat/prewarm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Prewarm request failed (${response.status}): ${bodyText.slice(0, 240)}`
      );
    }
    console.log(`[chat-prewarm] Success ${bodyText}`);
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[chat-prewarm] Failed:", message);
  process.exit(1);
});
