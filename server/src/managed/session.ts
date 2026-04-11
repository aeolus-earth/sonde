import type { VerifiedUser } from "../auth.js";
import { classifyCommand } from "../command-approval-policy.js";
import {
  resolveAgentModel,
  type AgentSession,
} from "../agent.js";
import { isDestructiveTool, isReadTool } from "../mcp/tool-policy.js";
import { createSondeToolDefinitions } from "../mcp/registry.js";
import type {
  AgentEvent,
  MentionRef,
  PageContext,
  ToolApprovalKind,
} from "../types.js";
import {
  createManagedSession,
  interruptManagedSession,
  listManagedSessionEvents,
  sendManagedEvents,
  streamManagedSessionEvents,
  type ManagedSessionEvent,
} from "./client.js";
import {
  getManagedPendingApprovals,
  isManagedEventDelivered,
  rememberDeliveredManagedEvent,
  rememberManagedApproval,
  rememberManagedSession,
  resolveManagedApproval,
  takePrewarmedManagedSession,
} from "./session-cache.js";
import { clearPendingTasks } from "../mcp/tools/tasks.js";

interface ManagedHistorySyncResult {
  emitted: AgentEvent[];
  continueStreaming: boolean;
  blocked: boolean;
  settled: boolean;
}

interface ManagedApprovalBridge {
  requestApproval(options: {
    approvalId: string;
    toolUseID?: string;
    tool: string;
    input: Record<string, unknown>;
    destructive?: boolean;
    kind?: ToolApprovalKind;
  }): Promise<{ approved: boolean; reason?: string; disconnected?: boolean }>;
}

interface CreateManagedAgentSessionOptions {
  approvalBridge: ManagedApprovalBridge;
  user: VerifiedUser;
  sondeToken: string;
  pageContext?: PageContext;
  mentions?: MentionRef[];
  initialSessionId?: string;
}

type ManagedActionEvent = ManagedSessionEvent & {
  type: "agent.custom_tool_use" | "agent.tool_use" | "agent.mcp_tool_use";
};

function extractBlocks(event: ManagedSessionEvent): {
  text: string[];
  thinking: string[];
} {
  const text: string[] = [];
  const thinking: string[] = [];
  if (typeof event.text === "string" && event.text.length > 0) {
    text.push(event.text);
  }
  if (typeof event.thinking === "string" && event.thinking.length > 0) {
    thinking.push(event.thinking);
  }
  for (const block of event.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      text.push(block.text);
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      thinking.push(block.thinking);
    }
  }
  return { text, thinking };
}

function isManagedActionEvent(
  event: ManagedSessionEvent | undefined
): event is ManagedActionEvent {
  return Boolean(
    event &&
      (event.type === "agent.custom_tool_use" ||
        event.type === "agent.tool_use" ||
        event.type === "agent.mcp_tool_use")
  );
}

function responseThreadContext(
  event: ManagedSessionEvent
): Record<string, string> {
  return event.session_thread_id?.trim()
    ? { session_thread_id: event.session_thread_id.trim() }
    : {};
}

function emitManagedOutputEvent(
  sessionId: string,
  event: ManagedSessionEvent
): AgentEvent[] {
  const blocks = extractBlocks(event);
  const emitted: AgentEvent[] = [];
  for (const chunk of blocks.thinking) {
    emitted.push({ type: "thinking_delta", content: chunk });
  }
  const joined = blocks.text.join("");
  if (joined) {
    emitted.push({ type: "text_delta", content: joined });
    emitted.push({
      type: "text_done",
      content: joined,
      messageId: event.id ?? crypto.randomUUID(),
    });
  }
  rememberDeliveredManagedEvent(sessionId, event.id);
  return emitted;
}

function replayCachedManagedApprovals(sessionId: string): AgentEvent[] {
  return getManagedPendingApprovals(sessionId).map((approval) => ({
    type: "tool_approval_required",
    approvalId: approval.approvalId,
    toolUseID: approval.toolUseID,
    tool: approval.tool,
    input: approval.input,
    destructive: approval.destructive,
    kind: approval.kind,
  }));
}

