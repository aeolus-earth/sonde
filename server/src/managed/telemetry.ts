import type { VerifiedUser } from "../auth.js";
import { resolveAgentModel } from "../agent.js";
import { getRuntimeEnvironment } from "../runtime-metadata.js";
import { createTelemetrySupabaseClient, hasSupabaseTelemetryConfig } from "../supabase.js";
import {
  archiveManagedSession,
  deleteManagedSession,
  getManagedSession,
  type ManagedSessionResource,
} from "./client.js";
import {
  estimateManagedSessionCost,
  getManagedCostAlertSeverity,
  type ManagedCostAlertSeverity,
  type ManagedSessionCostEstimate,
} from "./pricing.js";

const PREWARM_ARCHIVE_TTL_MS = 2 * 60_000;
const IDLE_ARCHIVE_TTL_MS = 15 * 60_000;
const DELETE_ARCHIVE_TTL_MS = 7 * 24 * 60 * 60_000;

export interface ManagedCostAlert {
  severity: ManagedCostAlertSeverity;
  sessionId: string;
  estimatedTotalUsd: number;
  message: string;
}

interface ManagedTrackedSession {
  sessionId: string;
  userId: string;
  userEmail: string | null;
  accessToken: string | null;
  environment: string;
  source: "prewarm" | "chat" | "resume";
  model: string | null;
  anthropicEnvironmentId: string | null;
  anthropicAgentId: string | null;
  repoMounted: boolean;
  createdAtMs: number;
  firstTurnAtMs: number | null;
  lastActivityAtMs: number;
  lastIdleAtMs: number | null;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  archiveReason: string | null;
  deleteReason: string | null;
  status:
    | "prewarmed"
    | "active"
    | "idle"
    | "awaiting_approval"
    | "archived"
    | "deleted"
    | "error";
  runtimeMsAccumulated: number;
  runningSinceMs: number | null;
  turnCount: number;
  toolCallCount: number;
  approvalCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastRequestId: string | null;
  lastEstimate: ManagedSessionCostEstimate | null;
  lastAlertSeverity: ManagedCostAlertSeverity | null;
  archiveTimer: NodeJS.Timeout | null;
  deleteTimer: NodeJS.Timeout | null;
}

const trackedSessions = new Map<string, ManagedTrackedSession>();

function telemetryLog(event: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  console.warn(`[managed-telemetry] ${event}`, details);
}

function toIso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

function nowMs(): number {
  return Date.now();
}

function runtimeSecondsForState(state: ManagedTrackedSession): number {
  const runningMs =
    state.runningSinceMs == null ? 0 : Math.max(0, nowMs() - state.runningSinceMs);
  return (state.runtimeMsAccumulated + runningMs) / 1000;
}

