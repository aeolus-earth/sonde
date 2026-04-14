import type { VerifiedUser } from "../auth.js";
import type { MentionRef, PageContext } from "../types.js";
import { getServerGitHubToken } from "../github.js";
import { createSondeToolDefinitions } from "../mcp/registry.js";
import { runSonde } from "../sonde-runner.js";
import { resolveAgentModel, SYSTEM_PROMPT } from "../agent.js";
import { z } from "zod";
import {
  getAnthropicAdminApiKey,
  getAnthropicApiKey,
} from "./config.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
const AGENT_API_BETA = "agent-api-2026-03-01";

export interface ManagedSessionEvent {
  id?: string;
  type: string;
  name?: string;
  tool_name?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  content?: Array<Record<string, unknown>>;
  session_thread_id?: string | null;
  stop_reason?: Record<string, unknown> | null;
  error?: { type?: string; message?: string } | null;
  processed_at?: string | null;
  text?: string | null;
  thinking?: string | null;
}

interface ManagedEventListResponse {
  data?: ManagedSessionEvent[];
}

interface ManagedSessionCreateOptions {
  user: VerifiedUser;
  sondeToken: string;
  pageContext?: PageContext;
  mentions?: MentionRef[];
}

interface ManagedSessionResponse {
  id: string;
}

export interface ManagedSessionResource {
  id: string;
  title?: string | null;
  model?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  environment_id?: string | null;
  usage?: Record<string, unknown> | null;
  agent?: { id?: string | null } | string | null;
  workspace_id?: string | null;
}

export interface ManagedDeletedSession {
  id: string;
  type: string;
}

interface AnthropicCostBucketResult {
  amount?: string | number;
  amount_cents?: string | number;
  amount_usd?: string | number;
  workspace_id?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

interface AnthropicCostBucket {
  starting_at: string;
  ending_at: string;
  results?: AnthropicCostBucketResult[];
}

export interface AnthropicCostReportResponse {
  data?: AnthropicCostBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

let ephemeralAgentIdPromise: Promise<string> | null = null;
interface MockManagedSessionState {
  finalText: string;
  history: ManagedSessionEvent[];
  pendingToolName: string | null;
  pendingToolInput: Record<string, unknown>;
  pendingToolUseId: string | null;
  phase: "initial" | "awaiting_tool_result" | "final";
  toolResultText: string | null;
}

const mockManagedSessions = new Map<string, MockManagedSessionState>();

export function resetManagedClientStateForTests(): void {
  ephemeralAgentIdPromise = null;
  mockManagedSessions.clear();
}

function isMockManagedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SONDE_TEST_AGENT_MOCK === "1";
}

function summarizeMockPrompt(text: string): string {
  const summary = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return summary || "ok";
}

function parseMockToolInput(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const raw = env.SONDE_TEST_MANAGED_MOCK_TOOL_INPUT?.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}

  return {};
}

function extractMockToolResultText(event: Record<string, unknown>): string | null {
  const content = event.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((block) =>
      block && typeof block === "object" && typeof block.text === "string"
        ? block.text
        : ""
    )
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return text || null;
}

function getAnthropicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_API_BASE).replace(/\/+$/, "");
}

function managedHeaders(beta: string = MANAGED_AGENTS_BETA): Record<string, string> {
  return {
    "x-api-key": getAnthropicApiKey(),
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": beta,
    "content-type": "application/json",
  };
}

function adminHeaders(): Record<string, string> {
  return {
    "x-api-key": getAnthropicAdminApiKey(),
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
}

function parseRepoUrl(
  gitRepo: string
): { host: string; owner: string; repo: string } | null {
  const httpsMatch = gitRepo.match(
    /https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    return { host: httpsMatch[1]!, owner: httpsMatch[2]!, repo: httpsMatch[3]! };
  }

  const sshMatch = gitRepo.match(/(?:git@)?([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1]!, owner: sshMatch[2]!, repo: sshMatch[3]! };
  }

  const plainMatch = gitRepo.match(/^([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (plainMatch) {
    return { host: plainMatch[1]!, owner: plainMatch[2]!, repo: plainMatch[3]! };
  }

  return null;
}

async function fetchManagedJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${getAnthropicBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...managedHeaders(),
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Managed Agents request failed (${response.status}) for ${path}: ${bodyText.slice(0, 400)}`
    );
  }
  if (!bodyText.trim()) {
    return {} as T;
  }
  return JSON.parse(bodyText) as T;
}

async function fetchAnthropicAdminJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${getAnthropicBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...adminHeaders(),
      "user-agent": "sonde-managed-costs/1.0",
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Anthropic Admin API request failed (${response.status}) for ${path}: ${bodyText.slice(0, 400)}`
    );
  }
  if (!bodyText.trim()) {
    return {} as T;
  }
  return JSON.parse(bodyText) as T;
}

function managedCustomTools() {
  const allowedSchemaKeys = new Set([
    "type",
    "properties",
    "required",
    "description",
    "items",
    "enum",
    "anyOf",
    "oneOf",
    "allOf",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
  ]);

  const sanitizeSchema = (value: unknown, parentKey?: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeSchema(item, parentKey));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    if (parentKey === "properties") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, sanitizeSchema(entry)])
      );
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => allowedSchemaKeys.has(key))
        .map(([key, entry]) => [key, sanitizeSchema(entry, key)])
    );
  };

  const tools = createSondeToolDefinitions("__tool-schema-only__");
  return tools.map((tool) => ({
    type: "custom",
    name: tool.name,
    description: tool.description,
    input_schema: sanitizeSchema(z.object(tool.inputSchema).toJSONSchema()),
  }));
}

