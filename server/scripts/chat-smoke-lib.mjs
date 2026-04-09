import WebSocket from "ws";

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBooleanFlag(value) {
  return value === "1" || value === "true";
}

export function resolveWsUrl({
  explicitWsUrl = process.env.CHAT_SMOKE_WS_URL?.trim(),
  httpBase = process.env.CHAT_SMOKE_HTTP_BASE?.trim(),
} = {}) {
  if (explicitWsUrl) {
    return explicitWsUrl.replace(/\/$/, "");
  }

  if (!httpBase) {
    throw new Error("Set CHAT_SMOKE_WS_URL or CHAT_SMOKE_HTTP_BASE.");
  }

  const url = new URL(httpBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat`;
  return url.toString();
}

function resolveHttpBaseFromWsUrl(wsUrl) {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return `${url.origin}${url.pathname.replace(/\/chat$/, "")}`;
}

export async function fetchChatSessionToken(httpBase, token) {
  const response = await fetch(`${httpBase.replace(/\/$/, "")}/chat/session-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Session token request failed (${response.status}): ${bodyText.slice(0, 160)}`
    );
  }
  const payload = bodyText ? JSON.parse(bodyText) : {};
  const wsToken = payload?.token?.trim?.() ?? "";
  if (!wsToken) {
    throw new Error("Session token response did not include a token.");
  }
  return wsToken;
}

function summarizeText(text) {
  if (!text) {
    return "(empty)";
  }

  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "(whitespace only)";
  }

  return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine;
}

export async function runChatConversation({
  wsUrl,
  token,
  messagePayload,
  timeoutMs,
  expectedSubstring = null,
  requireToolUse = false,
}) {
  const httpBase = resolveHttpBaseFromWsUrl(wsUrl);
  const wsToken = await fetchChatSessionToken(httpBase, token);
  const url = new URL(wsUrl);
  url.searchParams.set("ws_token", wsToken);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const ws = new WebSocket(url);
    const eventStats = {};
    let sawVisibleOutput = false;
    let receivedDone = false;
    let authReady = false;
    let messageSent = false;
    let streamedText = "";
    let finalText = "";
    let lastEventType = null;

    const timer = setTimeout(() => {
      ws.close();
      const preview = summarizeText(finalText || streamedText);
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for chat response ` +
            `(authReady=${authReady}, messageSent=${messageSent}, sawVisibleOutput=${sawVisibleOutput}, ` +
            `receivedDone=${receivedDone}, lastEventType=${lastEventType ?? "none"}, ` +
            `eventStats=${JSON.stringify(eventStats)}, preview=${preview})`
        )
      );
    }, timeoutMs);

    function finish(error) {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        eventStats,
        sawVisibleOutput,
        receivedDone,
        finalText,
        durationMs: Date.now() - startedAt,
      });
    }

    ws.on("open", () => {});

    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      lastEventType = message.type ?? null;
      eventStats[message.type] = (eventStats[message.type] ?? 0) + 1;

      if (
        message.type === "text_delta" ||
        message.type === "text_done" ||
        message.type === "thinking_delta" ||
        message.type === "tool_use_start" ||
        message.type === "tool_use_end" ||
        message.type === "tool_approval_required" ||
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
        if (!messageSent) {
          ws.send(JSON.stringify(messagePayload));
          messageSent = true;
        }
        return;
      }

      if (message.type === "tool_approval_required") {
        ws.send(
          JSON.stringify({
            type: "approve_tool",
            approvalId: message.approvalId,
            toolUseID: message.toolUseID,
          })
        );
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
          finish(
            new Error(
              `Chat completed without any tool use events. Final text: ${summarizeText(finalText)}`
            )
          );
          return;
        }
        if (expectedSubstring && !finalText.includes(expectedSubstring)) {
          finish(
            new Error(
              `Chat response did not contain expected substring: ${expectedSubstring}. Final text: ${summarizeText(finalText)}`
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
}
