import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { createSondeMcpServer } from "./mcp/sonde-server.js";
import { getPendingTasks, clearPendingTasks } from "./mcp/tools/tasks.js";
import type { AgentEvent } from "./types.js";

const SYSTEM_PROMPT = `You are a Sonde research assistant for the Aeolus atmospheric science team. You help scientists inspect, log, and manage experiments, findings, directions, and questions using the Sonde tools.

You have access to the full Sonde CLI through structured tools. Each tool maps to a sonde CLI command and returns JSON data.

Approval and writes:
- Read-only Sonde tools (list, show, search, brief, tree, etc.) run immediately.
- **Mutating** Sonde tools (log, create, update, delete, attach, tag changes, focus, etc.) require the user to click **Approve** in the chat UI before they execute. If the user denies, do not retry the same mutation unless they ask you to.
- Before calling a mutating tool, briefly state what you will change (record IDs, create vs update vs delete) so the user can decide. For multi-step work, prefer \`sonde_propose_tasks\` so the UI shows a plan card; execution of those steps still goes through per-tool approval for mutating tools.
- Do not assume a mutating tool ran until after approval — the run is blocked until the user confirms.

Formatting (user-visible replies):
- Use Markdown: short ### headings, bullet lists, and GitHub-style tables when comparing records or fields.
- Link every record ID you mention using in-app paths so the UI can navigate: [EXP-0001](/experiments/EXP-0001), [FIND-0001](/findings/FIND-0001), [DIR-001](/directions/DIR-001), [Q-001](/questions). To point at notes on an experiment, use [EXP-0001 notes](/experiments/EXP-0001#notes).
- Summarize tool JSON in prose, tables, or short lists—do not dump raw JSON unless the user asks for it.

Guidelines:
- When the user mentions records by ID (EXP-*, FIND-*, DIR-*, Q-*), look them up with sonde_show.
- When the user asks for files, attachments, or artifacts for runs or experiments, prefer sonde_artifacts_list with the parent EXP-/FIND-/DIR- id for a compact metadata list, or sonde_experiment_show when they need full experiment context (findings, notes, activity). Summarize filenames and types; do not paste large raw JSON unless asked.
- When asked to plan work or queue up tasks, use sonde_propose_tasks to register a visible task list.
- Be concise and precise. Prefer tables and structured output over prose.
- After write operations, confirm what was done and suggest the logical next step.
- When summarizing research state, use sonde_brief for a holistic view.
- If the user asks about the experiment tree or branching, use sonde_tree.
- If the prompt includes embedded PRD context for "/defend-my-existence" (manifesto / existential defense), follow that block's tone and tool guidance; do not call Sonde tools unless the user asks for live records.`;

const MAX_TURNS = 20;
const MAX_BUDGET_USD = 1.0;

/** Claude API ID — see https://platform.claude.com/docs/en/about-claude/models/overview */
const DEFAULT_MODEL = "claude-sonnet-4-6";

function resolveAgentModel(): string {
  const fromEnv = process.env.AGENT_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MODEL;
}

export interface AgentSession {
  sessionId: string;
  query(
    prompt: string,
    options?: { resumeSessionId?: string }
  ): AsyncIterable<AgentEvent>;
  abort(): void;
  close(): void;
}

export interface CreateAgentSessionOptions {
  canUseTool: CanUseTool;
}

export function createAgentSession(
  sondeToken: string,
  sessionOptions: CreateAgentSessionOptions
): AgentSession {
  const firstSessionId: string = crypto.randomUUID();
  let sessionId: string = firstSessionId;
  let abortController = new AbortController();

  return {
    get sessionId() {
      return sessionId;
    },

    async *query(
      prompt: string,
      queryOptions?: { resumeSessionId?: string }
    ): AsyncIterable<AgentEvent> {
      abortController = new AbortController();
      clearPendingTasks();

      const clientResume = queryOptions?.resumeSessionId?.trim();
      const resume =
        clientResume && clientResume.length > 0 ? clientResume : undefined;

      const q = query({
        prompt,
        options: {
          abortController,
          model: resolveAgentModel(),
          systemPrompt: SYSTEM_PROMPT,
          resume,
          mcpServers: { sonde: createSondeMcpServer(sondeToken) },
          permissionMode: "default",
          canUseTool: sessionOptions.canUseTool,
          maxTurns: MAX_TURNS,
          maxBudgetUsd: MAX_BUDGET_USD,
          includePartialMessages: true,
        },
      });

      let assistantText = "";
      let assistantMessageId = "";

      for await (const rawMsg of q) {
        const msg = rawMsg as Record<string, unknown>;
        if (msg.type === "system" && msg.subtype === "init") {
          const nextId = (msg as { session_id?: string }).session_id;
          if (typeof nextId === "string" && nextId.length > 0) {
            sessionId = nextId;
            yield { type: "session", sessionId: nextId };
          }
          const model = (msg as { model?: string }).model;
          if (typeof model === "string" && model.length > 0) {
            yield { type: "model_info", model };
          }
          continue;
        }

        if (msg.type === "stream_event" && "event" in msg) {
          const event = msg.event as Record<string, unknown>;
          const eventType = event.type as string;

          if (eventType === "content_block_start") {
            const block = event.content_block as Record<string, unknown>;
            if (block?.type === "tool_use") {
              yield {
                type: "tool_use_start",
                id: block.id as string,
                tool: block.name as string,
                input: {},
              };
            }
          }

          if (eventType === "content_block_delta") {
            const delta = event.delta as Record<string, unknown>;
            if (delta?.type === "text_delta") {
              const text = delta.text as string;
              assistantText += text;
              yield { type: "text_delta", content: text };
            }
          }

          if (eventType === "content_block_stop") {
            // Check for pending tasks after any content block finishes
            const tasks = getPendingTasks();
            if (tasks.length > 0) {
              yield { type: "tasks", tasks: [...tasks] };
            }
          }

          continue;
        }

        if (msg.type === "assistant") {
          assistantMessageId = (msg as Record<string, unknown>).uuid as string ?? "";
          const message = (msg as Record<string, unknown>).message as Record<string, unknown>;
          const content = message?.content as Array<Record<string, unknown>> | undefined;

          if (content) {
            for (const block of content) {
              if (block.type === "tool_use") {
                yield {
                  type: "tool_use_end",
                  id: block.id as string,
                  output: "",
                };
              }
            }
          }

          if (assistantText) {
            yield {
              type: "text_done",
              content: assistantText,
              messageId: assistantMessageId,
            };
            assistantText = "";
          }
          continue;
        }

        if (msg.type === "result") {
          const result = msg as Record<string, unknown>;
          if (result.subtype !== "success") {
            const errors = (result.errors as string[]) ?? [];
            yield {
              type: "error",
              message: errors.join("; ") || `Agent stopped: ${result.subtype}`,
            };
          }
          break;
        }
      }

      // Emit any final text that wasn't flushed
      if (assistantText) {
        yield {
          type: "text_done",
          content: assistantText,
          messageId: assistantMessageId,
        };
      }

      // Final task check
      const finalTasks = getPendingTasks();
      if (finalTasks.length > 0) {
        yield { type: "tasks", tasks: [...finalTasks] };
      }
    },

    abort() {
      abortController.abort();
    },

    close() {
      abortController.abort();
    },
  };
}

