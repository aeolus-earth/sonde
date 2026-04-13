import type { SupabaseClient } from "@supabase/supabase-js";
import { getManagedSessionCostThresholds } from "./managed/pricing.js";
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
  thresholds: {
    warnUsd: number;
    criticalUsd: number;
  };
  latestSuccessfulSync: AnthropicCostSyncRun | null;
  latestAttemptedSync: AnthropicCostSyncRun | null;
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

function pickLatestSuccessfulSync(
  runs: AnthropicCostSyncRun[],
  selectedWindowDays: number
): AnthropicCostSyncRun | null {
  const successful = runs.filter((run) => run.success && run.mode === "provider");
  const exactWindow = successful.find((run) => syncWindowDays(run) === selectedWindowDays);
  return exactWindow ?? successful[0] ?? null;
}

function sumSessionCostSince(rows: ManagedSessionRow[], cutoffMs: number): number {
  return roundUsd(
    rows
      .filter((row) => Date.parse(row.created_at) >= cutoffMs)
      .reduce((sum, row) => sum + (row.estimated_total_cost_usd ?? 0), 0)
  );
}

function activeSessionCount(rows: ManagedSessionRow[]): number {
  return rows.filter((row) =>
    row.status === "active" ||
    row.status === "idle" ||
    row.status === "awaiting_approval" ||
    row.status === "prewarmed"
  ).length;
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
  const latestSuccessfulSync = pickLatestSuccessfulSync(syncRuns, options.selectedWindowDays);

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

  return {
    environment: options.environment,
    selectedWindowDays: options.selectedWindowDays,
    estimatedTodayUsd,
    estimatedSevenDaysUsd,
    estimatedThirtyDaysUsd,
    estimatedSelectedWindowUsd,
    providerSelectedWindowUsd,
    activeSessions: activeSessionCount(sessions),
    sessionCount: sessions.length,
    unallocatedProviderChargesUsd: roundUsd(
      Math.max(providerSelectedWindowUsd - estimatedSelectedWindowUsd, 0)
    ),
    thresholds,
    latestSuccessfulSync,
    latestAttemptedSync,
  };
}

export async function fetchManagedSessions(options: {
  accessToken?: string | null;
  environment: string;
  days: number;
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

  let query = client
    .from("managed_sessions")
    .select("*", { count: "exact" })
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (matchesEnvironment(options.environment)) {
    query = query.eq("environment", options.environment);
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (userFilter) {
    if (userFilter.includes("@")) {
      query = query.ilike("user_email", `%${userFilter}%`);
    } else {
      const escaped = userFilter.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
      // 1. Backslashes must be escaped first (before other escapes add more backslashes)
      // 2. Commas separate OR conditions in PostgREST, so must be escaped
      // 3. % and _ are ILIKE wildcards, escape for literal matching
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