function eventActionIds(event: ManagedSessionEvent): string[] {
  const stopReason = event.stop_reason ?? {};
  const nested = stopReason.requires_action;
  if (
    nested &&
    typeof nested === "object" &&
    Array.isArray((nested as { event_ids?: unknown[] }).event_ids)
  ) {
    return (nested as { event_ids: string[] }).event_ids;
  }
  if (Array.isArray((stopReason as { event_ids?: unknown[] }).event_ids)) {
    return (stopReason as { event_ids: string[] }).event_ids;
  }
  return [];
}

function managedToolApproval(
  tool: string,
  input: Record<string, unknown>
): {
  ask: boolean;
  destructive?: boolean;
  kind?: ToolApprovalKind;
} {
  if (tool === "bash") {
    const command = typeof input.command === "string" ? input.command : "";
    const classification = classifyCommand(command);
    if (classification === "read" || classification === "session") {
      return { ask: false };
    }
    const isSondeCommand =
      /^\s*(?:uv\s+run\s+)?sonde(?:\s|$)/.test(command);
    if (classification === "destructive") {
      return {
        ask: true,
        destructive: true,
        kind: isSondeCommand ? "sonde_write" : "destructive",
      };
    }
    return {
      ask: true,
      kind: isSondeCommand ? "sonde_write" : "external_write",
    };
  }

  return { ask: false };
}

async function handleCustomToolUse(
  sessionId: string,
  event: ManagedSessionEvent,
  sondeTools: Map<string, ReturnType<typeof createSondeToolDefinitions>[number]>,
  approvalBridge: ManagedApprovalBridge
): Promise<AgentEvent[]> {
  const id = event.id ?? crypto.randomUUID();
  const tool = event.name ?? "custom_tool";
  const input = event.input ?? {};
  const normalizedTool = tool;
  const threadContext = responseThreadContext(event);

  const emitted: AgentEvent[] = [
    { type: "tool_use_start", id, tool: normalizedTool, input },
  ];

  let approved = true;
  let denyReason: string | undefined;
  if (!isReadTool(normalizedTool)) {
    rememberManagedApproval(sessionId, {
      approvalId: id,
      toolUseID: id,
      tool: normalizedTool,
      input,
      destructive: isDestructiveTool(normalizedTool),
      kind: "sonde_write",
    });
    const decision = await approvalBridge.requestApproval({
      approvalId: id,
      toolUseID: id,
      tool: normalizedTool,
      input,
      destructive: isDestructiveTool(normalizedTool),
      kind: "sonde_write",
    });
    if (decision.disconnected) {
      return emitted;
    }
    resolveManagedApproval(sessionId, id);
    approved = decision.approved;
    denyReason = decision.reason;
    if (!approved) {
      await sendManagedEvents(sessionId, [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: id,
          ...threadContext,
          content: [
            {
              type: "text",
              text: `User denied tool execution.${denyReason ? ` ${denyReason}` : ""}`,
            },
          ],
        },
      ]);
      emitted.push({
        type: "tool_use_error",
        id,
        error: denyReason ?? "User denied tool execution.",
      });
      return emitted;
    }
  }

  const definition = sondeTools.get(normalizedTool);
  if (!definition) {
    emitted.push({
      type: "tool_use_error",
      id,
      error: `Unknown managed Sonde tool: ${normalizedTool}`,
    });
    return emitted;
  }

  const result = await definition.handler(input);
  const output = result.content.map((item) => item.text).join("\n");
  await sendManagedEvents(sessionId, [
    {
      type: "user.custom_tool_result",
      custom_tool_use_id: id,
      ...threadContext,
      content: result.content,
    },
  ]);
  emitted.push({ type: "tool_use_end", id, output });
  return emitted;
}

