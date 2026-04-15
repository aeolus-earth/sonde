import type { SupabaseClient } from "@supabase/supabase-js";
import { getManagedSessionCostThresholds } from "./managed/pricing.js";
import { getAnthropicAdminApiKeyStatus } from "./managed/config.js";
import { getInternalAdminTokenStatus } from "./security-config.js";
import { createTelemetrySupabaseClient } from "./supabase.js";

interface ManagedSessionRow {
  session_id: string;
  user_id: string;
  user_email: string | null;
  environment: string;
  source: "prewarm" | "chat" | "resume";
  provider: string;
  model: string | null;
  anthropic_environment_id?: string | null;
  anthropic_agent_id?: string | null;
  repo_mounted: boolean;
  status:
    | "prewarmed"
    | "active"
    | "idle"
    | "awaiting_approval"
    | "archived"
    | "deleted"
    | "error";
  created_at: string;
  updated_at: string;
  first_turn_at: string | null;
  last_activity_at: string | null;
  last_idle_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  archive_reason?: string | null;
  delete_reason?: string | null;
  turn_count: number;
  tool_call_count: number;
  approval_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  last_request_id?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  runtime_seconds: number;
  estimated_token_cost_usd: number;
  estimated_runtime_cost_usd: number;
  estimated_total_cost_usd: number;
  pricing_version?: string | null;
  pricing_source?: string | null;
}

interface ManagedSessionCostSample {
  id: number;
  session_id: string;
  sample_type: "idle" | "archive" | "delete" | "reconcile" | "error";
  status: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  runtime_seconds: number;
  estimated_token_cost_usd: number;
  estimated_runtime_cost_usd: number;
  estimated_total_cost_usd: number;
  pricing_version: string | null;
  pricing_source: string | null;
  sampled_at: string;
}

