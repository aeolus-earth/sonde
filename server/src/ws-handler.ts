import type { Context } from "hono";
import type { WSEvents, WSContext } from "hono/ws";
import type { WebSocket } from "ws";
import { verifyToken, type VerifiedUser } from "./auth.js";
import type { AgentSession } from "./agent.js";
import {
  checkUserRateLimit,
  tryStartUserOperation,
} from "./request-guard.js";
import { createToolApprovalBridge } from "./tool-approval-bridge.js";
import { getAgentBackend } from "./runtime-mode.js";
import type {
  AgentEvent,
  ChatAttachmentPayload,
  ClientMessage,
  MentionRef,
  PageContext,
  ServerMessage,
} from "./types.js";

const AUTH_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
// Tolerate brief client unreachability (Mac sleep, WiFi handoff, NAT blip)
// before declaring the WS dead. With a 30s interval, 3 misses ≈ 90s grace.
const MAX_MISSED_PONGS = 3;
const MAX_WS_MESSAGE_BYTES = 1_000_000;
const MAX_CHAT_ATTACHMENTS = 6;
const MAX_CONCURRENT_CHAT_QUERIES = 2;
const CHAT_RATE_LIMIT_PER_MINUTE = 20;

const WS_CLOSE_UNAUTHORIZED = 4001;
const WS_CLOSE_PROTOCOL = 4002;
const WS_CLOSE_IDLE = 4008;
const WS_CLOSE_HEARTBEAT = 4009;
const WS_CLOSE_MESSAGE_TOO_LARGE = 1009;

interface ConnectionState {
  connectionId: string;
  user: VerifiedUser | null;
  token: string | null;
  session: AgentSession | null;
  approvalBridge: ReturnType<typeof createToolApprovalBridge> | null;
  initialized: boolean;
  authenticated: boolean;
  authTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  missedPongs: number;
  closed: boolean;
  authenticating: Promise<boolean> | null;
  queryActive: boolean;
}

interface PreAuthenticatedState {
  accessToken: string;
  user: VerifiedUser;
}

function isChatDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SONDE_CHAT_DEBUG === "1") return true;
  if (env.SONDE_CHAT_DEBUG === "0") return false;
  const nodeEnv = env.NODE_ENV ?? "";
  return nodeEnv !== "production" && nodeEnv !== "test";
}