async function handleBuiltInToolApproval(
  sessionId: string,
  event: ManagedSessionEvent,
  approvalBridge: ManagedApprovalBridge
): Promise<AgentEvent[]> {
  const id = event.id ?? crypto.randomUUID();
  const tool = event.name ?? "tool";
  const input = event.input ?? {};
  const threadContext = responseThreadContext(event);

  const emitted: AgentEvent[] = [
    { type: "tool_use_start", id, tool, input },
  ];

  const approval = managedToolApproval(tool, input);
  if (approval.ask) {
    rememberManagedApproval(sessionId, {
      approvalId: id,
      toolUseID: id,
      tool,
      input,
      destructive: approval.destructive,
      kind: approval.kind,
    });
    const decision = await approvalBridge.requestApproval({
      approvalId: id,
      toolUseID: id,
      tool,
      input,
      destructive: approval.destructive,
      kind: approval.kind,
    });
    if (decision.disconnected) {
      return emitted;
    }
    resolveManagedApproval(sessionId, id);
    if (!decision.approved) {
      await sendManagedEvents(sessionId, [
        {
          type: "user.tool_confirmation",
          tool_use_id: id,
          ...threadContext,
          result: "deny",
          deny_message: decision.reason ?? "User denied tool execution.",
        },
      ]);
      emitted.push({
        type: "tool_use_error",
        id,
        error: decision.reason ?? "User denied tool execution.",
      });
      return emitted;
    }
  }

  await sendManagedEvents(sessionId, [
    {
      type: "user.tool_confirmation",
      tool_use_id: id,
      ...threadContext,
      result: "allow",
    },
  ]);
  emitted.push({ type: "tool_use_end", id, output: "Approved" });
  return emitted;
}

function isWaitingOnManagedResponsesError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Invalid user.message event") &&
    message.includes("waiting on responses to events")
  );
}

function isInvalidManagedSessionError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Invalid session ID");
}

async function reconcileManagedSessionHistory(options: {
  sessionId: string;
  sondeTools: Map<string, ReturnType<typeof createSondeToolDefinitions>[number]>;
  approvalBridge: ManagedApprovalBridge;
}): Promise<ManagedHistorySyncResult> {
  const cachedApprovals = replayCachedManagedApprovals(options.sessionId);
  if (cachedApprovals.length > 0) {
    return {
      emitted: cachedApprovals,
      continueStreaming: false,
      blocked: true,
      settled: false,
    };
  }

  const events = await listManagedSessionEvents(options.sessionId);
  const emitted: AgentEvent[] = [];

  for (const event of events) {
    if (
      (event.type === "agent.message" || event.type === "agent.thinking") &&
      !isManagedEventDelivered(options.sessionId, event.id)
    ) {
      emitted.push(...emitManagedOutputEvent(options.sessionId, event));
    }
  }

  const latestIdle = [...events]
    .reverse()
    .find((event) => event.type === "session.status_idle");
  if (!latestIdle) {
    return { emitted, continueStreaming: false, blocked: false, settled: false };
  }

  const latestStopReasonType =
    typeof latestIdle.stop_reason?.type === "string"
      ? latestIdle.stop_reason.type
      : null;
  if (latestStopReasonType !== "requires_action") {
    return { emitted, continueStreaming: false, blocked: false, settled: true };
  }

  const blockingIds = eventActionIds(latestIdle);
  const eventsById = new Map(
    events
      .filter((event): event is ManagedSessionEvent & { id: string } =>
        typeof event.id === "string" && event.id.length > 0
      )
      .map((event) => [event.id, event])
  );
  const blockingEvents: ManagedActionEvent[] = [];
  for (const id of blockingIds) {
    const event = eventsById.get(id);
    if (isManagedActionEvent(event)) {
      blockingEvents.push(event);
    }
  }

  if (blockingEvents.length === 0) {
    emitted.push({
      type: "error",
      message:
        "Managed session is waiting on earlier tool results, but the pending actions could not be reconstructed from event history.",
    });
    return { emitted, continueStreaming: false, blocked: true, settled: false };
  }

  let handledAny = false;
  for (const blockingEvent of blockingEvents) {
    const actionEmitted =
      blockingEvent.type === "agent.custom_tool_use"
        ? await handleCustomToolUse(
            options.sessionId,
            blockingEvent,
            options.sondeTools,
            options.approvalBridge
          )
        : await handleBuiltInToolApproval(
            options.sessionId,
            blockingEvent,
            options.approvalBridge
          );
    emitted.push(...actionEmitted);
    handledAny =
      handledAny ||
      !actionEmitted.some(
        (event) =>
          event.type === "tool_use_error" &&
          event.error.startsWith("Unknown managed Sonde tool:")
      );
  }

  if (!handledAny) {
    return { emitted, continueStreaming: false, blocked: true, settled: false };
  }

  return { emitted, continueStreaming: true, blocked: false, settled: false };
}

