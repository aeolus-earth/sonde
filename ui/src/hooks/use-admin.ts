import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useEffect } from "react";
import { getAgentHttpBase } from "@/lib/agent-http";
import { useAddToast } from "@/stores/toast";

export interface AdminStats {
  totalExperiments: number;
  activeUsers: number;
  activeTokens: number;
  actionsToday: number;
}

export interface ActiveUser {
  actor: string;
  actor_email: string | null;
  action_count: number;
  last_seen: string;
}

export interface AgentToken {
  id: string;
  name: string;
  programs: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async (): Promise<AdminStats> => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [experiments, activityToday, activeUsers, tokens] =
        await Promise.all([
          supabase
            .from("experiments")
            .select("*", { count: "exact", head: true }),
          supabase
            .from("activity_log")
            .select("*", { count: "exact", head: true })
            .gte("created_at", today.toISOString()),
          supabase
            .from("activity_log")
            .select("actor")
            .gte(
              "created_at",
              new Date(Date.now() - 7 * 86400000).toISOString()
            ),
          supabase
            .from("agent_tokens")
            .select("*", { count: "exact", head: true })
            .is("revoked_at", null)
            .gte("expires_at", new Date().toISOString()),
        ]);

      const distinctActors = new Set(
        (activeUsers.data ?? []).map((r) => r.actor)
      );

      return {
        totalExperiments: experiments.count ?? 0,
        activeUsers: distinctActors.size,
        activeTokens: tokens.count ?? 0,
        actionsToday: activityToday.count ?? 0,
      };
    },
    staleTime: 30_000,
  });
}

export function useActiveUsers(days = 7) {
  return useQuery({
    queryKey: ["admin", "active-users", days],
    queryFn: async (): Promise<ActiveUser[]> => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("activity_log")
        .select("actor, actor_email, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Aggregate in JS (Supabase REST doesn't support GROUP BY)
      const byActor = new Map<
        string,
        { actor_email: string | null; count: number; last_seen: string }
      >();
      for (const row of data ?? []) {
        const existing = byActor.get(row.actor);
        if (existing) {
          existing.count += 1;
        } else {
          byActor.set(row.actor, {
            actor_email: row.actor_email,
            count: 1,
            last_seen: row.created_at,
          });
        }
      }

      return Array.from(byActor.entries())
        .map(([actor, info]) => ({
          actor,
          actor_email: info.actor_email,
          action_count: info.count,
          last_seen: info.last_seen,
        }))
        .sort((a, b) => b.action_count - a.action_count);
    },
    staleTime: 60_000,
  });
}

/** Rows for usage charts — minimal columns, paginated for large ranges. */
export interface ActivityUsageRow {
  created_at: string;
  actor: string;
  actor_email: string | null;
}

const ACTIVITY_PAGE = 1000;

async function fetchActivityUsageRows(
  fromIso: string,
  toIso: string
): Promise<ActivityUsageRow[]> {
  const all: ActivityUsageRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("activity_log")
      .select("created_at, actor, actor_email")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(offset, offset + ACTIVITY_PAGE - 1);

    if (error) throw error;
    const batch = (data ?? []) as ActivityUsageRow[];
    all.push(...batch);
    if (batch.length < ACTIVITY_PAGE) break;
    offset += ACTIVITY_PAGE;
  }
  return all;
}

/**
 * Activity in `[now - days, now]` for charts. Paginates past PostgREST’s default row cap.
 */
export function useActivityUsageDetail(days: number) {
  return useQuery({
    queryKey: ["admin", "activity-usage-detail", days] as const,
    queryFn: async (): Promise<ActivityUsageRow[]> => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);
      return fetchActivityUsageRows(from.toISOString(), to.toISOString());
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData, // smooth transitions when slider changes days
  });
}

