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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryablePrewarmFailure(status, bodyText) {
  if ([502, 503, 504].includes(status)) {
    return true;
  }
  return /chat runtime is not ready/i.test(bodyText);
}

async function main() {
  const httpBase = requiredEnv("CHAT_PREWARM_HTTP_BASE").replace(/\/$/, "");
  const token = requiredEnv("CHAT_PREWARM_TOKEN");
  const timeoutMs = parsePositiveInt(process.env.CHAT_PREWARM_TIMEOUT_MS, 300_000);
  const retryIntervalMs = parsePositiveInt(
    process.env.CHAT_PREWARM_RETRY_INTERVAL_MS,
    10_000
  );
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const controller = new AbortController();
    const remainingMs = Math.max(1_000, deadline - Date.now());
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(remainingMs, retryIntervalMs)
    );

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
        const message = `Prewarm request failed (${response.status}): ${bodyText.slice(0, 240)}`;
        if (Date.now() < deadline && isRetryablePrewarmFailure(response.status, bodyText)) {
          console.log(`[chat-prewarm] Waiting for chat readiness: ${message}`);
          await sleep(retryIntervalMs);
          continue;
        }
        throw new Error(message);
      }
      console.log(`[chat-prewarm] Success ${bodyText}`);
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /fetch failed/i.test(error.message))
      ) {
        console.log(`[chat-prewarm] Waiting for chat readiness: ${error.message}`);
        await sleep(retryIntervalMs);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[chat-prewarm] Failed:", message);
  process.exit(1);
});
