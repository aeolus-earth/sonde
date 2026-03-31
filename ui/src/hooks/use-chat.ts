import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import type {
  MentionRef,
  ServerMessage,
  ClientMessage,
} from "@/types/chat";

function getAgentWsBase(): string {
  const explicit = import.meta.env.VITE_AGENT_WS_URL as string | undefined;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return explicit.trim().replace(/\/$/, "");
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/agent`;
  }
  return "ws://localhost:3001";
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const WS_CLOSE_UNAUTHORIZED = 4001;

function handleServerMessage(msg: ServerMessage) {
  const s = useChatStore.getState();

  switch (msg.type) {
    case "session":
      s.setSessionId(msg.sessionId);
      break;

    case "text_delta":
      if (!s.isStreaming) {
        s.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          toolUses: [],
        });
        s.setStreaming(true);
      }
      s.appendToLastMessage(msg.content);
      break;

    case "text_done":
      break;

    case "tool_use_start":
      if (!s.isStreaming) {
        s.addMessage({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          toolUses: [],
        });
        s.setStreaming(true);
      }
      s.addToolUseToLastMessage({
        id: msg.id,
        tool: msg.tool,
        input: msg.input,
        status: "running",
      });
      break;

    case "tool_use_end":
      s.updateToolUse(msg.id, {
        output: msg.output,
        status: "done",
      });
      break;

    case "tasks":
      s.setTasks(msg.tasks);
      break;

    case "error":
      s.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: msg.message,
        timestamp: Date.now(),
      });
      break;

    case "done":
      s.setStreaming(false);
      break;
  }
}

export function useChat() {
  const accessToken = useAuthStore((s) => s.session?.access_token);
  const authLoading = useAuthStore((s) => s.loading);

  const messages = useChatStore((s) => s.messages);
  const tasks = useChatStore((s) => s.tasks);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const clearConversation = useChatStore((s) => s.clearConversation);

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

  const connect = useCallback(async () => {
    if (authFailureRef.current) return;

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      useChatStore.getState().setConnectionStatus("disconnected");
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

    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    useChatStore.getState().setConnectionStatus("connecting");

    const url = `${getAgentWsBase()}/chat?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      authFailureRef.current = false;
      authErrorLoggedRef.current = false;
      useChatStore.getState().setConnectionStatus("connected");
      reconnectDelay.current = RECONNECT_BASE_MS;
    };

    ws.onmessage = (evt) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      handleServerMessage(msg);
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      useChatStore.getState().setConnectionStatus("disconnected");
      useChatStore.getState().setStreaming(false);

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
            useChatStore.getState().addMessage({
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
      ws.close();
    };
  }, [scheduleReconnect]);

  connectRef.current = connect;

  useEffect(() => {
    authFailureRef.current = false;
    authErrorLoggedRef.current = false;

    if (!accessToken) {
      if (authLoading) {
        useChatStore.getState().setConnectionStatus("connecting");
      } else {
        useChatStore.getState().setConnectionStatus("disconnected");
      }
      return;
    }

    void connect();

    return () => {
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [accessToken, authLoading, connect, clearReconnectTimer]);

  const send = useCallback(
    (content: string, mentions: MentionRef[] = []) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const s = useChatStore.getState();

      s.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content,
        mentions: mentions.length > 0 ? mentions : undefined,
        timestamp: Date.now(),
      });

      const payload: ClientMessage = {
        type: "message",
        content,
        mentions,
        sessionId: s.sessionId ?? undefined,
      };
      ws.send(JSON.stringify(payload));
    },
    []
  );

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: ClientMessage = { type: "cancel" };
    ws.send(JSON.stringify(payload));
  }, []);

  const approveTasks = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: ClientMessage = { type: "approve_tasks" };
    ws.send(JSON.stringify(payload));
  }, []);

  return {
    send,
    cancel,
    approveTasks,
    messages,
    tasks,
    isStreaming,
    isConnected: connectionStatus === "connected",
    connectionStatus,
    clearConversation,
  };
}