function chatLog(
  state: ConnectionState,
  event: string,
  detail?: Record<string, unknown>
): void {
  if (!isChatDebugEnabled()) return;
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[chat][${state.connectionId}] ${event}${payload}`);
}

function send(ws: WSContext<WebSocket>, msg: ServerMessage) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Ignore best-effort socket write failures.
  }
}

function sendAgentTraceEvent(
  ws: WSContext<WebSocket>,
  event: AgentEvent
): void {
  if (event.type === "tool_use_start") {
    send(ws, {
      type: "tool_use_start",
      id: event.id,
      tool: event.tool,
      input: event.input,
    });
  } else if (event.type === "tool_use_end") {
    send(ws, {
      type: "tool_use_end",
      id: event.id,
      output: event.output,
    });
  } else if (event.type === "tool_use_error") {
    send(ws, {
      type: "tool_use_error",
      id: event.id,
      error: event.error,
    });
  } else if (event.type === "tool_approval_required") {
    send(ws, {
      type: "tool_approval_required",
      approvalId: event.approvalId,
      toolUseID: event.toolUseID,
      tool: event.tool,
      input: event.input,
      destructive: event.destructive,
      kind: event.kind,
    });
  } else if (event.type === "cost_alert") {
    send(ws, {
      type: "cost_alert",
      severity: event.severity,
      sessionId: event.sessionId,
      estimatedTotalUsd: event.estimatedTotalUsd,
      message: event.message,
    });
  } else if (event.type === "attachments_attached") {
    send(ws, {
      type: "attachments_attached",
      messageId: event.messageId,
      attachments: event.attachments,
    });
  } else if (event.type === "error") {
    send(ws, {
      type: "error",
      message: event.message,
    });
  }
}

function sendRuntimeInfo(
  _state: ConnectionState,
  ws: WSContext<WebSocket>
): void {
  send(ws, {
    type: "runtime_info",
    backend: getAgentBackend(),
    label: "Claude Managed Agents",
    traces: true,
  });
}

function clearTimer(timer: NodeJS.Timeout | null): void {
  if (timer) clearTimeout(timer);
}

function getTestAuthDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SONDE_TEST_AUTH_DELAY_MS?.trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function closeWithError(
  ws: WSContext<WebSocket>,
  code: number,
  reason: string,
  message: string
): void {
  send(ws, { type: "error", message });
  ws.close(code, reason);
}

async function readRawMessage(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  return Buffer.from(data as ArrayBufferLike).toString("utf-8");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf-8");
}

function scheduleAuthTimeout(
  state: ConnectionState,
  ws: WSContext<WebSocket>
): void {
  clearTimer(state.authTimer);
  state.authTimer = setTimeout(() => {
    closeWithError(
      ws,
      WS_CLOSE_UNAUTHORIZED,
      "Authentication timeout",
      "Chat authentication timed out. Please reconnect."
    );
  }, AUTH_TIMEOUT_MS);
}

function scheduleIdleTimeout(
  state: ConnectionState,
  ws: WSContext<WebSocket>
): void {
  clearTimer(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    ws.close(WS_CLOSE_IDLE, "Idle timeout");
  }, IDLE_TIMEOUT_MS);
}

function startHeartbeat(
  state: ConnectionState,
  ws: WSContext<WebSocket>
): void {
  clearTimer(state.heartbeatTimer);
  state.heartbeatTimer = setInterval(() => {
    if (state.missedPongs >= MAX_MISSED_PONGS) {
      ws.close(WS_CLOSE_HEARTBEAT, "Heartbeat timeout");
      return;
    }
    state.missedPongs += 1;
    send(ws, { type: "ping" });
  }, HEARTBEAT_INTERVAL_MS);
}

function validateChatPayload(
  attachments: ChatAttachmentPayload[] | undefined
): string | null {
  if (!attachments?.length) return null;
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    return `Too many chat attachments. Maximum is ${MAX_CHAT_ATTACHMENTS}.`;
  }

  for (const attachment of attachments) {
    if (!attachment.fileId?.trim()) {
      return `Attachment ${attachment.name} is missing a file reference.`;
    }
    if (!attachment.name?.trim()) {
      return "Attachment name is required.";
    }
    if (!attachment.mimeType?.trim()) {
      return `Attachment ${attachment.name} is missing a MIME type.`;
    }
  }
  return null;
}

async function authenticateConnection(
  state: ConnectionState,
  ws: WSContext<WebSocket>,
  token: string
): Promise<boolean> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    closeWithError(
      ws,
      WS_CLOSE_UNAUTHORIZED,
      "Unauthorized",
      "Missing authentication token"
    );
    return false;
  }

  const testAuthDelayMs = getTestAuthDelayMs();
  if (testAuthDelayMs > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, testAuthDelayMs);
    });
  }

  const user = await verifyToken(trimmedToken);
  if (!user) {
    closeWithError(
      ws,
      WS_CLOSE_UNAUTHORIZED,
      "Unauthorized",
      "Invalid or expired token"
    );
    return false;
  }

  clearTimer(state.authTimer);
  state.authTimer = null;
  state.token = trimmedToken;
  state.user = user;
  state.authenticated = true;
  state.approvalBridge = createToolApprovalBridge(ws, {
    preservePendingOnDispose: true,
  });
  startHeartbeat(state, ws);
  send(ws, { type: "auth_ok" });
  sendRuntimeInfo(state, ws);
  chatLog(state, "authenticated", {
    userId: user.id,
  });
  return true;
}

function getPreAuthenticatedState(c: Context): PreAuthenticatedState | null {
  const accessToken = c.get("sondeAccessToken") as string | undefined;
  const user = c.get("sondeVerifiedUser") as VerifiedUser | undefined;
  if (!accessToken || !user) return null;
  return { accessToken, user };
}

function primeAuthenticatedConnection(
  state: ConnectionState,
  ws: WSContext<WebSocket>,
  authenticated: PreAuthenticatedState,
): void {
  clearTimer(state.authTimer);
  state.authTimer = null;
  state.token = authenticated.accessToken;
  state.user = authenticated.user;
  state.authenticated = true;
  state.approvalBridge = createToolApprovalBridge(ws, {
    preservePendingOnDispose: true,
  });
  startHeartbeat(state, ws);
  send(ws, { type: "auth_ok" });
  sendRuntimeInfo(state, ws);
  chatLog(state, "authenticated_pre_upgrade", {
    userId: authenticated.user.id,
  });
}

async function ensureInitialized(
  state: ConnectionState,
  ws: WSContext<WebSocket>,
  pageContext: PageContext | undefined,
  mentions: MentionRef[]
): Promise<boolean> {
  if (state.closed) return false;
  if (state.initialized) return state.session != null;
  const user = state.user;
  const token = state.token;
  const approvalBridge = state.approvalBridge;
  if (!state.authenticated || !user || !token || !approvalBridge) {
    return false;
  }

  if (!state.session) {
    const { createManagedAgentSession } = await import("./managed/session.js");
    state.session = createManagedAgentSession({
      sondeToken: token,
      user,
      pageContext,
      mentions,
      approvalBridge,
    });
  }

  if (state.closed) {
    state.session?.close();
    state.session = null;
    return false;
  }

  state.initialized = true;
  sendRuntimeInfo(state, ws);
  chatLog(state, "session_initialized", {
    backend: getAgentBackend(),
    sessionId: state.session.sessionId,
  });
  return true;
}

async function disposeConnectionState(state: ConnectionState): Promise<void> {
  if (state.closed) return;
  state.closed = true;

  clearTimer(state.authTimer);
  clearTimer(state.idleTimer);
  clearTimer(state.heartbeatTimer);
  state.authTimer = null;
  state.idleTimer = null;
  state.heartbeatTimer = null;

  state.approvalBridge?.dispose();
  state.approvalBridge = null;

  if (state.session) {
    state.session.close();
    state.session = null;
  }

  chatLog(state, "connection_disposed", {
    userId: state.user?.id ?? null,
  });
}

export function handleWebSocket(
  c: Context
): WSEvents<WebSocket> | Promise<WSEvents<WebSocket>> {
  const preAuthenticated = getPreAuthenticatedState(c);
  const state: ConnectionState = {
    connectionId: crypto.randomUUID(),
    user: null,
    token: null,
    session: null,
    approvalBridge: null,
    initialized: false,
    authenticated: false,
    authTimer: null,
    idleTimer: null,
    heartbeatTimer: null,
    missedPongs: 0,
    closed: false,
    authenticating: null,
    queryActive: false,
  };

  return {
    onOpen(_evt, ws) {
      chatLog(state, "socket_open");
      scheduleIdleTimeout(state, ws);
      if (preAuthenticated) {
        primeAuthenticatedConnection(state, ws, preAuthenticated);
        return;
      }
      scheduleAuthTimeout(state, ws);
    },

    async onMessage(evt, ws) {
      scheduleIdleTimeout(state, ws);

      const raw = await readRawMessage(evt.data);
      if (byteLength(raw) > MAX_WS_MESSAGE_BYTES) {
        closeWithError(
          ws,
          WS_CLOSE_MESSAGE_TOO_LARGE,
          "Message too large",
          "Chat request exceeded the maximum allowed size."
        );
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        chatLog(state, "invalid_json");
        send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (msg.type === "pong") {
        state.missedPongs = 0;
        return;
      }

      if (!state.authenticated) {
        if (msg.type === "auth") {
          if (!state.authenticating) {
            chatLog(state, "auth_frame_received");
            state.authenticating = authenticateConnection(state, ws, msg.token)
              .finally(() => {
                state.authenticating = null;
              });
          }
          await state.authenticating;
          return;
        }

        if (state.authenticating) {
          chatLog(state, "message_waiting_for_auth", { type: msg.type });
          const authenticated = await state.authenticating;
          if (!authenticated || !state.authenticated) {
            return;
          }
        } else {
          chatLog(state, "message_before_auth", { type: msg.type });
          closeWithError(
            ws,
            WS_CLOSE_PROTOCOL,
            "Authentication required",
            "Chat must authenticate before sending other messages."
          );
          return;
        }
      }

      state.missedPongs = 0;

      if (msg.type === "auth") {
        send(ws, { type: "error", message: "Chat is already authenticated." });
        return;
      }

      if (!state.user) {
        closeWithError(
          ws,
          WS_CLOSE_UNAUTHORIZED,
          "Unauthorized",
          "Chat session is missing user context."
        );
        return;
      }

      switch (msg.type) {
        case "resume_session": {
          const initialized = await ensureInitialized(state, ws, undefined, []);
          if (!initialized || !state.session?.recover) {
            send(ws, {
              type: "error",
              message: "Chat session could not be resumed.",
            });
            return;
          }

          for await (const event of state.session.recover(msg.sessionId)) {
            if (event.type === "session") {
              send(ws, { type: "session", sessionId: event.sessionId });
              continue;
            }
            if (event.type === "model_info") {
              send(ws, { type: "model_info", model: event.model });
              continue;
            }
            if (event.type === "text_delta") {
              send(ws, { type: "text_delta", content: event.content });
              continue;
            }
            if (event.type === "thinking_delta") {
              send(ws, { type: "thinking_delta", content: event.content });
              continue;
            }
            if (event.type === "text_done") {
              send(ws, {
                type: "text_done",
                content: event.content,
                messageId: event.messageId,
              });
              continue;
            }
            sendAgentTraceEvent(ws, event);
          }
          return;
        }

        case "message": {
          if (state.queryActive) {
            chatLog(state, "message_rejected_query_active");
            send(ws, {
              type: "error",
              message:
                "The assistant is still working on your previous request. Wait for it to finish or resolve the pending approval first.",
            });
            return;
          }
          chatLog(state, "user_message_received", {
            resumeSessionId: msg.sessionId ?? null,
            mentionCount: msg.mentions?.length ?? 0,
            attachmentCount: msg.attachments?.length ?? 0,
          });
          const messageId =
            typeof msg.messageId === "string" && msg.messageId.trim().length > 0
              ? msg.messageId.trim()
              : crypto.randomUUID();
          const attachmentError = validateChatPayload(msg.attachments);
          if (attachmentError) {
            send(ws, { type: "error", message: attachmentError });
            return;
          }

          const rateLimit = await checkUserRateLimit(
            "chat",
            state.user.id,
            CHAT_RATE_LIMIT_PER_MINUTE,
            60_000
          );
          if (!rateLimit.allowed) {
            send(ws, {
              type: "error",
              message: "Too many chat requests. Give the assistant a moment before sending more.",
            });
            return;
          }

          const releaseOperation = await tryStartUserOperation(
            "chat",
            state.user.id,
            MAX_CONCURRENT_CHAT_QUERIES
          );
          if (!releaseOperation) {
            send(ws, {
              type: "error",
              message: "Too many concurrent chat requests for this user. Wait for one to finish first.",
            });
            return;
          }

          try {
            state.queryActive = true;
            const initialized = await ensureInitialized(
              state,
              ws,
              msg.pageContext,
              msg.mentions ?? []
            );
            if (!initialized || !state.session) {
              send(ws, {
                type: "error",
                message: "Chat session could not be initialized.",
              });
              return;
            }

            await handleUserMessage(
              state,
              state.session,
              ws,
              msg.content,
              msg.mentions ?? [],
              msg.pageContext,
              msg.attachments,
              msg.sessionId,
              messageId
            );
          } finally {
            state.queryActive = false;
            await releaseOperation();
          }
          return;
        }

        case "approve_tasks":
          return;

        case "approve_tool":
          state.approvalBridge?.resolveApproval(msg.approvalId, true);
          return;

        case "deny_tool":
          state.approvalBridge?.resolveApproval(msg.approvalId, false, msg.reason);
          return;

        case "cancel":
          state.session?.abort();
          send(ws, { type: "done" });
          return;
      }
    },

    onClose() {
      void disposeConnectionState(state);
    },

    onError() {
      void disposeConnectionState(state);
    },
  };
}

async function handleUserMessage(
  state: ConnectionState,
  session: AgentSession,
  ws: WSContext<WebSocket>,
  content: string,
  mentions: MentionRef[],
  pageContext?: PageContext,
  attachments?: ChatAttachmentPayload[],
  clientSessionId?: string,
  messageId?: string
) {
  async function runQuery(
    resumeSessionId?: string,
    attempt: number = 1
  ): Promise<{ completed: boolean; emittedOutput: boolean }> {
    let emittedOutput = false;
    let eventCount = 0;
    const startedAt = Date.now();
    const eventStats: Record<string, number> = {};

    chatLog(state, "agent_query_start", {
      attempt,
      resumeSessionId: resumeSessionId ?? null,
    });

    try {
      for await (const event of session.query(content, {
        resumeSessionId,
        pageContext,
        mentions,
        attachments,
        messageId,
      })) {
        eventCount += 1;
        eventStats[event.type] = (eventStats[event.type] ?? 0) + 1;
        switch (event.type) {
          case "session":
            send(ws, { type: "session", sessionId: event.sessionId });
            chatLog(state, "agent_session", {
              attempt,
              sessionId: event.sessionId,
            });
            break;
          case "model_info":
            send(ws, { type: "model_info", model: event.model });
            chatLog(state, "agent_model", {
              attempt,
              model: event.model,
            });
            break;
          case "text_delta":
            emittedOutput = true;
            send(ws, { type: "text_delta", content: event.content });
            break;
          case "thinking_delta":
            emittedOutput = true;
            send(ws, { type: "thinking_delta", content: event.content });
            break;
          case "text_done":
            emittedOutput = true;
            send(ws, {
              type: "text_done",
              content: event.content,
              messageId: event.messageId,
            });
            break;
          case "attachments_attached":
            emittedOutput = true;
            send(ws, {
              type: "attachments_attached",
              messageId: event.messageId,
              attachments: event.attachments,
            });
            break;
          case "tool_use_start":
            emittedOutput = true;
            send(ws, {
              type: "tool_use_start",
              id: event.id,
              tool: event.tool,
              input: event.input,
            });
            break;
          case "tool_use_end":
            emittedOutput = true;
            send(ws, {
              type: "tool_use_end",
              id: event.id,
              output: event.output,
            });
            break;
          case "tool_use_error":
            emittedOutput = true;
            send(ws, {
              type: "tool_use_error",
              id: event.id,
              error: event.error,
            });
            break;
          case "tasks":
            emittedOutput = true;
            send(ws, { type: "tasks", tasks: event.tasks });
            break;
          case "error":
            emittedOutput = true;
            send(ws, { type: "error", message: event.message });
            break;
        }
      }

      chatLog(state, "agent_query_done", {
        attempt,
        eventCount,
        eventStats,
        durationMs: Date.now() - startedAt,
        emittedOutput,
      });
      return { completed: true, emittedOutput };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent query failed";
      chatLog(state, "agent_query_error", {
        attempt,
        resumeSessionId: resumeSessionId ?? null,
        eventCount,
        eventStats,
        durationMs: Date.now() - startedAt,
        emittedOutput,
        message,
      });

      send(ws, { type: "error", message });
      return { completed: false, emittedOutput };
    }
  }

  try {
    await runQuery(clientSessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent query failed";
    send(ws, { type: "error", message });
  }

  send(ws, { type: "done" });
}