async function createEphemeralAgent(): Promise<string> {
  const response = await fetchManagedJson<{ id: string }>("/v1/agents?beta=true", {
    method: "POST",
    body: JSON.stringify({
      name: process.env.SONDE_MANAGED_AGENT_NAME?.trim() || "Sonde Managed Chat",
      model: resolveAgentModel(),
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "agent_toolset_20260401",
          default_config: { permission_policy: { type: "always_allow" } },
          configs: [{ name: "bash", permission_policy: { type: "always_ask" } }],
        },
        ...managedCustomTools(),
      ],
    }),
  });
  return response.id;
}

async function resolveManagedAgentId(): Promise<string> {
  const configured = process.env.SONDE_MANAGED_AGENT_ID?.trim();
  if (configured) return configured;
  if (process.env.SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT !== "1") {
    throw new Error(
      "Managed mode requires SONDE_MANAGED_AGENT_ID or SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT=1."
    );
  }
  if (!ephemeralAgentIdPromise) {
    ephemeralAgentIdPromise = createEphemeralAgent();
  }
  return ephemeralAgentIdPromise;
}

async function resolveRepoResource(
  sondeToken: string,
  pageContext?: PageContext,
  mentions?: MentionRef[]
): Promise<Record<string, unknown> | null> {
  const gitHubToken = getServerGitHubToken();
  if (!gitHubToken) return null;

  const candidates: string[] = [];
  if (pageContext?.type === "experiment") {
    candidates.push(pageContext.id);
  }
  for (const mention of mentions ?? []) {
    if (mention.type === "experiment") {
      candidates.push(mention.id);
    }
  }

  for (const id of candidates) {
    const result = await runSonde(["show", id, "--json"], sondeToken);
    const text = result.content[0]?.text ?? "";
    if (!text.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }

    const gitRepo =
      typeof parsed.git_repo === "string"
        ? parsed.git_repo
        : Array.isArray(parsed.code_context)
          ? (
              parsed.code_context.find(
                (entry) =>
                  entry &&
                  typeof entry === "object" &&
                  typeof (entry as { remote?: unknown }).remote === "string"
              ) as { remote?: string } | undefined
            )?.remote ?? null
          : null;
    if (!gitRepo) continue;
    const repo = parseRepoUrl(gitRepo);
    if (!repo || repo.host !== "github.com") continue;

    return {
      type: "github_repository",
      url: `https://github.com/${repo.owner}/${repo.repo}`,
      mount_path: "/workspace/repo",
      authorization_token: gitHubToken,
    };
  }

  const fallbackRepo = process.env.SONDE_MANAGED_DEFAULT_GITHUB_REPO_URL?.trim();
  if (!fallbackRepo) return null;
  return {
    type: "github_repository",
    url: fallbackRepo,
    mount_path: "/workspace/repo",
    authorization_token: gitHubToken,
  };
}