function getSessionState(
  sessionId: string,
  seed?: Partial<ManagedTrackedSession> & {
    user?: VerifiedUser;
    accessToken?: string | null;
    source?: "prewarm" | "chat" | "resume";
  }
): ManagedTrackedSession {
  let state = trackedSessions.get(sessionId);
  if (!state) {
    const createdAtMs = nowMs();
    state = {
      sessionId,
      userId: seed?.user?.id ?? seed?.userId ?? "",
      userEmail: seed?.user?.email ?? seed?.userEmail ?? null,
      accessToken: seed?.accessToken ?? seed?.accessToken ?? null,
      environment: seed?.environment ?? getRuntimeEnvironment(),
      source: seed?.source ?? "chat",
      model: seed?.model ?? resolveAgentModel(),
      anthropicEnvironmentId:
        seed?.anthropicEnvironmentId ??
        process.env.SONDE_MANAGED_ENVIRONMENT_ID?.trim() ??
        null,
      anthropicAgentId:
        seed?.anthropicAgentId ??
        process.env.SONDE_MANAGED_AGENT_ID?.trim() ??
        null,
      repoMounted: seed?.repoMounted ?? false,
      createdAtMs,
      firstTurnAtMs: null,
      lastActivityAtMs: createdAtMs,
      lastIdleAtMs: null,
      archivedAtMs: null,
      deletedAtMs: null,
      archiveReason: null,
      deleteReason: null,
      status: seed?.status ?? (seed?.source === "prewarm" ? "prewarmed" : "active"),
      runtimeMsAccumulated: 0,
      runningSinceMs: null,
      turnCount: 0,
      toolCallCount: 0,
      approvalCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastRequestId: null,
      lastEstimate: null,
      lastAlertSeverity: null,
      archiveTimer: null,
      deleteTimer: null,
    };
    trackedSessions.set(sessionId, state);
  }

  if (seed?.user?.id) {
    state.userId = seed.user.id;
    state.userEmail = seed.user.email ?? state.userEmail;
  }
  if (seed?.accessToken?.trim()) {
    state.accessToken = seed.accessToken;
  }
  if (seed?.source) {
    state.source = seed.source;
  }
  if (seed?.model) {
    state.model = seed.model;
  }
  if (typeof seed?.repoMounted === "boolean") {
    state.repoMounted = seed.repoMounted;
  }
  if (seed?.environment) {
    state.environment = seed.environment;
  }
  if (seed?.anthropicEnvironmentId) {
    state.anthropicEnvironmentId = seed.anthropicEnvironmentId;
  }
  if (seed?.anthropicAgentId) {
    state.anthropicAgentId = seed.anthropicAgentId;
  }

  return state;
}

function clearTimer(timer: NodeJS.Timeout | null): void {
  if (timer) clearTimeout(timer);
}

function clearArchiveTimer(state: ManagedTrackedSession): void {
  clearTimer(state.archiveTimer);
  state.archiveTimer = null;
}

function clearDeleteTimer(state: ManagedTrackedSession): void {
  clearTimer(state.deleteTimer);
  state.deleteTimer = null;
}

function managedSessionRow(state: ManagedTrackedSession) {
  const estimate =
    state.lastEstimate ??
    estimateManagedSessionCost({
      model: state.model,
      runtimeSeconds: runtimeSecondsForState(state),
    });
  return {
    session_id: state.sessionId,
    user_id: state.userId,
    user_email: state.userEmail,
    environment: state.environment,
    source: state.source,
    provider: "anthropic",
    model: state.model,
    anthropic_environment_id: state.anthropicEnvironmentId,
    anthropic_agent_id: state.anthropicAgentId,
    repo_mounted: state.repoMounted,
    status: state.status,
    created_at: toIso(state.createdAtMs),
    updated_at: new Date().toISOString(),
    first_turn_at: toIso(state.firstTurnAtMs),
    last_activity_at: toIso(state.lastActivityAtMs),
    last_idle_at: toIso(state.lastIdleAtMs),
    archived_at: toIso(state.archivedAtMs),
    deleted_at: toIso(state.deletedAtMs),
    archive_reason: state.archiveReason,
    delete_reason: state.deleteReason,
    turn_count: state.turnCount,
    tool_call_count: state.toolCallCount,
    approval_count: state.approvalCount,
    last_error_code: state.lastErrorCode,
    last_error_message: state.lastErrorMessage,
    last_request_id: state.lastRequestId,
    input_tokens: estimate.inputTokens,
    output_tokens: estimate.outputTokens,
    cache_creation_tokens: estimate.cacheCreationTokens,
    cache_read_tokens: estimate.cacheReadTokens,
    runtime_seconds: estimate.runtimeSeconds,
    estimated_token_cost_usd: estimate.tokenCostUsd,
    estimated_runtime_cost_usd: estimate.runtimeCostUsd,
    estimated_total_cost_usd: estimate.totalCostUsd,
    pricing_version: estimate.pricingVersion,
    pricing_source: estimate.pricingSource,
    latest_usage: state.lastEstimate
      ? {
          input_tokens: state.lastEstimate.inputTokens,
          output_tokens: state.lastEstimate.outputTokens,
          cache_creation_input_tokens: state.lastEstimate.cacheCreationTokens,
          cache_read_input_tokens: state.lastEstimate.cacheReadTokens,
        }
      : {},
    metadata: {
      live_spend_enabled: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    },
  };
}

