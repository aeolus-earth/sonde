import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { createSondeMcpServer } from "./mcp/sonde-server.js";
import { createSandboxMcpServer } from "./sandbox/sandbox-mcp-server.js";
import { getPendingTasks, clearPendingTasks } from "./mcp/tools/tasks.js";
import type { AgentEvent } from "./types.js";
import type { SandboxHandle } from "./sandbox/daytona-client.js";

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
- After write operations, confirm what was done, share the UI link (e.g. [EXP-0183](/experiments/EXP-0183)), and suggest the logical next step.
- **After attaching artifacts, always describe each one.** Use sonde_artifact_update on each artifact ID to set its description — what it shows, how it was generated, and which code/script produced it. For single files, you can also pass description to sonde_experiment_attach directly. For directories with multiple files, call sonde_artifacts_list to get the IDs, then sonde_artifact_update per file. Artifacts without captions are useless to the next person.
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
      /** Per Claude API stream: `content_block_start` registers block `type` per `index`; `text_delta` is always user-visible text. */
      const blockKindByIndex = new Map<number, string>();
      /** Depth of open `tool_use` blocks — suppress `text_delta` while >0 (SDK streaming UI pattern). */
      let inToolBlockDepth = 0;

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
          const index = (event.index as number) ?? -1;

          if (eventType === "content_block_start") {
            const block = event.content_block as Record<string, unknown>;
            const bt = typeof block?.type === "string" ? block.type : undefined;
            if (index >= 0 && bt) blockKindByIndex.set(index, bt);
            if (bt === "tool_use") {
              inToolBlockDepth += 1;
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
            const dtype = delta?.type as string | undefined;
            if (dtype === "thinking_delta") {
              const th = (delta.thinking as string) ?? "";
              if (th.length > 0) {
                yield { type: "thinking_delta", content: th };
              }
              continue;
            }
            if (dtype === "text_delta") {
              const text = delta.text as string;
              if (inToolBlockDepth > 0) {
                continue;
              }
              assistantText += text;
              yield { type: "text_delta", content: text };
            }
          }

          if (eventType === "content_block_stop") {
            const stopIndex = (event.index as number) ?? -1;
            const kind = blockKindByIndex.get(stopIndex);
            if (kind === "tool_use") {
              inToolBlockDepth = Math.max(0, inToolBlockDepth - 1);
            }
            blockKindByIndex.delete(stopIndex);
            const tasks = getPendingTasks();
            if (tasks.length > 0) {
              yield { type: "tasks", tasks: [...tasks] };
            }
          }

          continue;
        }

        if (msg.type === "assistant") {
          blockKindByIndex.clear();
          inToolBlockDepth = 0;

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

// ---------------------------------------------------------------------------
// Sandbox agent session — tools execute inside a Daytona sandbox
// ---------------------------------------------------------------------------

const SANDBOX_SYSTEM_PROMPT = `You are a Sonde research assistant with full shell access to a Linux sandbox environment.
The sandbox has Python 3, the sonde CLI, and the program's .sonde/ research corpus.

You have 4 tools:
- sandbox_exec: Run any shell command (grep, find, cat, python3, pip, sonde CLI, etc.)
- sandbox_read: Read a file by path
- sandbox_write: Write a file (requires user approval)
- sandbox_glob: Find files by pattern

## Research corpus

The .sonde/ directory at /home/daytona/.sonde/ contains the research corpus from ALL programs, pulled automatically. Each program has its own tree.md and records:

\`\`\`
/home/daytona/.sonde/
├── tree.md                            ← master index — read this first
├── takeaways.md                       ← program-level summary
├── projects/PROJ-XXX/
│   ├── project.md
│   ├── takeaways.md
│   └── DIR-XXX/
│       ├── direction.md
│       └── EXP-XXXX.md               ← experiments nested under direction
├── directions/DIR-XXX/direction.md    ← directions without a project
├── experiments/EXP-XXXX.md            ← experiments without a project/direction
├── findings/FIND-XXXX.md
└── questions/Q-XXXX.md
\`\`\`

### File format

Each record has YAML frontmatter and a markdown body:

\`\`\`yaml
---
id: EXP-0042
program: weather-intervention
status: complete          # open | running | complete | failed | superseded
source: agent-run
tags: [cloud-seeding, CCN, subtropical]
title: "CCN sensitivity sweep"
hypothesis: "Doubling CCN..."
parameters: {ccn: 2000, domain: subtropical}
results: {precipitation_delta: -12.3}
finding: "Higher CCN suppressed warm rain..."
direction_id: DIR-003
project_id: PROJ-001
related: [EXP-0039, EXP-0041]
created_at: 2026-03-15T10:30:00
updated_at: 2026-03-31T14:22:15
---

# CCN sensitivity sweep

## Hypothesis
Doubling CCN concentration in subtropical marine stratocumulus...

## Method
...

## Results
...

## Finding
Higher CCN suppressed warm rain onset by...
\`\`\`

## Searching the corpus

**Always search .sonde/ files locally before using sonde CLI remote commands.** Local search is faster, doesn't hit the network, and gives you full text. Use sonde CLI only for mutations or data not yet pulled.

Follow this multi-step workflow:

1. **Orient** — start with the index:
   \`cat /home/daytona/.sonde/tree.md\`
   or enumerate files: \`sandbox_glob("EXP-*.md")\`

2. **Broad grep** — find files mentioning a keyword (files-only first to avoid flooding):
   \`grep -rl "keyword" /home/daytona/.sonde/ --include="*.md"\`

3. **Filter by frontmatter** — grep structured fields:
   \`grep -rl "^status: complete" /home/daytona/.sonde/ --include="*.md"\`
   \`grep -rl "^tags:.*cloud-seeding" /home/daytona/.sonde/ --include="*.md"\`

4. **Narrow with context** — see matches in context:
   \`grep -C 5 "keyword" /home/daytona/.sonde/projects/PROJ-001/DIR-003/EXP-0042.md\`

5. **Read full files** — use sandbox_read on the specific experiments you found.

6. **Combine patterns** — multi-keyword intersection:
   \`grep -rl "spectral" /home/daytona/.sonde/ --include="*.md" | xargs grep -l "subtropical"\`

7. **Python for complex queries** — when you need to parse frontmatter programmatically (e.g. filtering by numeric parameter values), write a short Python script using \`yaml\` (install with pip).

### When to use sonde CLI instead
- Mutations: \`sonde log\`, \`sonde update\`, \`sonde close\`, \`sonde tag\`, \`sonde attach\`
- Fresh data not yet pulled locally
- Remote-only operations: \`sonde brief\`, \`sonde search-all\`

For mutations, the user must approve.

## Code execution

You can write and run code in the sandbox. This is a full Linux environment with Python 3.
- Install packages: sandbox_exec({ command: "pip install pandas matplotlib seaborn" })
- Write scripts: sandbox_write({ path: "/home/daytona/analysis.py", content: "..." })
- Run scripts: sandbox_exec({ command: "python3 analysis.py" })
- Run inline: sandbox_exec({ command: "python3 -c 'print(2+2)'" })

When the user asks you to analyze data, make plots, or write code:
1. Install any needed packages first (pip install)
2. Write the script to a file (sandbox_write)
3. Execute it (sandbox_exec)
4. Read and report the output
5. If you generate a file (plot, CSV, etc.), attach it to the relevant experiment:
   sandbox_exec({ command: "sonde attach EXP-0001 /home/daytona/plot.png -d 'Description'" })

Common patterns:
- Parse experiment results from .sonde/ markdown files with Python
- Generate matplotlib/seaborn plots comparing experiment parameters
- Run pandas analysis across multiple experiments
- Create summary CSVs or tables

## Handling user questions

Users ask about research in natural, unstructured ways. They don't know program slugs or record IDs. Examples:
- "whats going on in HAPS" → program slug is \`haps-navigation\`
- "superdroplets progress" → program slug is \`superdroplets-development\`
- "any CCN results?" → grep across all experiments for "CCN"
- "what did we learn about spectral bin?" → search findings and experiments

**Your job is to map informal language to the right data.** Follow this pattern:

1. **Discover programs:** \`sonde program list --json\` — shows all program slugs with names
2. **Match intent:** Pick the closest program to what the user asked about
3. **Check corpus:** \`ls /home/daytona/.sonde/\` — if empty or program missing, pull it:
   \`sonde pull -p <program-slug> --artifacts none\`
4. **Search:** \`grep -ri "<keyword>" /home/daytona/.sonde/ --include="*.md"\`
5. **Summarize:** Read the relevant files and answer the user's question

**If the .sonde/ directory is empty or a program hasn't been pulled yet:**
Run \`sonde pull -p <program> --artifacts none\` to populate it. This is fast (text only).
Then grep the pulled files. The user should never see "corpus not found" — pull it yourself.

**For broad questions like "what's going on":**
1. Run \`sonde brief -p <program> --json\` for a summary
2. Check tree.md if it exists
3. List recent experiments and findings

## Formatting

- Use Markdown with ### headings, bullet lists, and tables.
- Link record IDs: [EXP-0001](/experiments/EXP-0001), [FIND-001](/findings/FIND-001).
- Summarize command output in prose — do not dump raw JSON unless asked.
- After write operations, confirm what changed and suggest the next step.
- When you create a plot or file, describe what it shows and where it was saved.
- **Keep thinking internal.** Don't narrate your search process to the user. Show the result, not the journey. If you searched 5 files, just report what you found — don't list each grep command unless asked.`;

export interface CreateSandboxAgentSessionOptions {
  canUseTool: CanUseTool;
  sandbox: SandboxHandle;
}

export function createSandboxAgentSession(
  sessionOptions: CreateSandboxAgentSessionOptions
): AgentSession {
  const firstSessionId: string = crypto.randomUUID();
  let sessionId: string = firstSessionId;
  let abortController = new AbortController();
  const { sandbox } = sessionOptions;

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
          systemPrompt: SANDBOX_SYSTEM_PROMPT,
          resume,
          mcpServers: { "sonde-sandbox": createSandboxMcpServer(sandbox) },
          permissionMode: "default",
          canUseTool: sessionOptions.canUseTool,
          maxTurns: MAX_TURNS,
          maxBudgetUsd: MAX_BUDGET_USD,
          includePartialMessages: true,
        },
      });

      let assistantText = "";
      let assistantMessageId = "";
      const blockKindByIndex = new Map<number, string>();
      let inToolBlockDepth = 0;

      // Track tool input JSON as it streams in (input_json_delta)
      const toolInputBuffers = new Map<number, string>();
      const toolIdByIndex = new Map<number, string>();
      const toolNameByIndex = new Map<number, string>();

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
          const index = (event.index as number) ?? -1;

          if (eventType === "content_block_start") {
            const block = event.content_block as Record<string, unknown>;
            const bt = typeof block?.type === "string" ? block.type : undefined;
            if (index >= 0 && bt) blockKindByIndex.set(index, bt);
            if (bt === "tool_use") {
              inToolBlockDepth += 1;
              const id = block.id as string;
              const name = block.name as string;
              toolIdByIndex.set(index, id);
              toolNameByIndex.set(index, name);
              toolInputBuffers.set(index, "");
              yield {
                type: "tool_use_start",
                id,
                tool: name,
                input: {},
              };
            }
          }

          if (eventType === "content_block_delta") {
            const delta = event.delta as Record<string, unknown>;
            const dtype = delta?.type as string | undefined;
            if (dtype === "thinking_delta") {
              const th = (delta.thinking as string) ?? "";
              if (th.length > 0) {
                yield { type: "thinking_delta", content: th };
              }
            } else if (dtype === "text_delta") {
              const text = delta.text as string;
              if (inToolBlockDepth > 0) {
                continue;
              }
              assistantText += text;
              yield { type: "text_delta", content: text };
            }
            // Accumulate tool input JSON
            if (delta?.type === "input_json_delta") {
              const partial = (delta.partial_json as string) ?? "";
              const prev = toolInputBuffers.get(index) ?? "";
              toolInputBuffers.set(index, prev + partial);
            }
          }

          if (eventType === "content_block_stop") {
            const stopIndex = (event.index as number) ?? -1;
            const kind = blockKindByIndex.get(stopIndex);
            if (kind === "tool_use") {
              inToolBlockDepth = Math.max(0, inToolBlockDepth - 1);
            }
            blockKindByIndex.delete(stopIndex);
            const tasks = getPendingTasks();
            if (tasks.length > 0) {
              yield { type: "tasks", tasks: [...tasks] };
            }
          }

          continue;
        }

        if (msg.type === "assistant") {
          blockKindByIndex.clear();
          inToolBlockDepth = 0;

          assistantMessageId =
            ((msg as Record<string, unknown>).uuid as string) ?? "";
          const message = (msg as Record<string, unknown>).message as Record<
            string,
            unknown
          >;
          const content = message?.content as
            | Array<Record<string, unknown>>
            | undefined;

          if (content) {
            for (const block of content) {
              if (block.type === "tool_use") {
                const blockInput = block.input as Record<string, unknown> | undefined;
                yield {
                  type: "tool_use_end",
                  id: block.id as string,
                  output: JSON.stringify(blockInput ?? {}, null, 2),
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

        // Capture tool results — the actual output from tool execution
        if (msg.type === "tool_result") {
          const toolUseId = (msg as { tool_use_id?: string }).tool_use_id;
          const resultContent = (msg as { content?: string }).content ?? "";
          if (toolUseId) {
            yield {
              type: "tool_use_end",
              id: toolUseId,
              output: resultContent,
            };
          }
          continue;
        }

        if (msg.type === "result") {
          const result = msg as Record<string, unknown>;
          if (result.subtype !== "success") {
            const errors = (result.errors as string[]) ?? [];
            yield {
              type: "error",
              message:
                errors.join("; ") || `Agent stopped: ${result.subtype}`,
            };
          }
          break;
        }
      }

      if (assistantText) {
        yield {
          type: "text_done",
          content: assistantText,
          messageId: assistantMessageId,
        };
      }

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
      // Sandbox disposal handled by ws-handler on close
    },
  };
}

/** Check if sandbox mode is enabled. */
export function isSandboxMode(): boolean {
  const backend = process.env.SONDE_AGENT_BACKEND?.trim().toLowerCase();
  if (backend === "sandbox") return true;
  if (backend === "auto") return !!process.env.DAYTONA_API_KEY;
  return false;
}