export async function createManagedSession(
  options: ManagedSessionCreateOptions
): Promise<string> {
  if (isMockManagedMode()) {
    const sessionId = `sesn_mock_${crypto.randomUUID()}`;
    const pendingToolName = process.env.SONDE_TEST_MANAGED_MOCK_TOOL?.trim() || null;
    mockManagedSessions.set(sessionId, {
      finalText: `Mock response: ${options.user.name ?? options.user.email ?? options.user.id}`,
      history: [],
      pendingToolName,
      pendingToolInput: parseMockToolInput(),
      pendingToolUseId: pendingToolName ? `tool-${crypto.randomUUID()}` : null,
      phase: pendingToolName ? "initial" : "final",
      toolResultText: null,
    });
    return sessionId;
  }

  const environmentId = process.env.SONDE_MANAGED_ENVIRONMENT_ID?.trim();
  if (!environmentId) {
    throw new Error("Managed mode requires SONDE_MANAGED_ENVIRONMENT_ID.");
  }

  const agentId = await resolveManagedAgentId();
  const repoResource = await resolveRepoResource(
    options.sondeToken,
    options.pageContext,
    options.mentions
  );

  const buildPayload = (includeRepoResource: boolean): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      agent: agentId,
      environment_id: environmentId,
      title: `Sonde chat · ${options.user.name ?? options.user.email ?? options.user.id}`,
    };
    if (includeRepoResource && repoResource) {
      payload.resources = [repoResource];
    }
    return payload;
  };

  try {
    const response = await fetchManagedJson<ManagedSessionResponse>("/v1/sessions?beta=true", {
      method: "POST",
      body: JSON.stringify(buildPayload(true)),
    });
    return response.id;
  } catch (error) {
    if (!repoResource) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error ?? "");
    console.warn(
      `[managed] createManagedSession retrying without repo resource: ${message.slice(0, 200)}`
    );
    const response = await fetchManagedJson<ManagedSessionResponse>("/v1/sessions?beta=true", {
      method: "POST",
      body: JSON.stringify(buildPayload(false)),
    });
    return response.id;
  }
}

export async function sendManagedEvents(
  sessionId: string,
  events: Record<string, unknown>[]
): Promise<void> {
  if (isMockManagedMode()) {
    const state = mockManagedSessions.get(sessionId);
    for (const event of events) {
      if (event.type === "user.message" && state) {
        const content = Array.isArray(event.content) ? event.content : [];
        const text = content
          .map((block) =>
            block && typeof block === "object" && typeof block.text === "string"
              ? block.text
              : ""
          )
          .join(" ")
          .trim();
        state.finalText = `Mock response: ${summarizeMockPrompt(text)}`;
      }

      if (
        state &&
        state.pendingToolName &&
        event.type === "user.custom_tool_result" &&
        event.custom_tool_use_id === state.pendingToolUseId
      ) {
        state.toolResultText = extractMockToolResultText(event);
        state.phase = "final";
      }
    }
    return;
  }
  await fetchManagedJson(`/v1/sessions/${sessionId}/events?beta=true`, {
    method: "POST",
    body: JSON.stringify({ events }),
  });
}

export async function interruptManagedSession(sessionId: string): Promise<void> {
  if (isMockManagedMode()) return;
  await sendManagedEvents(sessionId, [{ type: "user.interrupt" }]);
}

export async function getManagedSession(
  sessionId: string
): Promise<ManagedSessionResource> {
  if (isMockManagedMode()) {
    return {
      id: sessionId,
      model: resolveAgentModel(),
      environment_id: process.env.SONDE_MANAGED_ENVIRONMENT_ID?.trim() || null,
      usage: {
        input_tokens: 250,
        output_tokens: 120,
      },
    };
  }
  return fetchManagedJson<ManagedSessionResource>(`/v1/sessions/${sessionId}?beta=true`);
}