export function createManagedAgentSession(
  options: CreateManagedAgentSessionOptions
): AgentSession & { recover: (sessionId: string) => AsyncIterable<AgentEvent> } {
  let currentSessionId =
    options.initialSessionId ?? takePrewarmedManagedSession(options.user.id);
  let announcedSessionId = false;
  let abortController = new AbortController();
  const sondeTools = new Map(
    createSondeToolDefinitions(options.sondeToken).map((tool) => [tool.name, tool])
  );

  async function startFreshSession(): Promise<string> {
    currentSessionId = await createManagedSession({
      user: options.user,
      sondeToken: options.sondeToken,
      pageContext: options.pageContext,
      mentions: options.mentions,
    });
    rememberManagedSession(currentSessionId);
    announcedSessionId = false;
    return currentSessionId;
  }

  async function ensureSession(
    requestedSessionId?: string
  ): Promise<{ sessionId: string; created: boolean }> {
    if (requestedSessionId?.trim()) {
      currentSessionId = requestedSessionId.trim();
      rememberManagedSession(currentSessionId);
      announcedSessionId = false;
      return { sessionId: currentSessionId, created: false };
    }
    if (currentSessionId) {
      return { sessionId: currentSessionId, created: false };
    }
    return { sessionId: await startFreshSession(), created: true };
  }

  async function reconcileOrRefreshSession(
    sessionId: string
  ): Promise<{
    sessionId: string;
    recovery: ManagedHistorySyncResult;
    createdFresh: boolean;
  }> {
    try {
      return {
        sessionId,
        recovery: await reconcileManagedSessionHistory({
          sessionId,
          sondeTools,
          approvalBridge: options.approvalBridge,
        }),
        createdFresh: false,
      };
    } catch (error) {
      if (!isInvalidManagedSessionError(error)) {
        throw error;
      }
      return {
        sessionId: await startFreshSession(),
        recovery: {
          emitted: [],
          continueStreaming: false,
          blocked: false,
          settled: false,
        },
        createdFresh: true,
      };
    }
  }

  async function* drainManagedSession(
    sessionId: string
  ): AsyncGenerator<AgentEvent, boolean, void> {
    const seenThisRun = new Set<string>();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      let idleStopReasonType: string | null = null;
      let sawIdleEvent = false;
      let actionEvents: ManagedSessionEvent[] = [];
      let processedStreamActions = false;

      for await (const event of streamManagedSessionEvents(sessionId, abortController.signal)) {
        const eventId = event.id;
        if (eventId && seenThisRun.has(eventId)) {
          continue;
        }
        if (eventId) {
          seenThisRun.add(eventId);
          rememberDeliveredManagedEvent(sessionId, eventId);
        }

        if (event.type === "agent.message" || event.type === "agent.thinking") {
          for (const emitted of emitManagedOutputEvent(sessionId, event)) {
            yield emitted;
          }
          continue;
        }

        if (isManagedActionEvent(event)) {
          actionEvents.push(event);
          continue;
        }

        if (event.type === "session.error") {
          yield {
            type: "error",
            message: event.error?.message ?? "Managed session failed.",
          };
          return false;
        }

        if (event.type === "session.status_idle") {
          sawIdleEvent = true;
          idleStopReasonType =
            typeof event.stop_reason?.type === "string"
              ? (event.stop_reason.type as string)
              : null;
          if (idleStopReasonType === null) {
            break;
          }
          if (idleStopReasonType !== "requires_action") {
            return true;
          }

          const blockingIds = eventActionIds(event);
          const blockingEvents = actionEvents.filter(
            (candidate) => candidate.id && blockingIds.includes(candidate.id)
          );
          if (blockingEvents.length > 0) {
            for (const blockingEvent of blockingEvents) {
              const emitted =
                blockingEvent.type === "agent.custom_tool_use"
                  ? await handleCustomToolUse(
                      sessionId,
                      blockingEvent,
                      sondeTools,
                      options.approvalBridge
                    )
                  : await handleBuiltInToolApproval(
                      sessionId,
                      blockingEvent,
                      options.approvalBridge
                    );
              for (const eventToEmit of emitted) {
                yield eventToEmit;
              }
            }
            processedStreamActions = true;
          }
          break;
        }
      }

      if (processedStreamActions) {
        continue;
      }

      const recovery = await reconcileManagedSessionHistory({
        sessionId,
        sondeTools,
        approvalBridge: options.approvalBridge,
      });
      for (const event of recovery.emitted) {
        yield event;
      }
      if (recovery.blocked) {
        return false;
      }
      if (recovery.continueStreaming) {
        continue;
      }
      if (recovery.settled || (sawIdleEvent && idleStopReasonType !== "requires_action")) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    yield {
      type: "error",
      message: "Managed session recovery exceeded the maximum number of attempts.",
    };
    return false;
  }

  return {
    get sessionId() {
      return currentSessionId ?? crypto.randomUUID();
    },

    async *query(
      prompt: string,
      queryOptions?: { resumeSessionId?: string }
    ): AsyncIterable<AgentEvent> {
      abortController = new AbortController();
      clearPendingTasks();
      let { sessionId, created } = await ensureSession(queryOptions?.resumeSessionId);
      let recovery: ManagedHistorySyncResult | null = null;

      if (!created) {
        const reconciled = await reconcileOrRefreshSession(sessionId);
        sessionId = reconciled.sessionId;
        recovery = reconciled.recovery;
        if (reconciled.createdFresh) {
          created = true;
        }
      }

      if (created || queryOptions?.resumeSessionId || !announcedSessionId) {
        yield { type: "session", sessionId };
        announcedSessionId = true;
      }
      yield { type: "model_info", model: resolveAgentModel() };

      if (recovery) {
        for (const event of recovery.emitted) {
          yield event;
        }
        if (recovery.blocked) {
          return;
        }
        if (recovery.continueStreaming) {
          const settled = yield* drainManagedSession(sessionId);
          if (!settled) {
            return;
          }
        }
      }

      let sentPrompt = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await sendManagedEvents(sessionId, [
            {
              type: "user.message",
              content: [{ type: "text", text: prompt }],
            },
          ]);
          sentPrompt = true;
          break;
        } catch (error) {
          if (attempt === 1 && isWaitingOnManagedResponsesError(error)) {
            const recovery = await reconcileManagedSessionHistory({
              sessionId,
              sondeTools,
              approvalBridge: options.approvalBridge,
            });
            for (const event of recovery.emitted) {
              yield event;
            }
            if (recovery.blocked) {
              return;
            }
            if (recovery.continueStreaming) {
              const settled = yield* drainManagedSession(sessionId);
              if (!settled) {
                return;
              }
            }
            continue;
          }
          throw error;
        }
      }

      if (!sentPrompt) {
        yield {
          type: "error",
          message:
            "Managed session could not accept the new message because it is still waiting on earlier tool results.",
        };
        return;
      }

      const settled = yield* drainManagedSession(sessionId);
      if (!settled) {
        return;
      }
    },

    async *recover(sessionId: string): AsyncIterable<AgentEvent> {
      abortController = new AbortController();
      const reconciled = await reconcileOrRefreshSession(sessionId);
      currentSessionId = reconciled.sessionId;
      rememberManagedSession(currentSessionId);
      announcedSessionId = true;
      yield { type: "session", sessionId: currentSessionId };
      yield { type: "model_info", model: resolveAgentModel() };

      for (const event of reconciled.recovery.emitted) {
        yield event;
      }
      if (reconciled.recovery.blocked) {
        return;
      }
      if (reconciled.recovery.continueStreaming) {
        const settled = yield* drainManagedSession(currentSessionId);
        if (!settled) {
          return;
        }
      }
    },

    abort() {
      abortController.abort();
      if (currentSessionId) {
        void interruptManagedSession(currentSessionId).catch(() => {});
      }
    },

    close() {
      abortController.abort();
    },
  };
}