interface ManagedSessionEventRow {
  id: number;
  session_id: string;
  event_type: string;
  severity: "info" | "warn" | "error";
  tool_name: string | null;
  tool_use_id: string | null;
  approval_id: string | null;
  request_id: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

interface AnthropicCostSyncRun {
  id: number;
  requested_by: string | null;
  environment: string;
  mode: "provider" | "estimated_only";
  success: boolean;
  starting_at: string;
  ending_at: string;
  bucket_count: number;
  total_cost_usd: number;
  error_message: string | null;
  summary: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

interface AnthropicCostBucket {
  id: number;
  sync_run_id: number;
  bucket_start: string;
  bucket_end: string;
  workspace_id: string | null;
  description: string | null;
  amount_cents: number;
  amount_usd: number;
  bucket_width: string | null;
  synced_at: string;
}

export interface ManagedCostSummaryResponse {
  environment: string;
  selectedWindowDays: number;
  estimatedTodayUsd: number;
  estimatedSevenDaysUsd: number;
  estimatedThirtyDaysUsd: number;
  estimatedSelectedWindowUsd: number;
  providerSelectedWindowUsd: number;
  activeSessions: number;
  sessionCount: number;
  unallocatedProviderChargesUsd: number;
  providerStatus: ManagedProviderCostStatus;
  thresholds: {
    warnUsd: number;
    criticalUsd: number;
  };
  latestSuccessfulSync: AnthropicCostSyncRun | null;
  latestAttemptedSync: AnthropicCostSyncRun | null;
}

export type ManagedProviderCostReason =
  | "ok"
  | "missing_admin_api_key"
  | "missing_internal_admin_token"
  | "estimated_only"
  | "provider_sync_failed"
  | "provider_sync_stale"
  | "missing_selected_window_provider_sync"
  | "no_provider_sync";

export interface ManagedProviderCostStatus {
  mode: "provider" | "estimated_only" | "unavailable";
  configured: boolean;
  reconcileConfigured: boolean;
  reason: ManagedProviderCostReason;
  stale: boolean;
  latestSuccessfulAt: string | null;
  latestAttemptedAt: string | null;
}

export interface ManagedSessionsListResponse {
  items: ManagedSessionRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ManagedSessionDetailResponse {
  session: ManagedSessionRow;
  samples: ManagedSessionCostSample[];
  events: ManagedSessionEventRow[];
  operatorCommands: {
    retrieve: string;
    events: string;
    archive: string;
    resources: string;
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clampLimit(value: number | null | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

function clampOffset(value: number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function buildAdminTelemetryClient(accessToken?: string | null): SupabaseClient {
  return createTelemetrySupabaseClient(accessToken ?? undefined);
}

function matchesEnvironment(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && value !== "all";
}

function syncWindowDays(run: AnthropicCostSyncRun): number {
  const summaryDays = Number((run.summary ?? {}).window_days);
  if (Number.isFinite(summaryDays) && summaryDays > 0) {
    return summaryDays;
  }
  const start = Date.parse(run.starting_at);
  const end = Date.parse(run.ending_at);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.max(1, Math.round((end - start) / 86_400_000));
  }
  return 0;
}

const LIVE_SESSION_STATUSES = [
  "active",
  "idle",
  "awaiting_approval",
  "prewarmed",
] as const;

const PROVIDER_SYNC_STALE_AFTER_MS = 36 * 60 * 60_000;

function latestRunTimestamp(run: AnthropicCostSyncRun | null): string | null {
  if (!run) return null;
  return run.completed_at ?? run.created_at ?? null;
}

function pickLatestSuccessfulProviderSync(
  runs: AnthropicCostSyncRun[],
): AnthropicCostSyncRun | null {
  return runs.find((run) => run.success && run.mode === "provider") ?? null;
}

function pickLatestSuccessfulProviderSyncForWindow(
  runs: AnthropicCostSyncRun[],
  selectedWindowDays: number,
): AnthropicCostSyncRun | null {
  return (
    runs.find(
      (run) =>
        run.success &&
        run.mode === "provider" &&
        syncWindowDays(run) === selectedWindowDays,
    ) ?? null
  );
}

function buildManagedProviderCostStatus(options: {
  providerConfigured: boolean;
  reconcileConfigured: boolean;
  latestAttemptedSync: AnthropicCostSyncRun | null;
  latestSuccessfulSyncForWindow: AnthropicCostSyncRun | null;
  latestSuccessfulProviderSync: AnthropicCostSyncRun | null;
}): ManagedProviderCostStatus {
  const latestSuccessfulAt = latestRunTimestamp(options.latestSuccessfulProviderSync);
  const latestAttemptedAt = latestRunTimestamp(options.latestAttemptedSync);
  const latestSelectedWindowSync = options.latestSuccessfulSyncForWindow;

  if (latestSelectedWindowSync) {
    const lastSuccessfulMs = Date.parse(latestSuccessfulAt ?? "");
    const stale =
      Number.isFinite(lastSuccessfulMs) &&
      Date.now() - lastSuccessfulMs > PROVIDER_SYNC_STALE_AFTER_MS;
    return {
      mode: "provider",
      configured: options.providerConfigured,
      reconcileConfigured: options.reconcileConfigured,
      reason: stale ? "provider_sync_stale" : "ok",
      stale,
      latestSuccessfulAt,
      latestAttemptedAt,
    };
  }

  if (!options.providerConfigured) {
    return {
      mode: "unavailable",
      configured: false,
      reconcileConfigured: options.reconcileConfigured,
      reason: "missing_admin_api_key",
      stale: false,
      latestSuccessfulAt,
      latestAttemptedAt,
    };
  }

  if (
    options.latestAttemptedSync?.success &&
    options.latestAttemptedSync.mode === "estimated_only"
  ) {
    return {
      mode: "estimated_only",
      configured: true,
      reconcileConfigured: options.reconcileConfigured,
      reason: "estimated_only",
      stale: false,
      latestSuccessfulAt,
      latestAttemptedAt,
    };
  }

  if (
    options.latestAttemptedSync &&
    !options.latestAttemptedSync.success &&
    options.latestAttemptedSync.mode === "provider"
  ) {
    return {
      mode: "unavailable",
      configured: true,
      reconcileConfigured: options.reconcileConfigured,
      reason: "provider_sync_failed",
      stale: false,
      latestSuccessfulAt,
      latestAttemptedAt,
    };
  }

  if (options.latestSuccessfulProviderSync) {
    return {
      mode: "unavailable",
      configured: true,
      reconcileConfigured: options.reconcileConfigured,
      reason: "missing_selected_window_provider_sync",
      stale: false,
      latestSuccessfulAt,
      latestAttemptedAt,
    };
  }

  return {
    mode: "unavailable",
    configured: true,
    reconcileConfigured: options.reconcileConfigured,
    reason: options.reconcileConfigured
      ? "no_provider_sync"
      : "missing_internal_admin_token",
    stale: false,
    latestSuccessfulAt,
    latestAttemptedAt,
  };
}

function sumSessionCostSince(rows: ManagedSessionRow[], cutoffMs: number): number {
  return roundUsd(
    rows
      .filter((row) => Date.parse(row.created_at) >= cutoffMs)
      .reduce((sum, row) => sum + (row.estimated_total_cost_usd ?? 0), 0)
  );
}

export async function fetchManagedCostSummary(options: {
  accessToken?: string | null;
  environment: string;
  selectedWindowDays: number;
}): Promise<ManagedCostSummaryResponse> {
  const client = buildAdminTelemetryClient(options.accessToken);
  const maxWindowDays = Math.max(30, options.selectedWindowDays);
  const since = new Date(Date.now() - maxWindowDays * 86_400_000).toISOString();

  let sessionsQuery = client
    .from("managed_sessions")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (matchesEnvironment(options.environment)) {
    sessionsQuery = sessionsQuery.eq("environment", options.environment);
  }
  const { data: sessionsData, error: sessionsError } = await sessionsQuery;
  if (sessionsError) throw sessionsError;
  const sessions = (sessionsData ?? []) as ManagedSessionRow[];

  let activeSessionsQuery = client
    .from("managed_sessions")
    .select("session_id")
    .in("status", [...LIVE_SESSION_STATUSES]);
  if (matchesEnvironment(options.environment)) {
    activeSessionsQuery = activeSessionsQuery.eq("environment", options.environment);
  }
  const { data: activeSessionsData, error: activeSessionsError } = await activeSessionsQuery;
  if (activeSessionsError) throw activeSessionsError;
  const activeSessions = Array.isArray(activeSessionsData)
    ? activeSessionsData.length
    : 0;

  let syncRunsQuery = client
    .from("anthropic_cost_sync_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (matchesEnvironment(options.environment)) {
    syncRunsQuery = syncRunsQuery.eq("environment", options.environment);
  }
  const { data: runsData, error: runsError } = await syncRunsQuery;
  if (runsError) throw runsError;
  const syncRuns = (runsData ?? []) as AnthropicCostSyncRun[];
  const latestAttemptedSync = syncRuns[0] ?? null;
  const latestSuccessfulSync = pickLatestSuccessfulProviderSyncForWindow(
    syncRuns,
    options.selectedWindowDays,
  );
  const latestSuccessfulProviderSync = pickLatestSuccessfulProviderSync(syncRuns);

  let providerSelectedWindowUsd = 0;
  if (latestSuccessfulSync) {
    const { data: bucketsData, error: bucketsError } = await client
      .from("anthropic_cost_buckets")
      .select("*")
      .eq("sync_run_id", latestSuccessfulSync.id);
    if (bucketsError) throw bucketsError;
    providerSelectedWindowUsd = roundUsd(
      ((bucketsData ?? []) as AnthropicCostBucket[]).reduce(
        (sum, bucket) => sum + (bucket.amount_usd ?? 0),
        0
      )
    );
  }

  const now = Date.now();
  const estimatedTodayUsd = sumSessionCostSince(sessions, now - 86_400_000);
  const estimatedSevenDaysUsd = sumSessionCostSince(sessions, now - 7 * 86_400_000);
  const estimatedThirtyDaysUsd = sumSessionCostSince(sessions, now - 30 * 86_400_000);
  const estimatedSelectedWindowUsd = sumSessionCostSince(
    sessions,
    now - options.selectedWindowDays * 86_400_000
  );
  const thresholds = getManagedSessionCostThresholds();
  const providerStatus = buildManagedProviderCostStatus({
    providerConfigured: getAnthropicAdminApiKeyStatus().valid,
    reconcileConfigured: getInternalAdminTokenStatus().valid,
    latestAttemptedSync,
    latestSuccessfulSyncForWindow: latestSuccessfulSync,
    latestSuccessfulProviderSync,
  });

  return {
    environment: options.environment,
    selectedWindowDays: options.selectedWindowDays,
    estimatedTodayUsd,
    estimatedSevenDaysUsd,
    estimatedThirtyDaysUsd,
    estimatedSelectedWindowUsd,
    providerSelectedWindowUsd,
    activeSessions,
    sessionCount: sessions.length,
    unallocatedProviderChargesUsd: roundUsd(
      Math.max(providerSelectedWindowUsd - estimatedSelectedWindowUsd, 0)
    ),
    providerStatus,
    thresholds,
    latestSuccessfulSync,
    latestAttemptedSync,
  };
}

export async function fetchManagedSessions(options: {
  accessToken?: string | null;
  environment: string;
  days: number;
  scope?: "recent" | "live";
  status?: string;
  user?: string;
  limit?: number;
  offset?: number;
}): Promise<ManagedSessionsListResponse> {
  const client = buildAdminTelemetryClient(options.accessToken);
  const since = new Date(Date.now() - options.days * 86_400_000).toISOString();
  const limit = clampLimit(options.limit, 100, 500);
  const offset = clampOffset(options.offset);
  const userFilter = options.user?.trim() ?? "";
  const scope = options.scope === "live" ? "live" : "recent";

  let query = client
    .from("managed_sessions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (scope === "recent") {
    query = query.gte("created_at", since);
  }

  if (matchesEnvironment(options.environment)) {
    query = query.eq("environment", options.environment);
  }
  if (scope === "live") {
    if (options.status) {
      query = query.eq("status", options.status);
    } else {
      query = query.in("status", [...LIVE_SESSION_STATUSES]);
    }
  } else if (options.status) {
    query = query.eq("status", options.status);
  }
  if (userFilter) {
    if (userFilter.includes("@")) {
      query = query.ilike("user_email", `%${userFilter}%`);
    } else {
      // Escape PostgREST OR separators first, then ILIKE wildcard characters.
      const escaped = userFilter
        .replace(/\\/g, "\\\\")
        .replace(/,/g, "\\,")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      query = query.or(`user_email.ilike.%${escaped}%,user_id.ilike.%${escaped}%`);
    }
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    items: (data ?? []) as ManagedSessionRow[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function fetchManagedSessionDetail(options: {
  accessToken?: string | null;
  sessionId: string;
}): Promise<ManagedSessionDetailResponse | null> {
  const client = buildAdminTelemetryClient(options.accessToken);
  const { data: sessionData, error: sessionError } = await client
    .from("managed_sessions")
    .select("*")
    .eq("session_id", options.sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!sessionData) return null;

  const [{ data: samplesData, error: samplesError }, { data: eventsData, error: eventsError }] =
    await Promise.all([
      client
        .from("managed_session_cost_samples")
        .select("*")
        .eq("session_id", options.sessionId)
        .order("sampled_at", { ascending: false })
        .limit(50),
      client
        .from("managed_session_events")
        .select("*")
        .eq("session_id", options.sessionId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  if (samplesError) throw samplesError;
  if (eventsError) throw eventsError;

  return {
    session: sessionData as ManagedSessionRow,
    samples: (samplesData ?? []) as ManagedSessionCostSample[],
    events: (eventsData ?? []) as ManagedSessionEventRow[],
    operatorCommands: {
      retrieve: `ant beta:sessions retrieve ${options.sessionId}`,
      events: `ant beta:sessions:events list ${options.sessionId}`,
      archive: `ant beta:sessions archive ${options.sessionId}`,
      resources: `ant beta:sessions:resources list ${options.sessionId}`,
    },
  };
}