export async function archiveManagedSession(
  sessionId: string
): Promise<ManagedSessionResource> {
  if (isMockManagedMode()) {
    return {
      id: sessionId,
      archived_at: new Date().toISOString(),
      model: resolveAgentModel(),
      environment_id: process.env.SONDE_MANAGED_ENVIRONMENT_ID?.trim() || null,
    };
  }
  return fetchManagedJson<ManagedSessionResource>(`/v1/sessions/${sessionId}/archive?beta=true`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function deleteManagedSession(
  sessionId: string
): Promise<ManagedDeletedSession> {
  if (isMockManagedMode()) {
    return { id: sessionId, type: "session_deleted" };
  }
  return fetchManagedJson<ManagedDeletedSession>(`/v1/sessions/${sessionId}?beta=true`, {
    method: "DELETE",
  });
}

export async function listManagedSessionEvents(
  sessionId: string
): Promise<ManagedSessionEvent[]> {
  if (isMockManagedMode()) {
    if (!mockManagedSessions.has(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }
    return mockManagedSessions.get(sessionId)?.history ?? [];
  }
  const response = await fetchManagedJson<ManagedEventListResponse>(
    `/v1/sessions/${sessionId}/events`
  );
  return (response.data ?? []).map((event) => normalizeManagedSessionEvent(event));
}

export async function getAnthropicCostReport(options: {
  startingAt: string;
  endingAt: string;
  page?: string | null;
}): Promise<AnthropicCostReportResponse> {
  const query = new URLSearchParams({
    starting_at: options.startingAt,
    ending_at: options.endingAt,
  });
  query.append("group_by[]", "workspace_id");
  query.append("group_by[]", "description");
  query.set("bucket_width", "1d");
  if (options.page) {
    query.set("page", options.page);
  }
  return fetchAnthropicAdminJson<AnthropicCostReportResponse>(
    `/v1/organizations/cost_report?${query.toString()}`
  );
}

function parseSseData(buffer: string): { events: string[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events = chunks
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n")
    )
    .filter(Boolean);
  return { events, rest };
}

export function normalizeManagedSessionEvent(
  event: ManagedSessionEvent
): ManagedSessionEvent {
  const type = event.type;
  if (!type) return event;

  const normalizedType = (() => {
    switch (type) {
      case "agent":
        return "agent.message";
      case "user":
        return "user.message";
      case "thinking":
        return "agent.thinking";
      case "tool_use":
        return "agent.tool_use";
      case "custom_tool_use":
        return "agent.custom_tool_use";
      case "mcp_tool_use":
        return "agent.mcp_tool_use";
      case "thread_created":
        return "session.thread_created";
      case "thread_idle":
        return "session.thread_idle";
      case "thread_message_sent":
        return "agent.thread_message_sent";
      case "thread_message_received":
        return "agent.thread_message_received";
      case "status_running":
        return "session.status_running";
      case "status_idle":
        return "session.status_idle";
      case "model_request_start":
        return "span.model_request_start";
      case "model_request_end":
        return "span.model_request_end";
      case "error":
        return "session.error";
      default:
        return type;
    }
  })();

  const toolName =
    typeof event.tool_name === "string" && event.tool_name.length > 0
      ? event.tool_name
      : event.name;
  const toolUseId =
    typeof event.tool_use_id === "string" && event.tool_use_id.length > 0
      ? event.tool_use_id
      : event.id;

  const nextEvent: ManagedSessionEvent =
    normalizedType === type ? { ...event } : { ...event, type: normalizedType };
  if (toolName && !nextEvent.name) {
    nextEvent.name = toolName;
  }
  if (toolUseId && !nextEvent.id) {
    nextEvent.id = toolUseId;
  }
  if (nextEvent.type === "agent.tool_use" && toolName?.startsWith("sonde_")) {
    nextEvent.type = "agent.custom_tool_use";
  }
  return nextEvent;
}

export async function* streamManagedSessionEvents(
  sessionId: string,
  signal: AbortSignal
): AsyncIterable<ManagedSessionEvent> {
  if (isMockManagedMode()) {
    if (signal.aborted) return;
    const state = mockManagedSessions.get(sessionId);
    if (!state) {
      return;
    }

    if (state.pendingToolName && state.phase === "initial") {
      state.phase = "awaiting_tool_result";
      const toolEvent: ManagedSessionEvent = {
        id: state.pendingToolUseId ?? `tool-${sessionId}`,
        type: "agent.custom_tool_use",
        name: state.pendingToolName,
        input: state.pendingToolInput,
      };
      const idleEvent: ManagedSessionEvent = {
        id: `mock-idle-awaiting-${sessionId}`,
        type: "session.status_idle",
        stop_reason: {
          type: "requires_action",
          event_ids: [state.pendingToolUseId ?? `tool-${sessionId}`],
        },
      };
      state.history = [...state.history.filter((event) => event.id !== toolEvent.id), toolEvent];
      state.history = [...state.history.filter((event) => event.id !== idleEvent.id), idleEvent];
      yield toolEvent;
      yield idleEvent;
      return;
    }

    const finalText = state.toolResultText
      ? process.env.SONDE_TEST_MANAGED_MOCK_FINAL_TEXT?.trim() || state.toolResultText
      : state.finalText;
    const messageEvent: ManagedSessionEvent = {
      id: `mock-msg-${sessionId}`,
      type: "agent.message",
      content: [{ type: "text", text: finalText || "Mock response: ok" }],
    };
    const idleEvent: ManagedSessionEvent = {
      id: `mock-idle-final-${sessionId}`,
      type: "session.status_idle",
      stop_reason: { type: "end_turn" },
    };
    state.history = [...state.history.filter((event) => event.id !== messageEvent.id), messageEvent];
    state.history = [...state.history.filter((event) => event.id !== idleEvent.id), idleEvent];
    yield messageEvent;
    yield idleEvent;
    return;
  }
  const response = await fetch(`${getAnthropicBaseUrl()}/v1/sessions/${sessionId}/stream?beta=true`, {
    method: "GET",
    headers: {
      ...managedHeaders(AGENT_API_BETA),
      Accept: "text/event-stream",
    },
    signal,
  });
  if (!response.ok || !response.body) {
    const bodyText = await response.text();
    throw new Error(
      `Managed session stream failed (${response.status}): ${bodyText.slice(0, 400)}`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseData(buffer);
    buffer = parsed.rest;
    for (const item of parsed.events) {
      if (item === "[DONE]") return;
      try {
        yield normalizeManagedSessionEvent(JSON.parse(item) as ManagedSessionEvent);
      } catch {
        continue;
      }
    }
  }
}
