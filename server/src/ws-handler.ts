import type { Context } from "hono";
import type { WSEvents, WSContext } from "hono/ws";
import type { WebSocket } from "ws";
import { verifyToken } from "./auth.js";
import {
  createAgentSession,
  createSandboxAgentSession,
  isSandboxMode,
  type AgentSession,
} from "./agent.js";
import { createToolApprovalBridge } from "./tool-approval-bridge.js";
import type { SandboxHandle } from "./sandbox/daytona-client.js";
import type {
  ClientMessage,
  ServerMessage,
  MentionRef,
  PageContext,
  ChatAttachmentPayload,
} from "./types.js";

function send(ws: WSContext<WebSocket>, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

function parseRequestUrl(reqUrl: string): URL {
  try {
    return new URL(reqUrl);
  } catch {
    return new URL(reqUrl, "http://127.0.0.1");
  }
}

export function handleWebSocket(
  c: Context
): WSEvents<WebSocket> | Promise<WSEvents<WebSocket>> {
  const token = parseRequestUrl(c.req.url).searchParams.get("token");

  let session: AgentSession | null = null;
  let approvalBridge: ReturnType<typeof createToolApprovalBridge> | null = null;
  let sandboxHandle: SandboxHandle | null = null;

  return {
    async onOpen(_evt, ws) {
      if (!token) {
        send(ws, { type: "error", message: "Missing authentication token" });
        ws.close(4001, "Unauthorized");
        return;
      }

      const user = await verifyToken(token);
      if (!user) {
        send(ws, { type: "error", message: "Invalid or expired token" });
        ws.close(4001, "Unauthorized");
        return;
      }

      approvalBridge = createToolApprovalBridge(ws);

      if (isSandboxMode()) {
        try {
          const { initSandbox } = await import("./sandbox/sandbox-init.js");
          sandboxHandle = await initSandbox({
            sondeToken: token,
            supabaseUrl: process.env.VITE_SUPABASE_URL,
            supabaseKey: process.env.VITE_SUPABASE_ANON_KEY,
          });
          session = createSandboxAgentSession({
            canUseTool: approvalBridge.canUseTool,
            sandbox: sandboxHandle,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Sandbox init failed";
          console.error("[sandbox] Init failed, falling back to MCP:", msg);
          session = createAgentSession(token, {
            canUseTool: approvalBridge.canUseTool,
          });
        }
      } else {
        session = createAgentSession(token, {
          canUseTool: approvalBridge.canUseTool,
        });
      }
      send(ws, { type: "session", sessionId: session.sessionId });
    },

    async onMessage(evt, ws) {
      if (!session) return;

      let raw: string;
      if (typeof evt.data === "string") {
        raw = evt.data;
      } else if (evt.data instanceof Blob) {
        raw = await evt.data.text();
      } else {
        raw = Buffer.from(evt.data).toString("utf-8");
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      switch (msg.type) {
        case "message":
          await handleUserMessage(
            session,
            ws,
            msg.content,
            msg.mentions ?? [],
            msg.pageContext,
            msg.attachments,
            msg.sessionId
          );
          break;
        case "approve_tasks":
          // Legacy no-op: proposed tasks are preview-only; mutating tools use approve_tool.
          break;
        case "approve_tool":
          approvalBridge?.resolveApproval(msg.approvalId, true);
          break;
        case "deny_tool":
          approvalBridge?.resolveApproval(msg.approvalId, false, msg.reason);
          break;
        case "cancel":
          session.abort();
          send(ws, { type: "done" });
          break;
        default:
          send(ws, { type: "error", message: `Unknown message type` });
      }
    },

    onClose() {
      approvalBridge?.dispose();
      approvalBridge = null;
      if (session) {
        session.close();
        session = null;
      }
      if (sandboxHandle) {
        sandboxHandle.dispose().catch(() => {});
        sandboxHandle = null;
      }
    },

    onError(_evt) {
      approvalBridge?.dispose();
      approvalBridge = null;
      if (session) {
        session.close();
        session = null;
      }
      if (sandboxHandle) {
        sandboxHandle.dispose().catch(() => {});
        sandboxHandle = null;
      }
    },
  };
}

function formatPageContextLine(ctx: PageContext): string {
  if (ctx.type === "experiment") {
    const label = ctx.label ? ` (${ctx.label})` : "";
    return `Page context: the user is viewing experiment ${ctx.id}${label}. Prefer Sonde tools (e.g. sonde_show) for full detail when answering.`;
  }
  return "";
}

function formatAttachmentsForPrompt(
  attachments: ChatAttachmentPayload[] | undefined
): string {
  if (!attachments?.length) return "";
  const lines: string[] = [
    "The user attached files in the chat composer (names and optional text content):",
  ];
  for (const a of attachments) {
    lines.push(`- ${a.name} (${a.mimeType})`);
    if (a.dataBase64) {
      let decoded: string;
      try {
        decoded = Buffer.from(a.dataBase64, "base64").toString("utf8");
      } catch {
        decoded = "[could not decode attachment]";
      }
      const cap = 12_000;
      const truncated =
        decoded.length > cap
          ? `${decoded.slice(0, cap)}\n…[truncated]`
          : decoded;
      lines.push(`  Content:\n${truncated}`);
    }
  }
  return lines.join("\n");
}

async function handleUserMessage(
  session: AgentSession,
  ws: WSContext<WebSocket>,
  content: string,
  mentions: MentionRef[],
  pageContext?: PageContext,
  attachments?: ChatAttachmentPayload[],
  clientSessionId?: string
) {
  const pageLine = pageContext ? formatPageContextLine(pageContext) : "";
  const attachLine = formatAttachmentsForPrompt(attachments);
  const mentionContext = mentions
    .map((m) => {
      const prog =
        m.type === "experiment" && m.program
          ? ` program:${m.program}`
          : "";
      return `[${m.type}: ${m.id}${prog} "${m.label}"]`;
    })
    .join(" ");
  const body = mentionContext
    ? `${content}\n\nReferenced records: ${mentionContext}`
    : content;
  const chunks = [pageLine, attachLine, body].filter((s) => s.length > 0);
  const prompt = chunks.join("\n\n");

  try {
    for await (const event of session.query(prompt, {
      resumeSessionId: clientSessionId,
    })) {
      switch (event.type) {
        case "session":
          send(ws, { type: "session", sessionId: event.sessionId });
          break;
        case "model_info":
          send(ws, { type: "model_info", model: event.model });
          break;
        case "text_delta":
          send(ws, { type: "text_delta", content: event.content });
          break;
        case "text_done":
          send(ws, {
            type: "text_done",
            content: event.content,
            messageId: event.messageId,
          });
          break;
        case "tool_use_start":
          send(ws, {
            type: "tool_use_start",
            id: event.id,
            tool: event.tool,
            input: event.input,
          });
          break;
        case "tool_use_end":
          send(ws, {
            type: "tool_use_end",
            id: event.id,
            output: event.output,
          });
          break;
        case "tasks":
          send(ws, { type: "tasks", tasks: event.tasks });
          break;
        case "error":
          send(ws, { type: "error", message: event.message });
          break;
      }
    }
    send(ws, { type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent query failed";
    send(ws, { type: "error", message });
    send(ws, { type: "done" });
  }
}