export function useAgentTokens() {
  return useQuery({
    queryKey: ["admin", "agent-tokens"],
    queryFn: async (): Promise<AgentToken[]> => {
      const { data, error } = await supabase
        .from("agent_tokens")
        .select("id, name, programs, expires_at, revoked_at, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

// --- Database size metrics ---

export interface DbSizes {
  total_db_bytes: number;
  table_sizes: Record<string, number>;
  storage_bytes: number;
  captured_at: string;
}

export interface DbSizeSnapshot {
  id: number;
  captured_at: string;
  total_db_bytes: number;
  table_sizes: Record<string, number>;
  storage_bytes: number | null;
}

/** Current database sizes via RPC. Slow-changing data — 5 min staleTime. */
export function useDbSizes() {
  return useQuery({
    queryKey: ["admin", "db-sizes"],
    queryFn: async (): Promise<DbSizes> => {
      const { data, error } = await supabase.rpc("get_db_sizes");
      if (error) throw error;
      return data as DbSizes;
    },
    staleTime: 5 * 60_000,
  });
}

/** Historical size snapshots for growth chart. */
export function useDbSnapshots(days = 30) {
  return useQuery({
    queryKey: ["admin", "db-snapshots", days],
    queryFn: async (): Promise<DbSizeSnapshot[]> => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("db_size_snapshots")
        .select("*")
        .gte("captured_at", since)
        .order("captured_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as DbSizeSnapshot[];
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Triggers a DB snapshot capture on mount (rate-limited to 1/hour server-side).
 * Fire-and-forget — we don't block on this.
 */
export function useCaptureDbSnapshot() {
  useEffect(() => {
    supabase.rpc("capture_db_snapshot").then(/* rate-limited, ignore result */);
  }, []);
}

// --- Auth events ---

export interface AuthEvent {
  id: number;
  event_type: "login" | "logout" | "token_auth";
  actor: string;
  actor_email: string | null;
  actor_name: string | null;
  user_id: string | null;
  programs: string[] | null;
  client_version: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export function useAuthEvents(limit = 50) {
  return useQuery({
    queryKey: ["admin", "auth-events", limit],
    queryFn: async (): Promise<AuthEvent[]> => {
      const { data, error } = await supabase
        .from("auth_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as AuthEvent[];
    },
    staleTime: 30_000,
  });
}

async function getAdminAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token?.trim() ?? "";
  if (!token) {
    throw new Error("You need to be signed in to access admin diagnostics.");
  }
  return token;
}

async function fetchAdminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await getAdminAccessToken();
  const response = await fetch(`${getAgentHttpBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Admin request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface ManagedSessionRow {
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

export interface ManagedSessionCostSample {
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

export interface ManagedSessionEventRow {
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

export interface AnthropicCostSyncRun {
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

export interface AnthropicCostBucket {
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

export interface AdminRuntimeMetadata {
  status: "ok";
  environment: string;
  agentBackend: "managed";
  managedConfigured: boolean;
  managedConfigError: string | null;
  anthropicConfigured: boolean;
  anthropicConfigError: string | null;
  anthropicAdminConfigured: boolean;
  anthropicAdminConfigError: string | null;
  costTelemetryConfigured: boolean;
  liveSpendEnabled: boolean;
  telemetryRequiresServiceRole: boolean;
  managedSessionWarnUsd: number;
  managedSessionCriticalUsd: number;
  commitSha: string | null;
  schemaVersion: string | null;
  cliGitRef: string | null;
  supabaseProjectRef: string | null;
  sharedRateLimitConfigured: boolean;
  sharedRateLimitRequired: boolean;
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

export function useManagedCostSummary({
  days = 7,
  environment = "all",
}: {
  days?: number;
  environment?: string;
}) {
  return useQuery({
    queryKey: ["admin", "managed-cost-summary", days, environment],
    queryFn: () =>
      fetchAdminJson<ManagedCostSummaryResponse>(
        `/admin/managed-costs/summary?days=${days}&environment=${encodeURIComponent(environment)}`
      ),
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useManagedSessionsQuery({
  days = 30,
  environment = "all",
  status = "",
  user = "",
  limit = 100,
  offset = 0,
}: {
  days?: number;
  environment?: string;
  status?: string;
  user?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["admin", "managed-sessions", days, environment, status, user, limit, offset],
    queryFn: () =>
      fetchAdminJson<ManagedSessionsListResponse>(
        `/admin/managed-sessions?days=${days}&environment=${encodeURIComponent(environment)}&status=${encodeURIComponent(status)}&user=${encodeURIComponent(user)}&limit=${limit}&offset=${offset}`
      ),
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useManagedSessionDetail(sessionId: string | null) {
  return useQuery({
    queryKey: ["admin", "managed-session-detail", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async (): Promise<ManagedSessionDetailResponse | null> => {
      if (!sessionId) {
        return null;
      }
      return fetchAdminJson<ManagedSessionDetailResponse>(
        `/admin/managed-sessions/${encodeURIComponent(sessionId)}`
      );
    },
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
}

export function useAdminRuntimeMetadata() {
  return useQuery({
    queryKey: ["admin", "runtime-metadata"],
    queryFn: () => fetchAdminJson<AdminRuntimeMetadata>("/admin/runtime"),
    staleTime: 15_000,
  });
}

export function useReconcileManagedCosts() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({ days = 7 }: { days?: number } = {}) =>
      fetchAdminJson<{
        mode: "provider" | "estimated_only";
        syncRunId: number | null;
        bucketCount: number;
        totalCostUsd: number;
      }>("/admin/managed-costs/reconcile", {
        method: "POST",
        body: JSON.stringify({ days }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "managed-cost-summary"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "managed-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "managed-session-detail"] });
      addToast({
        title:
          data.mode === "provider"
            ? "Anthropic costs reconciled"
            : "Reconciled in estimated-only mode",
        description:
          data.mode === "provider"
            ? `$${data.totalCostUsd.toFixed(2)} across ${data.bucketCount} provider buckets`
            : "ANTHROPIC_ADMIN_API_KEY is missing, so only internal session estimates are available.",
        variant: "success",
      });
    },
    onError: (error: Error) => {
      addToast({
        title: "Failed to reconcile managed costs",
        description: error.message,
        variant: "error",
      });
    },
  });
}
