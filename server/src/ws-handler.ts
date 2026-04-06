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
  let corpusPulled = false;

  // Ready gate: onMessage waits for this before processing.
  // Resolves when onOpen finishes setting up the session.
  let resolveReady: () => void;
  const readyPromise = new Promise<void>((r) => {
    resolveReady = r;
  });

  return {
    async onOpen(_evt, ws) {
      try {
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
            const { getSharedSandbox } = await import(
              "./sandbox/shared-sandbox.js"
            );
            const sandbox = await getSharedSandbox(
              token,
              process.env.VITE_SUPABASE_URL,
              process.env.VITE_SUPABASE_ANON_KEY
            );
            if (sandbox) {
              // Set the real user token so sonde CLI works inside sandbox
              await sandbox.setToken(token);
              session = createSandboxAgentSession({
                canUseTool: approvalBridge.canUseTool,
                sandbox,
              });
            } else {
              console.error(
                "[sandbox] getSharedSandbox returned null, using MCP"
              );
              session = createAgentSession(token, {
                canUseTool: approvalBridge.canUseTool,
              });
            }
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "Sandbox init failed";
            console.error("[sandbox] Init failed, using MCP:", msg);
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
      } finally {
        // Always resolve — even on error — so onMessage doesn't hang forever
        resolveReady!();
      }
    },

    async onMessage(evt, ws) {
      // Wait for onOpen to finish setting up the session
      console.log("[ws] onMessage: waiting for ready...");
      await readyPromise;
      console.log("[ws] onMessage: ready, session:", session ? "yes" : "null");
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
          console.log("[ws] Processing message:", msg.content?.slice(0, 50));
          // Lazy corpus pull (fast — sandbox already cached)
          if (isSandboxMode() && !corpusPulled) {
            try {
              const { getSharedSandbox } = await import(
                "./sandbox/shared-sandbox.js"
              );
              const sb = await getSharedSandbox(
                token!,
                process.env.VITE_SUPABASE_URL,
                process.env.VITE_SUPABASE_ANON_KEY
              );
              if (sb) {
                const mentionProgram = msg.mentions?.find(
                  (m) => m.program
                )?.program;
                const program =
                  mentionProgram ??
                  process.env.SONDE_SANDBOX_PROGRAM ??
                  "weather-intervention";
                const pullResult = await sb.pullCorpus(program);
                if (pullResult.exitCode === 0) {
                  console.log("[sandbox] Corpus ready for", program);
                } else {
                  console.error("[sandbox] Pull issues:", pullResult.stdout);
                }
              }
            } catch {
              // Non-critical — agent can still use sonde CLI
            }
            corpusPulled = true;
          }
          console.log("[ws] Calling handleUserMessage, sessionId:", msg.sessionId?.slice(0, 12));
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
    },

    onError(_evt) {
      approvalBridge?.dispose();
      approvalBridge = null;
      if (session) {
        session.close();
        session = null;
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
    // The Agent SDK's first query on a new session can hang indefinitely.
    // Race it against a timeout — if no events in 10s, abort and retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const resume = attempt === 0 ? clientSessionId : undefined;
      console.log("[ws] session.query() attempt", attempt + 1, "resume:", resume?.slice(0, 12) ?? "none");
      let gotEvents = false;
      let timedOut = false;

      // Timeout: abort the session if no events within 10s
      const timeoutId = setTimeout(() => {
        if (!gotEvents) {
          console.log("[ws] Timeout on attempt", attempt + 1, "— aborting");
          timedOut = true;
          session.abort();
        }
      }, 10_000);

      try {
      for await (const event of session.query(prompt, {
        resumeSessionId: resume,
      })) {
        gotEvents = true;
        clearTimeout(timeoutId);
      console.log("[ws] event:", event.type);
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
      } catch (queryErr) {
        clearTimeout(timeoutId);
        if (!timedOut) throw queryErr;
        // Timed out — will retry on next iteration
      }
      // If we got events, we're done. If not, retry.
      if (gotEvents) break;
      console.log("[ws] No events on attempt", attempt + 1, "— retrying");
    }
    send(ws, { type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent query failed";
    send(ws, { type: "error", message });
    send(ws, { type: "done" });
  }
}