async function withTelemetryClient<T>(
  accessToken: string | null | undefined,
  fn: (client: ReturnType<typeof createTelemetrySupabaseClient>) => Promise<T>
): Promise<T | null> {
  if (!hasSupabaseTelemetryConfig()) {
    return null;
  }
  try {
    const client = createTelemetrySupabaseClient(accessToken ?? undefined);
    return await fn(client);
  } catch (error) {
    telemetryLog("supabase_write_failed", {
      error: error instanceof Error ? error.message : String(error ?? ""),
    });
    return null;
  }
}

async function persistManagedSession(state: ManagedTrackedSession): Promise<void> {
  await withTelemetryClient(state.accessToken, async (client) => {
    const { error } = await client
      .from("managed_sessions")
      .upsert(managedSessionRow(state), {
        onConflict: "session_id",
      });
    if (error) throw error;
  });
}

async function insertManagedSessionEvent(options: {
  state: ManagedTrackedSession;
  eventType: string;
  severity?: "info" | "warn" | "error";
  toolName?: string;
  toolUseId?: string;
  approvalId?: string;
  requestId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs?: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  await withTelemetryClient(options.state.accessToken, async (client) => {
    const { error } = await client.from("managed_session_events").insert({
      session_id: options.state.sessionId,
      user_id: options.state.userId,
      event_type: options.eventType,
      severity: options.severity ?? "info",
      tool_name: options.toolName ?? null,
      tool_use_id: options.toolUseId ?? null,
      approval_id: options.approvalId ?? null,
      request_id: options.requestId ?? options.state.lastRequestId,
      error_code: options.errorCode ?? null,
      error_message: options.errorMessage ?? null,
      duration_ms: options.durationMs ?? null,
      details: options.details ?? {},
    });
    if (error) throw error;
  });
}

async function insertCostSample(options: {
  state: ManagedTrackedSession;
  sampleType: "idle" | "archive" | "delete" | "reconcile" | "error";
  status: string;
  estimate: ManagedSessionCostEstimate;
}): Promise<void> {
  await withTelemetryClient(options.state.accessToken, async (client) => {
    const { error } = await client.from("managed_session_cost_samples").insert({
      session_id: options.state.sessionId,
      user_id: options.state.userId,
      sample_type: options.sampleType,
      status: options.status,
      input_tokens: options.estimate.inputTokens,
      output_tokens: options.estimate.outputTokens,
      cache_creation_tokens: options.estimate.cacheCreationTokens,
      cache_read_tokens: options.estimate.cacheReadTokens,
      runtime_seconds: options.estimate.runtimeSeconds,
      estimated_token_cost_usd: options.estimate.tokenCostUsd,
      estimated_runtime_cost_usd: options.estimate.runtimeCostUsd,
      estimated_total_cost_usd: options.estimate.totalCostUsd,
      pricing_version: options.estimate.pricingVersion,
      pricing_source: options.estimate.pricingSource,
      usage: {
        input_tokens: options.estimate.inputTokens,
        output_tokens: options.estimate.outputTokens,
        cache_creation_input_tokens: options.estimate.cacheCreationTokens,
        cache_read_input_tokens: options.estimate.cacheReadTokens,
      },
    });
    if (error) throw error;
  });
}

function getPrewarmArchiveDelayMs(): number {
  const parsed = Number(process.env.SONDE_MANAGED_PREWARM_ARCHIVE_TTL_MS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PREWARM_ARCHIVE_TTL_MS;
}

function getIdleArchiveDelayMs(): number {
  const parsed = Number(process.env.SONDE_MANAGED_IDLE_ARCHIVE_TTL_MS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : IDLE_ARCHIVE_TTL_MS;
}

function getDeleteDelayMs(): number {
  const parsed = Number(process.env.SONDE_MANAGED_DELETE_TTL_MS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DELETE_ARCHIVE_TTL_MS;
}

function buildManagedCostAlert(
  state: ManagedTrackedSession,
  estimate: ManagedSessionCostEstimate
): ManagedCostAlert | null {
  const severity = getManagedCostAlertSeverity(estimate.totalCostUsd);
  if (!severity || state.lastAlertSeverity === severity) {
    return null;
  }
  state.lastAlertSeverity = severity;
  const label = severity === "critical" ? "critical" : "warning";
  return {
    severity,
    sessionId: state.sessionId,
    estimatedTotalUsd: estimate.totalCostUsd,
    message: `Managed session spend ${label}: estimated $${estimate.totalCostUsd.toFixed(2)} for this chat session.`,
  };
}

function updateEstimateFromResource(
  state: ManagedTrackedSession,
  resource: ManagedSessionResource | null | undefined
): ManagedSessionCostEstimate {
  if (resource?.model) {
    state.model = resource.model;
  }
  const estimate = estimateManagedSessionCost({
    model: state.model,
    usage: resource?.usage,
    runtimeSeconds: runtimeSecondsForState(state),
  });
  state.lastEstimate = estimate;
  return estimate;
}

export async function registerManagedSessionTelemetry(options: {
  sessionId: string;
  user: VerifiedUser;
  accessToken: string;
  source: "prewarm" | "chat" | "resume";
  model?: string | null;
  repoMounted?: boolean;
}): Promise<void> {
  const state = getSessionState(options.sessionId, {
    user: options.user,
    accessToken: options.accessToken,
    source: options.source,
    model: options.model ?? resolveAgentModel(),
    repoMounted: options.repoMounted ?? false,
    status: options.source === "prewarm" ? "prewarmed" : "active",
  });
  state.lastActivityAtMs = nowMs();
  await persistManagedSession(state);
  await insertManagedSessionEvent({
    state,
    eventType: options.source === "prewarm" ? "session_created" : "session_attached",
    details: { source: options.source, repo_mounted: state.repoMounted },
  });
}

export async function noteManagedSessionTurnStarted(options: {
  sessionId: string;
  user: VerifiedUser;
  accessToken: string;
  source: "chat" | "resume";
}): Promise<void> {
  const state = getSessionState(options.sessionId, {
    user: options.user,
    accessToken: options.accessToken,
    source: options.source,
    status: "active",
  });
  clearArchiveTimer(state);
  clearDeleteTimer(state);
  const now = nowMs();
  state.lastActivityAtMs = now;
  state.status = "active";
  state.turnCount += 1;
  if (state.firstTurnAtMs == null) {
    state.firstTurnAtMs = now;
  }
  if (state.runningSinceMs == null) {
    state.runningSinceMs = now;
  }
  await persistManagedSession(state);
  await insertManagedSessionEvent({
    state,
    eventType: "turn_started",
    details: { source: options.source, turn_count: state.turnCount },
  });
}

export async function noteManagedToolUse(options: {
  sessionId: string;
  toolName: string;
  toolUseId?: string;
  approvalRequired?: boolean;
  approvalId?: string;
}): Promise<void> {
  const state = trackedSessions.get(options.sessionId);
  if (!state) return;
  state.toolCallCount += 1;
  if (options.approvalRequired) {
    state.approvalCount += 1;
    state.status = "awaiting_approval";
  }
  state.lastActivityAtMs = nowMs();
  await persistManagedSession(state);
  await insertManagedSessionEvent({
    state,
    eventType: options.approvalRequired ? "approval_requested" : "tool_started",
    toolName: options.toolName,
    toolUseId: options.toolUseId,
    approvalId: options.approvalId,
    details: { approval_required: Boolean(options.approvalRequired) },
  });
}

export async function noteManagedApprovalResolved(options: {
  sessionId: string;
  toolName: string;
  toolUseId?: string;
  approvalId?: string;
  approved: boolean;
}): Promise<void> {
  const state = trackedSessions.get(options.sessionId);
  if (!state) return;
  state.status = options.approved ? "active" : "idle";
  state.lastActivityAtMs = nowMs();
  await persistManagedSession(state);
  await insertManagedSessionEvent({
    state,
    eventType: "approval_resolved",
    severity: options.approved ? "info" : "warn",
    toolName: options.toolName,
    toolUseId: options.toolUseId,
    approvalId: options.approvalId,
    details: { approved: options.approved },
  });
}

export async function noteManagedSessionError(options: {
  sessionId: string;
  errorCode: string;
  message: string;
  requestId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const state = trackedSessions.get(options.sessionId);
  if (!state) return;
  state.status = "error";
  state.lastActivityAtMs = nowMs();
  state.lastErrorCode = options.errorCode;
  state.lastErrorMessage = options.message;
  state.lastRequestId = options.requestId ?? state.lastRequestId;
  if (state.runningSinceMs != null) {
    state.runtimeMsAccumulated += Math.max(0, nowMs() - state.runningSinceMs);
    state.runningSinceMs = null;
  }
  const resource = await getManagedSession(options.sessionId).catch(() => null);
  const estimate = updateEstimateFromResource(state, resource);
  await persistManagedSession(state);
  await insertCostSample({
    state,
    sampleType: "error",
    status: "error",
    estimate,
  });
  await insertManagedSessionEvent({
    state,
    eventType: "session_error",
    severity: "error",
    errorCode: options.errorCode,
    errorMessage: options.message,
    requestId: options.requestId ?? state.lastRequestId,
    details: {
      ...(options.details ?? {}),
      estimated_total_cost_usd: estimate.totalCostUsd,
      runtime_seconds: estimate.runtimeSeconds,
    },
  });
}

export async function syncManagedSessionUsage(options: {
  sessionId: string;
  sampleType: "idle" | "archive" | "delete" | "reconcile" | "error";
  status:
    | "idle"
    | "archived"
    | "deleted"
    | "awaiting_approval"
    | "active"
    | "error";
  resource?: ManagedSessionResource | null;
  recordEventType?: string;
  details?: Record<string, unknown>;
}): Promise<ManagedCostAlert | null> {
  const state = trackedSessions.get(options.sessionId);
  if (!state) return null;
  const now = nowMs();
  state.lastActivityAtMs = now;
  if (state.runningSinceMs != null) {
    state.runtimeMsAccumulated += Math.max(0, now - state.runningSinceMs);
    state.runningSinceMs = null;
  }
  if (options.status === "idle" || options.status === "awaiting_approval") {
    state.lastIdleAtMs = now;
  }
  state.status = options.status;
  const resource = options.resource ?? (await getManagedSession(options.sessionId));
  const estimate = updateEstimateFromResource(state, resource);
  await persistManagedSession(state);
  await insertCostSample({
    state,
    sampleType: options.sampleType,
    status: options.status,
    estimate,
  });
  if (options.recordEventType) {
    await insertManagedSessionEvent({
      state,
      eventType: options.recordEventType,
      details: {
        ...(options.details ?? {}),
        estimated_total_cost_usd: estimate.totalCostUsd,
        runtime_seconds: estimate.runtimeSeconds,
      },
    });
  }
  const alert = buildManagedCostAlert(state, estimate);
  if (alert) {
    await insertManagedSessionEvent({
      state,
      eventType: "cost_alert_emitted",
      severity: alert.severity === "critical" ? "error" : "warn",
      details: {
        estimated_total_cost_usd: estimate.totalCostUsd,
        runtime_seconds: estimate.runtimeSeconds,
        threshold: alert.severity,
      },
    });
  }
  if (options.status === "idle" || options.status === "awaiting_approval") {
    scheduleManagedSessionArchive(options.sessionId, {
      delayMs: getIdleArchiveDelayMs(),
      reason: options.status === "awaiting_approval" ? "approval_idle_timeout" : "idle_timeout",
    });
  } else if (options.status === "active") {
    clearArchiveTimer(state);
  }
  return alert;
}

async function archiveManagedSessionInternal(options: {
  sessionId: string;
  reason: string;
}): Promise<ManagedCostAlert | null> {
  const state = trackedSessions.get(options.sessionId);
  if (!state || state.status === "archived" || state.status === "deleted") {
    return null;
  }
  clearArchiveTimer(state);
  const resource = await archiveManagedSession(options.sessionId);
  state.archivedAtMs = nowMs();
  state.archiveReason = options.reason;
  const alert = await syncManagedSessionUsage({
    sessionId: options.sessionId,
    sampleType: "archive",
    status: "archived",
    resource,
    recordEventType: "session_archived",
    details: { reason: options.reason },
  });
  scheduleManagedSessionDelete(options.sessionId, {
    delayMs: getDeleteDelayMs(),
    reason: "archive_retention_elapsed",
  });
  return alert;
}

async function deleteManagedSessionInternal(options: {
  sessionId: string;
  reason: string;
}): Promise<void> {
  const state = trackedSessions.get(options.sessionId);
  if (!state || state.status === "deleted") {
    return;
  }
  clearDeleteTimer(state);
  await deleteManagedSession(options.sessionId);
  state.deletedAtMs = nowMs();
  state.status = "deleted";
  state.deleteReason = options.reason;
  await persistManagedSession(state);
  if (state.lastEstimate) {
    await insertCostSample({
      state,
      sampleType: "delete",
      status: "deleted",
      estimate: state.lastEstimate,
    });
  }
  await insertManagedSessionEvent({
    state,
    eventType: "session_deleted",
    details: { reason: options.reason },
  });
}

export function scheduleManagedSessionArchive(
  sessionId: string,
  options: { delayMs?: number; reason: string }
): void {
  const state = trackedSessions.get(sessionId);
  if (!state || state.status === "archived" || state.status === "deleted") {
    return;
  }
  clearArchiveTimer(state);
  state.archiveTimer = setTimeout(() => {
    void archiveManagedSessionInternal({
      sessionId,
      reason: options.reason,
    }).catch((error) => {
      telemetryLog("archive_failed", {
        sessionId,
        reason: options.reason,
        error: error instanceof Error ? error.message : String(error ?? ""),
      });
    });
  }, options.delayMs ?? getIdleArchiveDelayMs());
  state.archiveTimer.unref?.();
}

export function cancelManagedSessionArchive(sessionId: string): void {
  const state = trackedSessions.get(sessionId);
  if (!state) return;
  clearArchiveTimer(state);
}

export function scheduleManagedSessionDelete(
  sessionId: string,
  options: { delayMs?: number; reason: string }
): void {
  const state = trackedSessions.get(sessionId);
  if (!state || state.status === "deleted") {
    return;
  }
  clearDeleteTimer(state);
  state.deleteTimer = setTimeout(() => {
    void deleteManagedSessionInternal({
      sessionId,
      reason: options.reason,
    }).catch((error) => {
      telemetryLog("delete_failed", {
        sessionId,
        reason: options.reason,
        error: error instanceof Error ? error.message : String(error ?? ""),
      });
    });
  }, options.delayMs ?? getDeleteDelayMs());
  state.deleteTimer.unref?.();
}

export async function archiveManagedSessionNow(options: {
  sessionId: string;
  reason: string;
}): Promise<ManagedCostAlert | null> {
  return archiveManagedSessionInternal(options);
}

export function getManagedPrewarmArchiveDelayMs(): number {
  return getPrewarmArchiveDelayMs();
}

export function getManagedIdleArchiveDelayMs(): number {
  return getIdleArchiveDelayMs();
}

export async function noteManagedSessionSocketClosed(sessionId: string): Promise<void> {
  const state = trackedSessions.get(sessionId);
  if (!state || state.status === "deleted" || state.status === "archived") {
    return;
  }
  scheduleManagedSessionArchive(sessionId, {
    delayMs: getIdleArchiveDelayMs(),
    reason: "socket_closed",
  });
  await insertManagedSessionEvent({
    state,
    eventType: "socket_closed",
  });
}
