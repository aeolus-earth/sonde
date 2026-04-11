import type { VerifiedUser } from "../auth.js";
import type { MentionRef, PageContext } from "../types.js";
import { getServerGitHubToken } from "../github.js";
import { createSondeToolDefinitions } from "../mcp/registry.js";
import { runSonde } from "../sonde-runner.js";
import { resolveAgentModel, SYSTEM_PROMPT } from "../agent.js";
import { z } from "zod";

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

let ephemeralAgentIdPromise: Promise<string> | null = null;
const mockManagedPrompts = new Map<string, string>();

function isMockManagedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SONDE_TEST_AGENT_MOCK === "1";
}

function getAnthropicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_API_BASE).replace(/\/+$/, "");
}

function getAnthropicApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Managed mode requires ANTHROPIC_API_KEY.");
  }
  return apiKey;
}

function managedHeaders(beta: string = MANAGED_AGENTS_BETA): Record<string, string> {
  return {
    "x-api-key": getAnthropicApiKey(),
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": beta,
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
    mockManagedPrompts.set(
      sessionId,
      `Mock response: ${options.user.name ?? options.user.email ?? options.user.id}`,
    );
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

  const payload: Record<string, unknown> = {
    agent: agentId,
    environment_id: environmentId,
    title: `Sonde chat · ${options.user.name ?? options.user.email ?? options.user.id}`,
  };
  if (repoResource) {
    payload.resources = [repoResource];
  }

  const response = await fetchManagedJson<ManagedSessionResponse>("/v1/sessions?beta=true", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.id;
}

export async function sendManagedEvents(
  sessionId: string,
  events: Record<string, unknown>[]
): Promise<void> {
  if (isMockManagedMode()) {
    for (const event of events) {
      if (event.type !== "user.message") continue;
      const content = Array.isArray(event.content) ? event.content : [];
      const text = content
        .map((block) =>
          block && typeof block === "object" && typeof block.text === "string"
            ? block.text
            : ""
        )
        .join(" ")
        .trim();
      const summary = text.replace(/\s+/g, " ").slice(0, 80);
      mockManagedPrompts.set(sessionId, `Mock response: ${summary || "ok"}`);
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

export async function listManagedSessionEvents(
  sessionId: string
): Promise<ManagedSessionEvent[]> {
  if (isMockManagedMode()) {
    return [];
  }
  const response = await fetchManagedJson<ManagedEventListResponse>(
    `/v1/sessions/${sessionId}/events`
  );
  return (response.data ?? []).map((event) => normalizeManagedSessionEvent(event));
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
    yield {
      id: `mock-msg-${sessionId}`,
      type: "agent.message",
      content: [{ type: "text", text: mockManagedPrompts.get(sessionId) ?? "Mock response: ok" }],
    };
    yield {
      id: `mock-idle-${sessionId}`,
      type: "session.status_idle",
      stop_reason: { type: "end_turn" },
    };
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
