import WebSocket from "ws";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[chat-smoke] Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value) {
  return value === "1" || value === "true";
}

function resolveWsUrl() {
  const explicit = process.env.CHAT_SMOKE_WS_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const httpBase = process.env.CHAT_SMOKE_HTTP_BASE?.trim();
  if (!httpBase) {
    console.error(
      "[chat-smoke] Set CHAT_SMOKE_WS_URL or CHAT_SMOKE_HTTP_BASE."
    );
    process.exit(1);
  }

  const url = new URL(httpBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat`;
  return url.toString();
}

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

  const outcome = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const eventStats = {};
    let sawVisibleOutput = false;
    let receivedDone = false;
    let authReady = false;
    let streamedText = "";
    let finalText = "";

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for chat response`));
    }, timeoutMs);

    function finish(error) {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({ eventStats, sawVisibleOutput, receivedDone, finalText });
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      ws.send(JSON.stringify(messagePayload));
    });

    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      eventStats[message.type] = (eventStats[message.type] ?? 0) + 1;

      if (
        message.type === "text_delta" ||
        message.type === "text_done" ||
        message.type === "thinking_delta" ||
        message.type === "tool_use_start" ||
        message.type === "tool_use_end" ||
        message.type === "tasks"
      ) {
        sawVisibleOutput = true;
      }

      if (message.type === "text_delta") {
        streamedText += message.content ?? "";
      }

      if (message.type === "text_done") {
        finalText = message.content ?? streamedText;
      }

      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (message.type === "auth_ok") {
        authReady = true;
        return;
      }

      if (message.type === "error") {
        finish(new Error(`Server returned error: ${message.message}`));
        return;
      }

      if (message.type === "done") {
        receivedDone = true;
        if (!authReady) {
          finish(new Error("Chat completed without auth_ok"));
          return;
        }
        if (!sawVisibleOutput) {
          finish(new Error("Chat completed without any visible output events"));
          return;
        }
        if (!finalText && streamedText) {
          finalText = streamedText;
        }
        if (requireToolUse && !eventStats.tool_use_start) {
          finish(new Error("Chat completed without any tool use events"));
          return;
        }
        if (expectedSubstring && !finalText.includes(expectedSubstring)) {
          finish(
            new Error(
              `Chat response did not contain expected substring: ${expectedSubstring}`
            )
          );
          return;
        }
        ws.close(1000, "chat smoke complete");
        finish(null);
      }
    });

    ws.on("close", (code, reason) => {
      if (receivedDone) return;
      finish(
        new Error(
          `Socket closed before completion: ${code} ${String(reason || "")}`.trim()
        )
      );
    });

    ws.on("error", (error) => {
      finish(error);
    });
  });

  console.log("[chat-smoke] Success", JSON.stringify(outcome));
}

main().catch((error) => {
  console.error("[chat-smoke] Failed:", error.message);
  process.exit(1);
});
