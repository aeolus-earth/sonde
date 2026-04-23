import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import {
  useChatStoreApi,
  useScopedChatStore,
  type ChatStoreApi,
} from "@/contexts/chat-store-context";
import { useChatPageContext } from "@/contexts/chat-page-context";
import { uploadChatAttachment } from "@/lib/chat-attachments";
import {
  getAgentHttpBase,
  getAgentWsBase,
  HostedAgentConfigError,
} from "@/lib/agent-http";
import {
  getFreshAccessToken,
  SessionReauthRequiredError,
} from "@/lib/session-auth";
import type {
  AttachmentTurnStatus,
  MentionRef,
  ServerMessage,
  ClientMessage,
  ChatAttachmentPayload,
} from "@/types/chat";
import { expandDefendExistenceCommand } from "@/lib/defend-existence";

const CHAT_REAUTH_MESSAGE = "Session expired. Sign in again to reconnect chat.";

async function fetchChatSessionToken(accessToken: string): Promise<string> {
  const response = await fetch(`${getAgentHttpBase()}/chat/session-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new SessionReauthRequiredError(CHAT_REAUTH_MESSAGE);
    }
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

function pushSystemMessage(storeApi: ChatStoreApi, content: string): void {
  const targetTabId = resolveTargetTabId(storeApi);
  storeApi.getState().addMessage(targetTabId, {
    id: crypto.randomUUID(),
    role: "system",
    content,
    timestamp: Date.now(),
  });
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
      if (s.connectionStatus !== "recovering") {
        s.setConnectionStatus("connected");
      }
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

    case "attachments_attached": {
      const tabId = resolveTargetTabId(storeApi);
      s.updateMessageAttachments(tabId, msg.messageId, msg.attachments);
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

    case "cost_alert":
      s.addMessage(resolveTargetTabId(storeApi), {
        id: crypto.randomUUID(),
        role: "system",
        content: msg.message,
        timestamp: Date.now(),
      });
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
  const clearConversationAction = useScopedChatStore((s) => s.clearConversation);
  const [attachmentStatus, setAttachmentStatus] =
    useState<AttachmentTurnStatus | null>(null);
  const attachmentStatusRef = useRef<AttachmentTurnStatus | null>(null);
  attachmentStatusRef.current = attachmentStatus;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const authFailureRef = useRef(false);
  const connectionIssueRef = useRef<string | null>(null);
  const recoveringSessionIdRef = useRef<string | null>(null);
  const connectRef = useRef<() => Promise<void>>(async () => {});
  const attachmentStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const pendingAttachmentMessageIdRef = useRef<string | null>(null);
  const pendingAttachmentTabIdRef = useRef<string | null>(null);

  const clearAttachmentStatusTimer = useCallback(() => {
    if (attachmentStatusTimerRef.current) {
      clearTimeout(attachmentStatusTimerRef.current);
      attachmentStatusTimerRef.current = null;
    }
  }, []);

  const setTransientAttachmentStatus = useCallback(
    (status: AttachmentTurnStatus | null, autoClearMs?: number) => {
      clearAttachmentStatusTimer();
      setAttachmentStatus(status);
      if (status && autoClearMs && autoClearMs > 0) {
        attachmentStatusTimerRef.current = setTimeout(() => {
          attachmentStatusTimerRef.current = null;
          setAttachmentStatus(null);
        }, autoClearMs);
      }
    },
    [clearAttachmentStatusTimer]
  );

  const clearConversation = useCallback(() => {
    clearAttachmentStatusTimer();
    pendingAttachmentMessageIdRef.current = null;
    pendingAttachmentTabIdRef.current = null;
    setAttachmentStatus(null);
    clearConversationAction();
  }, [clearAttachmentStatusTimer, clearConversationAction]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const setAuthRequiredState = useCallback(() => {
    authFailureRef.current = true;
    connectionIssueRef.current = null;
    clearReconnectTimer();
    clearAttachmentStatusTimer();
    pendingAttachmentMessageIdRef.current = null;
    pendingAttachmentTabIdRef.current = null;
    setAttachmentStatus(null);
    const store = chatStoreApiRef.current.getState();
    store.setConnectionStatus("auth_required");
    store.setStreaming(false);
    store.setStreamingTabId(null);
  }, [clearAttachmentStatusTimer, clearReconnectTimer]);

  const scheduleReconnect = useCallback(() => {
    if (authFailureRef.current) return;
    if (reconnectTimer.current) return;
    chatStoreApiRef.current.getState().setConnectionStatus("reconnecting");
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
    let token: string;
    try {
      token = await getFreshAccessToken({
        reauthMessage: CHAT_REAUTH_MESSAGE,
      });
    } catch (error) {
      if (error instanceof SessionReauthRequiredError) {
        chatDebug("connect:reauth-required");
        setAuthRequiredState();
        return;
      }
      chatDebug("connect:no-session", {
        message: error instanceof Error ? error.message : String(error),
      });
      chatStoreApiRef.current.getState().setConnectionStatus("disconnected");
      return;
    }

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
    let wsBase: string;
    try {
      wsToken = await fetchChatSessionToken(token);
      wsBase = getAgentWsBase();
    } catch (error) {
      if (error instanceof SessionReauthRequiredError) {
        chatDebug("connect:session-token-reauth");
        setAuthRequiredState();
        return;
      }
      chatDebug("connect:session-token-error", {
        message: error instanceof Error ? error.message : String(error),
      });
      chatStoreApiRef.current.getState().setConnectionStatus("disconnected");
      const message =
        error instanceof HostedAgentConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Chat could not reach the agent.";
      if (connectionIssueRef.current !== message) {
        connectionIssueRef.current = message;
        pushSystemMessage(chatStoreApiRef.current, message);
      }
      return;
    }

    const url = new URL(`${wsBase}/chat`);
    url.searchParams.set("ws_token", wsToken);
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      chatDebug("ws:open", {
        authSent: false,
      });
      authFailureRef.current = false;
      connectionIssueRef.current = null;
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
      if (recoveringSessionIdRef.current && msg.type !== "auth_ok") {
        chatStoreApiRef.current.getState().setConnectionStatus("connected");
        recoveringSessionIdRef.current = null;
      }
      if (msg.type === "auth_ok") {
        chatDebug("ws:auth-ok");
        const store = chatStoreApiRef.current.getState();
        const tabId = resolveTargetTabId(chatStoreApiRef.current);
        const tab = store.tabs.find((item) => item.id === tabId);
        const sessionId = tab?.agentSessionId?.trim() ?? "";
        if (sessionId) {
          recoveringSessionIdRef.current = sessionId;
          store.setConnectionStatus("recovering");
          const payload: ClientMessage = {
            type: "resume_session",
            sessionId,
          };
          ws.send(JSON.stringify(payload));
        }
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

      if (msg.type === "attachments_attached") {
        pendingAttachmentMessageIdRef.current = null;
        pendingAttachmentTabIdRef.current = null;
        const attachmentCount = msg.attachments.length;
        setTransientAttachmentStatus(
          {
            phase: "attached",
            total: attachmentCount,
            completed: attachmentCount,
            message:
              attachmentCount === 1
                ? `${msg.attachments[0]?.name ?? "File"} attached to Claude.`
                : `${attachmentCount} files attached to Claude.`,
          },
          1600
        );
      } else if (msg.type === "error") {
        if (pendingAttachmentMessageIdRef.current) {
          const currentAttachmentStatus = attachmentStatusRef.current;
          const pendingCount = currentAttachmentStatus?.total ?? 0;
          setTransientAttachmentStatus(
            {
              phase: "failed",
              total: pendingCount,
              completed: currentAttachmentStatus?.completed ?? 0,
              message: msg.message,
            },
            3200
          );
        } else {
          clearAttachmentStatusTimer();
          setAttachmentStatus(null);
        }
      } else if (msg.type === "done") {
        pendingAttachmentMessageIdRef.current = null;
        pendingAttachmentTabIdRef.current = null;
        if (attachmentStatusRef.current?.phase !== "attached") {
          clearAttachmentStatusTimer();
          setAttachmentStatus(null);
        }
      }
    };

    ws.onclose = (ev) => {
      chatDebug("ws:close", {
        code: ev.code,
        reason: ev.reason,
      });
      wsRef.current = null;
      clearAttachmentStatusTimer();
      pendingAttachmentMessageIdRef.current = null;
      pendingAttachmentTabIdRef.current = null;
      setAttachmentStatus(null);
      const st = chatStoreApiRef.current.getState();
      st.setConnectionStatus(authFailureRef.current ? "disconnected" : "reconnecting");
      st.setStreaming(false);
      st.setStreamingTabId(null);

      if (ev.code === WS_CLOSE_UNAUTHORIZED) {
        void (async () => {
          authFailureRef.current = false;
          reconnectDelay.current = RECONNECT_BASE_MS;
          await connectRef.current();
        })();
        return;
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      chatDebug("ws:error-event");
      ws.close();
    };
  }, [
    clearAttachmentStatusTimer,
    scheduleReconnect,
    setAuthRequiredState,
    setTransientAttachmentStatus,
  ]);

  connectRef.current = connect;

  useEffect(() => {
    authFailureRef.current = false;
    connectionIssueRef.current = null;

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

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (!useAuthStore.getState().session) {
        return;
      }

      void (async () => {
        try {
          await getFreshAccessToken({
            reauthMessage: CHAT_REAUTH_MESSAGE,
          });
          if (chatStoreApiRef.current.getState().connectionStatus === "auth_required") {
            authFailureRef.current = false;
            await connectRef.current();
          }
        } catch (error) {
          if (error instanceof SessionReauthRequiredError) {
            setAuthRequiredState();
          }
        }
      })();
    };

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [setAuthRequiredState]);

  const send = useCallback(
    async (
      content: string,
      mentions: MentionRef[] = [],
      files: File[] = []
    ): Promise<boolean> => {
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
          return false;
        }
      }

      const wireContent = expandDefendExistenceCommand(content) ?? content;
      const s0 = chatStoreApiRef.current.getState();
      s0.setStreamingTabId(activeTabId);
      const tab = s0.tabs.find((t) => t.id === activeTabId);
      const resumeSessionId = tab?.agentSessionId ?? undefined;
      const userMessageId = crypto.randomUUID();
      const hasAttachments = files.length > 0;

      let attachmentPayload: ChatAttachmentPayload[] | undefined;
      if (hasAttachments) {
        if (!accessToken) {
          setAuthRequiredState();
          return false;
        }

        setTransientAttachmentStatus({
          phase: "uploading",
          total: files.length,
          completed: 0,
          currentFileName: files[0]?.name,
          message:
            files.length === 1
              ? `Uploading ${files[0]?.name ?? "file"} to Claude...`
              : `Uploading ${files.length} files to Claude...`,
        });

        try {
          const uploadedAttachments: ChatAttachmentPayload[] = [];
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            if (!file) continue;
            setTransientAttachmentStatus({
              phase: "uploading",
              total: files.length,
              completed: index,
              currentFileName: file.name,
              message:
                files.length === 1
                  ? `Uploading ${file.name} to Claude...`
                  : `Uploading ${index + 1}/${files.length}: ${file.name}`,
            });
            const uploaded = await uploadChatAttachment(file, accessToken);
            uploadedAttachments.push({
              ...uploaded,
              status: "uploaded",
            });
          }
          attachmentPayload = uploadedAttachments;
        } catch (error) {
          if (error instanceof SessionReauthRequiredError) {
            setAuthRequiredState();
            return false;
          }

          const message =
            error instanceof Error ? error.message : "Attachment upload failed.";
          setTransientAttachmentStatus(
            {
              phase: "failed",
              total: files.length,
              completed: 0,
              currentFileName: files[0]?.name,
              message,
            },
            3200
          );
          const s = chatStoreApiRef.current.getState();
          s.setStreaming(false);
          s.setStreamingTabId(null);
          s.addMessage(activeTabId, {
            id: crypto.randomUUID(),
            role: "system",
            content: message,
            timestamp: Date.now(),
          });
          return false;
        }

        setTransientAttachmentStatus({
          phase: "mounting",
          total: attachmentPayload.length,
          completed: attachmentPayload.length,
          currentFileName:
            attachmentPayload[attachmentPayload.length - 1]?.name,
          message:
            attachmentPayload.length === 1
              ? `Mounting ${attachmentPayload[0]?.name ?? "file"} in Claude...`
              : `Mounting ${attachmentPayload.length} files in Claude...`,
        });
      }

      ws = wsRef.current;
      connection = chatStoreApiRef.current.getState().connectionStatus;
      if (!ws || ws.readyState !== WebSocket.OPEN || connection !== "connected") {
        const s = chatStoreApiRef.current.getState();
        s.setStreaming(false);
        s.setStreamingTabId(null);
        pendingAttachmentMessageIdRef.current = null;
        pendingAttachmentTabIdRef.current = null;
        setTransientAttachmentStatus(
          hasAttachments
            ? {
                phase: "failed",
                total: files.length,
                completed: attachmentPayload?.length ?? 0,
                currentFileName:
                  attachmentPayload?.[attachmentPayload.length - 1]?.name ??
                  files[files.length - 1]?.name,
                message:
                  "Chat disconnected before the files could be mounted. Please try again.",
              }
            : null,
          hasAttachments ? 3200 : undefined
        );
        return false;
      }

      const s1 = chatStoreApiRef.current.getState();
      s1.addMessage(activeTabId, {
        id: userMessageId,
        role: "user",
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        attachments:
          attachmentPayload?.map((attachment) => ({
            ...attachment,
            status: "uploaded",
          })) ?? undefined,
        timestamp: Date.now(),
      });
      s1.setStreaming(true);
      pendingAttachmentMessageIdRef.current = hasAttachments ? userMessageId : null;
      pendingAttachmentTabIdRef.current = hasAttachments ? activeTabId : null;

      const payload: ClientMessage = {
        type: "message",
        content: wireContent,
        messageId: userMessageId,
        mentions,
        sessionId: resumeSessionId,
        pageContext: pageContext ?? undefined,
        attachments: attachmentPayload,
      };
      chatDebug("send", {
        activeTabId,
        resumeSessionId: resumeSessionId ?? null,
        mentionCount: mentions.length,
        attachmentCount: attachmentPayload?.length ?? 0,
        contentPreview: wireContent.slice(0, 80),
      });
      ws.send(JSON.stringify(payload));
      return true;
    },
    [
      accessToken,
      pageContext,
      setAuthRequiredState,
      setTransientAttachmentStatus,
      waitForConnected,
    ]
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
    attachmentStatus,
    isConnected: connectionStatus === "connected",
    connectionStatus,
    clearConversation,
  };
}
