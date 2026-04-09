import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import {
  useChatStoreApi,
  useScopedChatStore,
  type ChatStoreApi,
} from "@/contexts/chat-store-context";
import { useChatPageContext } from "@/contexts/chat-page-context";
import { filesToAttachmentPayloads } from "@/lib/chat-attachments";
import { getAgentHttpBase } from "@/lib/agent-http";
import type {
  MentionRef,
  ServerMessage,
  ClientMessage,
} from "@/types/chat";
import { expandDefendExistenceCommand } from "@/lib/defend-existence";

function getAgentWsBase(): string {
  const explicit = import.meta.env.VITE_AGENT_WS_URL as string | undefined;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return explicit.trim().replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/agent`;
  }
  return "ws://localhost:3001";
}

async function fetchChatSessionToken(accessToken: string): Promise<string> {
  const response = await fetch(`${getAgentHttpBase()}/chat/session-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Chat session token request failed (${response.status})`);
  }
  const payload = (await response.json()) as { token?: string };
  const token = payload.token?.trim() ?? "";
  if (!token) {
    throw new Error("Chat session token response was missing a token");
  }
  return token;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const CONNECTION_READY_TIMEOUT_MS = 10_000;
const CONNECTION_READY_POLL_MS = 50;

const WS_CLOSE_UNAUTHORIZED = 4001;

function isChatDebugEnabled(): boolean {
  const override = import.meta.env.VITE_CHAT_DEBUG as string | undefined;
  if (override === "1") return true;
  if (override === "0") return false;
  return import.meta.env.DEV;
}

function chatDebug(event: string, detail?: Record<string, unknown>) {
  if (!isChatDebugEnabled()) return;
  if (detail) {
    console.debug(`[chat] ${event}`, detail);
    return;
  }
  console.debug(`[chat] ${event}`);
}

function resolveTargetTabId(storeApi: ChatStoreApi): string {
  const s = storeApi.getState();
  return s.streamingTabId ?? s.activeTabId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureAssistantMessage(storeApi: ChatStoreApi, tabId: string) {
  const s = storeApi.getState();
  const tab = s.tabs.find((t) => t.id === tabId);
  const last = tab?.messages[tab.messages.length - 1];
  if (last?.role === "assistant") return;
  s.addMessage(tabId, {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    toolUses: [],
  });
}

function handleServerMessage(msg: ServerMessage, storeApi: ChatStoreApi) {
  const s = storeApi.getState();

  switch (msg.type) {
    case "auth_ok":
      s.setConnectionStatus("connected");
      break;

    case "session":
      if (s.streamingTabId == null) return;
      s.setTabAgentSessionId(s.streamingTabId, msg.sessionId);
      break;

    case "model_info":
      s.setAgentModel(msg.model);
      break;

    case "runtime_info":
      s.setAgentRuntime({
        backend: msg.backend,
        label: msg.label,
        traces: msg.traces,
        workspaceDir: msg.workspaceDir,
      });
      break;

    case "text_delta": {
      const tabId = resolveTargetTabId(storeApi);
      if (!s.isStreaming) {
        s.addMessage(tabId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          toolUses: [],
        });
        s.setStreaming(true);
      }
      s.appendToLastMessage(tabId, msg.content);
      break;
    }

    case "thinking_delta": {
      const tabId = resolveTargetTabId(storeApi);
      if (!s.isStreaming) {
        s.addMessage(tabId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          toolUses: [],
        });
        s.setStreaming(true);
      }
      s.appendThinkingToLastMessage(tabId, msg.content);
      break;
    }

    case "text_done":
      {
        const tabId = resolveTargetTabId(storeApi);
        const tab = s.tabs.find((t) => t.id === tabId);
        const last = tab?.messages[tab.messages.length - 1];
        if (!last || last.role !== "assistant") {
          s.addMessage(tabId, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: msg.content,
            timestamp: Date.now(),
            toolUses: [],
          });
          break;
        }
        if (!last.content && msg.content) {
          s.appendToLastMessage(tabId, msg.content);
        }
      }
      break;

    case "tool_use_start": {
      const tabId = resolveTargetTabId(storeApi);
      if (!s.isStreaming) {
        s.setStreaming(true);
      }
      ensureAssistantMessage(storeApi, tabId);
      s.addToolUseToLastMessage(tabId, {
        id: msg.id,
        tool: msg.tool,
        input: msg.input,
        status: "running",
      });
      break;
    }

    case "tool_approval_required": {
      const tabId = resolveTargetTabId(storeApi);
      ensureAssistantMessage(storeApi, tabId);
      s.addToolUseToLastMessage(tabId, {
        id: msg.toolUseID,
        tool: msg.tool,
        input: msg.input,
        status: "awaiting_approval",
      });
      s.addPendingToolApproval(tabId, {
        approvalId: msg.approvalId,
        toolUseID: msg.toolUseID,
        tool: msg.tool,
        input: msg.input,
        destructive: msg.destructive,
        kind: msg.kind,
      });
      s.updateToolUse(tabId, msg.toolUseID, {
        status: "awaiting_approval",
        input: msg.input,
      });
      break;
    }

    case "tool_use_error": {
      const tabId = resolveTargetTabId(storeApi);
      s.updateToolUse(tabId, msg.id, {
        output: msg.error,
        status: "error",
      });
      break;
    }

    case "tool_use_end": {
      const tabId = resolveTargetTabId(storeApi);
      let skipDone = false;
      const tab = s.tabs.find((t) => t.id === tabId);
      if (tab) {
        for (const m of tab.messages) {
          if (m.role !== "assistant" || !m.toolUses) continue;
          const tu = m.toolUses.find((x) => x.id === msg.id);
          if (tu?.status === "error") {
            skipDone = true;
            break;
          }
        }
      }
      if (!skipDone) {
        s.updateToolUse(tabId, msg.id, {
          output: msg.output,
          status: "done",
        });
      }
      break;
    }

    case "tasks":
      s.setTasks(resolveTargetTabId(storeApi), msg.tasks);
      break;

    case "error":
      if (msg.message.includes("Claude Code process exited with code 1")) {
        s.setTabAgentSessionId(resolveTargetTabId(storeApi), null);
      }
      s.addMessage(resolveTargetTabId(storeApi), {
        id: crypto.randomUUID(),
        role: "system",
        content: msg.message,
        timestamp: Date.now(),
      });
      break;

    case "done": {
      const tabId = resolveTargetTabId(storeApi);
      s.setStreaming(false);
      s.setStreamingTabId(null);
      s.clearPendingToolApprovals(tabId);
      break;
    }
  }
}

export function useChat() {
  const pageContext = useChatPageContext();
  const accessToken = useAuthStore((s) => s.session?.access_token);
  const authLoading = useAuthStore((s) => s.loading);

  const chatStoreApi = useChatStoreApi();
  const chatStoreApiRef = useRef(chatStoreApi);
  chatStoreApiRef.current = chatStoreApi;

  const messages = useScopedChatStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.messages ?? [];
  });
  const tasks = useScopedChatStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.tasks ?? [];
  });
  const agentModel = useScopedChatStore((s) => s.agentModel);
  const agentRuntime = useScopedChatStore((s) => s.agentRuntime);
  const isStreaming = useScopedChatStore((s) => s.isStreaming);
  const connectionStatus = useScopedChatStore((s) => s.connectionStatus);
  const clearConversation = useScopedChatStore((s) => s.clearConversation);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const authFailureRef = useRef(false);
  const authErrorLoggedRef = useRef(false);
  const connectRef = useRef<() => Promise<void>>(async () => {});

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (authFailureRef.current) return;
    if (reconnectTimer.current) return;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      reconnectDelay.current = Math.min(
        reconnectDelay.current * 2,
        RECONNECT_MAX_MS
      );
      void connectRef.current();
    }, reconnectDelay.current);
  }, []);

  const waitForConnected = useCallback(async (): Promise<boolean> => {
    const deadline = Date.now() + CONNECTION_READY_TIMEOUT_MS;
    let sawConnectionAttempt = false;

    while (Date.now() < deadline) {
      const ws = wsRef.current;
      const status = chatStoreApiRef.current.getState().connectionStatus;

      if (ws?.readyState === WebSocket.OPEN && status === "connected") {
        return true;
      }

      if (authFailureRef.current) {
        return false;
      }

      if (ws || status === "connecting") {
        sawConnectionAttempt = true;
      } else if (sawConnectionAttempt && status === "disconnected") {
        return false;
      }

      await sleep(CONNECTION_READY_POLL_MS);
    }

    return false;
  }, []);

  const connect = useCallback(async () => {
    if (authFailureRef.current) return;

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      chatDebug("connect:no-session", {
        hasError: Boolean(sessionError),
      });
      chatStoreApiRef.current.getState().setConnectionStatus("disconnected");
      return;
    }

    let sess = sessionData.session;
    const expiresAtMs = (sess.expires_at ?? 0) * 1000;
    if (expiresAtMs < Date.now() + 60_000) {
      const { data: refreshed, error: refreshErr } =
        await supabase.auth.refreshSession();
      if (!refreshErr && refreshed.session?.access_token) {
        sess = refreshed.session;
      }
    }

    const token = sess.access_token;
    if (!token) return;

    const existingSocket = wsRef.current;
    if (
      existingSocket?.readyState === WebSocket.OPEN ||
      existingSocket?.readyState === WebSocket.CONNECTING
    ) {
      chatDebug("connect:skip-existing-socket", {
        readyState: existingSocket.readyState,
      });
      return;
    }

    chatDebug("connect:start");
    chatStoreApiRef.current.getState().setConnectionStatus("connecting");

    let wsToken: string;
    try {
      wsToken = await fetchChatSessionToken(token);
    } catch (error) {
      chatDebug("connect:session-token-error", {
        message: error instanceof Error ? error.message : String(error),
      });
      chatStoreApiRef.current.getState().setConnectionStatus("disconnected");
      return;
    }

    const url = new URL(`${getAgentWsBase()}/chat`);
    url.searchParams.set("ws_token", wsToken);
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      chatDebug("ws:open", {
        authSent: false,
      });
      authFailureRef.current = false;
      authErrorLoggedRef.current = false;
      chatStoreApiRef.current.getState().setConnectionStatus("connecting");
      reconnectDelay.current = RECONNECT_BASE_MS;
    };

    ws.onmessage = (evt) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === "ping") {
        const pong: ClientMessage = { type: "pong" };
        ws.send(JSON.stringify(pong));
        chatDebug("ws:ping");
        return;
      }
      if (msg.type === "auth_ok") {
        chatDebug("ws:auth-ok");
      } else if (msg.type === "session") {
        chatDebug("ws:session", { sessionId: msg.sessionId });
      } else if (msg.type === "model_info") {
        chatDebug("ws:model", { model: msg.model });
      } else if (msg.type === "runtime_info") {
        chatDebug("ws:runtime", {
          backend: msg.backend,
          workspaceDir: msg.workspaceDir ?? null,
        });
      } else if (msg.type === "error") {
        chatDebug("ws:error", { message: msg.message });
      } else if (msg.type === "done") {
        chatDebug("ws:done");
      }
      handleServerMessage(msg, chatStoreApiRef.current);
    };

    ws.onclose = (ev) => {
      chatDebug("ws:close", {
        code: ev.code,
        reason: ev.reason,
      });
      wsRef.current = null;
      const st = chatStoreApiRef.current.getState();
      const tabId = st.streamingTabId ?? st.activeTabId;
      st.setConnectionStatus("disconnected");
      st.setStreaming(false);
      st.setStreamingTabId(null);
      st.clearPendingToolApprovals(tabId);

      if (ev.code === WS_CLOSE_UNAUTHORIZED) {
        void (async () => {
          const { data: r } = await supabase.auth.refreshSession();
          if (r.session?.access_token) {
            authFailureRef.current = false;
            reconnectDelay.current = RECONNECT_BASE_MS;
            await connectRef.current();
            return;
          }
          authFailureRef.current = true;
          if (!authErrorLoggedRef.current) {
            authErrorLoggedRef.current = true;
            const s = chatStoreApiRef.current.getState();
            s.addMessage(s.activeTabId, {
              id: crypto.randomUUID(),
              role: "system",
              content:
                "Chat could not verify your session. Sign out and sign in again, and ensure the agent server uses the same Supabase URL and anon key as this app (see server/example.env).",
              timestamp: Date.now(),
            });
          }
        })();
        return;
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      chatDebug("ws:error-event");
      ws.close();
    };
  }, [scheduleReconnect]);

  connectRef.current = connect;

  useEffect(() => {
    authFailureRef.current = false;
    authErrorLoggedRef.current = false;

    if (!accessToken) {
      if (authLoading) {
        chatStoreApiRef.current.getState().setConnectionStatus("connecting");
      } else {
        chatStoreApiRef.current.getState().setConnectionStatus("disconnected");
      }
      return;
    }

    void connect();

    return () => {
      clearReconnectTimer();
      // Keep the WS alive across React unmount/remount cycles.
      // The canvas→chat transition remounts this hook — closing the WS
      // here would kill in-flight queries. Connection persists via wsRef.
    };
  }, [accessToken, authLoading, connect, clearReconnectTimer]);

  const send = useCallback(
    async (content: string, mentions: MentionRef[] = [], files: File[] = []) => {
      const preflightState = chatStoreApiRef.current.getState();
      const activeTabId = preflightState.activeTabId;
      let ws = wsRef.current;
      let connection = preflightState.connectionStatus;

      if (!ws || ws.readyState !== WebSocket.OPEN || connection !== "connected") {
        chatDebug("send:await-connection", {
          hasSocket: Boolean(ws),
          readyState: ws?.readyState ?? null,
          connectionStatus: connection,
        });
        await connectRef.current();
        const waitStartedAt = Date.now();
        const connected = await waitForConnected();
        chatDebug(
          connected ? "send:connection-ready" : "send:connection-timeout",
          {
            waitMs: Date.now() - waitStartedAt,
          }
        );
        ws = wsRef.current;
        connection = chatStoreApiRef.current.getState().connectionStatus;
        if (!connected || !ws || ws.readyState !== WebSocket.OPEN || connection !== "connected") {
          const s = chatStoreApiRef.current.getState();
          s.setStreaming(false);
          s.setStreamingTabId(null);
          s.addMessage(activeTabId, {
            id: crypto.randomUUID(),
            role: "system",
            content:
              "Chat is still connecting to the agent. Please try again in a moment.",
            timestamp: Date.now(),
          });
          return;
        }
      }

      const s0 = chatStoreApiRef.current.getState();
      s0.setStreamingTabId(activeTabId);

      const attachmentPayload =
        files.length > 0 ? await filesToAttachmentPayloads(files) : undefined;

      const attachmentMeta = files.map((f) => ({
        name: f.name,
        mimeType: f.type || undefined,
      }));

      const wireContent = expandDefendExistenceCommand(content) ?? content;

      const s1 = chatStoreApiRef.current.getState();
      s1.addMessage(activeTabId, {
        id: crypto.randomUUID(),
        role: "user",
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
        timestamp: Date.now(),
      });
      s1.setStreaming(true);

      const s2 = chatStoreApiRef.current.getState();
      const tab = s2.tabs.find((t) => t.id === activeTabId);

      const payload: ClientMessage = {
        type: "message",
        content: wireContent,
        mentions,
        sessionId: tab?.agentSessionId ?? undefined,
        pageContext: pageContext ?? undefined,
        attachments: attachmentPayload,
      };
      chatDebug("send", {
        activeTabId,
        resumeSessionId: tab?.agentSessionId ?? null,
        mentionCount: mentions.length,
        attachmentCount: attachmentPayload?.length ?? 0,
        contentPreview: wireContent.slice(0, 80),
      });
      ws.send(JSON.stringify(payload));
    },
    [pageContext, waitForConnected]
  );

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: ClientMessage = { type: "cancel" };
    ws.send(JSON.stringify(payload));
  }, []);

  const approveTool = useCallback((approvalId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const s0 = chatStoreApiRef.current.getState();
    const tabId = s0.streamingTabId ?? s0.activeTabId;
    s0.removePendingToolApproval(tabId, approvalId);
    s0.updateToolUse(tabId, approvalId, { status: "running" });
    const payload: ClientMessage = { type: "approve_tool", approvalId };
    ws.send(JSON.stringify(payload));
  }, []);

  const denyTool = useCallback((approvalId: string, reason?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const s0 = chatStoreApiRef.current.getState();
    const tabId = s0.streamingTabId ?? s0.activeTabId;
    s0.removePendingToolApproval(tabId, approvalId);
    s0.updateToolUse(tabId, approvalId, { status: "error" });
    const payload: ClientMessage = {
      type: "deny_tool",
      approvalId,
      reason,
    };
    ws.send(JSON.stringify(payload));
  }, []);

  return {
    send,
    cancel,
    approveTool,
    denyTool,
    messages,
    tasks,
    agentModel,
    agentRuntime,
    isStreaming,
    isConnected: connectionStatus === "connected",
    connectionStatus,
    clearConversation,
  };
}
