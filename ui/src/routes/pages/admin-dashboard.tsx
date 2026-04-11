import { useState, useMemo } from "react";
import {
  useAdminStats,
  useActiveUsers,
  useAgentTokens,
  useActivityUsageDetail,
  useDbSizes,
  useDbSnapshots,
  useCaptureDbSnapshot,
  useAuthEvents,
  useManagedSessions,
  useManagedSessionCostSamples,
  useManagedSessionEvents,
  useAnthropicCostSyncRuns,
  useAnthropicCostBuckets,
  useAdminRuntimeMetadata,
  useReconcileManagedCosts,
} from "@/hooks/use-admin";
import { useGlobalActivity } from "@/hooks/use-activity";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RecordLink } from "@/components/shared/record-link";
import { UsageChart } from "@/components/visualizations/usage-chart";
import {
  UsageByActorChart,
  USAGE_BY_ACTOR_TOP_N,
} from "@/components/visualizations/usage-by-actor-chart";
import { DbSizeChart } from "@/components/visualizations/db-size-chart";
import { formatBytes } from "@/lib/format";
import { DbGrowthChart } from "@/components/visualizations/db-growth-chart";
import { formatDateTimeShort, cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";

const cardClass =
  "rounded-[8px] border border-border bg-surface p-3";

const rowClass =
  "border-b border-border-subtle px-3 py-2 transition-colors last:border-0 hover:bg-surface-hover";

function StatCard({
  value,
  label,
  loading,
}: {
  value: number | string;
  label: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className={cardClass}>
        <Skeleton className="mb-1 h-6 w-12" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }
  return (
    <div className={cardClass}>
      <p className="text-[20px] font-semibold tracking-[-0.02em] text-text">
        {value}
      </p>
      <p className="text-[12px] text-text-tertiary">{label}</p>
    </div>
  );
}

function tokenStatus(token: {
  expires_at: string;
  revoked_at: string | null;
}): "complete" | "failed" | "open" {
  if (token.revoked_at) return "failed";
  if (new Date(token.expires_at) < new Date()) return "failed";
  return "complete";
}

function tokenStatusLabel(token: {
  expires_at: string;
  revoked_at: string | null;
}): string {
  if (token.revoked_at) return "revoked";
  if (new Date(token.expires_at) < new Date()) return "expired";
  return "active";
}

function usageRangeLabel(days: number): string {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return `${from.toLocaleDateString(undefined, opts)} – ${to.toLocaleDateString(undefined, opts)}`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: value < 10 ? 2 : 0,
  }).format(value);
}

function managedStatusVariant(
  status: string,
): "complete" | "failed" | "open" | "running" | "tag" {
  switch (status) {
    case "active":
      return "running";
    case "awaiting_approval":
      return "open";
    case "idle":
    case "prewarmed":
      return "tag";
    case "archived":
    case "deleted":
      return "complete";
    default:
      return "failed";
  }
}

export default function AdminDashboard() {
  const [usageDays, setUsageDays] = useState(30);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: activity } = useGlobalActivity(50);
  const { data: users } = useActiveUsers(7);
  const { data: tokens } = useAgentTokens();
  const { data: usageRows, isLoading: usageLoading } = useActivityUsageDetail(usageDays);
  const { data: dbSizes, isLoading: dbSizesLoading } = useDbSizes();
  const { data: dbSnapshots, isLoading: dbSnapshotsLoading } = useDbSnapshots(30);
  const { data: authEvents } = useAuthEvents(50);
  const { data: managedSessions, isLoading: managedSessionsLoading } = useManagedSessions(30);
  const { data: managedSyncRuns } = useAnthropicCostSyncRuns(10);
  const { data: anthropicCostBuckets } = useAnthropicCostBuckets(30);
  const { data: runtimeMetadata } = useAdminRuntimeMetadata();
  const reconcileManagedCosts = useReconcileManagedCosts();
  const { data: selectedSessionSamples } = useManagedSessionCostSamples(selectedSessionId);
  const { data: selectedSessionEvents } = useManagedSessionEvents(selectedSessionId);

  useCaptureDbSnapshot(); // fire-and-forget, rate-limited to 1/hour server-side

  const usageRowCount = useMemo(() => usageRows?.length ?? 0, [usageRows]);
  const selectedSession = useMemo(
    () => (managedSessions ?? []).find((session) => session.session_id === selectedSessionId) ?? null,
    [managedSessions, selectedSessionId]
  );
  const managedSummary = useMemo(() => {
    const sessions = managedSessions ?? [];
    const now = Date.now();
    const todayCutoff = now - 86400000;
    const weekCutoff = now - 7 * 86400000;
    const estimatedToday = sessions
      .filter((session) => new Date(session.created_at).getTime() >= todayCutoff)
      .reduce((sum, session) => sum + (session.estimated_total_cost_usd ?? 0), 0);
    const estimatedSevenDays = sessions
      .filter((session) => new Date(session.created_at).getTime() >= weekCutoff)
      .reduce((sum, session) => sum + (session.estimated_total_cost_usd ?? 0), 0);
    const providerSevenDays = (anthropicCostBuckets ?? [])
      .filter((bucket) => new Date(bucket.bucket_start).getTime() >= weekCutoff)
      .reduce((sum, bucket) => sum + (bucket.amount_usd ?? 0), 0);
    const activeSessions = sessions.filter(
      (session) =>
        session.status === "active" ||
        session.status === "idle" ||
        session.status === "awaiting_approval" ||
        session.status === "prewarmed"
    ).length;
    return {
      estimatedToday,
      estimatedSevenDays,
      providerSevenDays,
      activeSessions,
      unallocatedProviderCharges: Math.max(providerSevenDays - estimatedSevenDays, 0),
    };
  }, [anthropicCostBuckets, managedSessions]);
  const latestSyncRun = managedSyncRuns?.[0] ?? null;

  useRealtimeInvalidation("activity_log", ["admin"]);
  useRealtimeInvalidation("activity_log", ["activity", "global"]);
  useRealtimeInvalidation("managed_sessions", ["admin"]);
  useRealtimeInvalidation("managed_session_events", ["admin"]);
  useRealtimeInvalidation("managed_session_cost_samples", ["admin"]);
  useRealtimeInvalidation("anthropic_cost_sync_runs", ["admin"]);
  useRealtimeInvalidation("anthropic_cost_buckets", ["admin"]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6">
      <div className="flex items-center gap-2">
        <Link
          to="/"
          className="shrink-0 rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-[15px] font-semibold text-text">Admin</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          value={stats?.totalExperiments ?? 0}
          label="Total experiments"
          loading={statsLoading}
        />
        <StatCard
          value={stats?.activeUsers ?? 0}
          label="Active users (7d)"
          loading={statsLoading}
        />
        <StatCard
          value={stats?.activeTokens ?? 0}
          label="Active tokens"
          loading={statsLoading}
        />
        <StatCard
          value={stats?.actionsToday ?? 0}
          label="Actions today"
          loading={statsLoading}
        />
      </div>

      {/* Managed cost hygiene */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[13px] font-medium text-text-secondary">
              Managed session costs
            </h2>
            <p className="mt-0.5 text-[11px] text-text-quaternary">
              Session-first estimates with Anthropic provider reconciliation when available.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => reconcileManagedCosts.mutate({ days: 7 })}
              disabled={reconcileManagedCosts.isPending}
            >
              <RefreshCw
                size={14}
                className={cn(reconcileManagedCosts.isPending && "animate-spin")}
              />
              Reconcile provider costs
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            value={formatUsd(managedSummary.estimatedToday)}
            label="Estimated spend today"
            loading={managedSessionsLoading}
          />
          <StatCard
            value={formatUsd(managedSummary.estimatedSevenDays)}
            label="Estimated spend (7d)"
            loading={managedSessionsLoading}
          />
          <StatCard
            value={formatUsd(managedSummary.providerSevenDays)}
            label="Provider spend (7d)"
            loading={managedSessionsLoading}
          />
          <StatCard
            value={managedSummary.activeSessions}
            label="Active managed sessions"
            loading={managedSessionsLoading}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className={cardClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium text-text">Runtime diagnostics</p>
                <p className="mt-1 text-[11px] text-text-quaternary">
                  Live spend should only be enabled when managed sessions, telemetry, and cleanup are all wired.
                </p>
              </div>
              <Badge
                variant={runtimeMetadata?.liveSpendEnabled ? "running" : "tag"}
              >
                {runtimeMetadata?.liveSpendEnabled ? "live spend enabled" : "live spend disabled"}
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px]">
                <p className="text-text-tertiary">Anthropic runtime</p>
                <p className="mt-1 font-medium text-text">
                  {runtimeMetadata?.managedConfigured ? "Configured" : "Missing managed config"}
                </p>
              </div>
              <div className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px]">
                <p className="text-text-tertiary">Admin reconciliation</p>
                <p className="mt-1 font-medium text-text">
                  {runtimeMetadata?.anthropicAdminConfigured ? "Provider-backed" : "Estimated only"}
                </p>
              </div>
              <div className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px]">
                <p className="text-text-tertiary">Telemetry writes</p>
                <p className="mt-1 font-medium text-text">
                  {runtimeMetadata?.costTelemetryConfigured ? "Configured" : "Missing Supabase telemetry config"}
                </p>
              </div>
              <div className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px]">
                <p className="text-text-tertiary">Unallocated provider charges</p>
                <p className="mt-1 font-medium text-text">
                  {formatUsd(managedSummary.unallocatedProviderCharges)}
                </p>
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium text-text">Last reconciliation</p>
                <p className="mt-1 text-[11px] text-text-quaternary">
                  Sync provider buckets so session estimates have an external reference point.
                </p>
              </div>
              {latestSyncRun && (
                <Badge variant={latestSyncRun.success ? "complete" : "failed"}>
                  {latestSyncRun.mode === "provider" ? "provider" : "estimated-only"}
                </Badge>
              )}
            </div>
            {latestSyncRun ? (
              <div className="mt-3 space-y-2 text-[12px] text-text-secondary">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Completed</span>
                  <span>{formatDateTimeShort(latestSyncRun.completed_at ?? latestSyncRun.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Bucket count</span>
                  <span>{latestSyncRun.bucket_count}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Provider total</span>
                  <span>{formatUsd(latestSyncRun.total_cost_usd ?? 0)}</span>
                </div>
                {latestSyncRun.error_message && (
                  <p className="rounded-[8px] border border-status-failed/20 bg-status-failed/5 px-3 py-2 text-[11px] text-status-failed">
                    {latestSyncRun.error_message}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[12px] text-text-quaternary">
                No reconciliation runs yet.
              </p>
            )}
          </div>
        </div>

        <div className={cn(cardClass, "p-0 overflow-hidden")}>
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <div>
              <h3 className="text-[12px] font-medium text-text">Managed sessions</h3>
              <p className="mt-0.5 text-[11px] text-text-quaternary">
                Click a row to inspect lifecycle diagnostics, samples, and last errors.
              </p>
            </div>
          </div>
          {managedSessionsLoading ? (
            <div className="space-y-2 px-3 py-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (managedSessions ?? []).length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-text-quaternary">
              No managed session telemetry yet.
            </p>
          ) : (
            (managedSessions ?? []).map((session) => (
              <button
                key={session.session_id}
                type="button"
                onClick={() => setSelectedSessionId(session.session_id)}
                className={cn(
                  rowClass,
                  "grid w-full grid-cols-[140px_1.4fr_120px_90px_90px_110px] items-center gap-3 text-left text-[12px]",
                  selectedSessionId === session.session_id && "bg-surface-hover"
                )}
              >
                <span className="truncate text-text-quaternary">
                  {formatDateTimeShort(session.created_at)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">
                    {session.user_email ?? session.user_id}
                  </p>
                  <p className="truncate text-[11px] text-text-quaternary">
                    {session.session_id}
                  </p>
                </div>
                <Badge variant={managedStatusVariant(session.status)}>
                  {session.status}
                </Badge>
                <span className="text-text-tertiary">
                  {session.turn_count} turn{session.turn_count !== 1 && "s"}
                </span>
                <span className="text-text-tertiary">
                  {session.tool_call_count} tool{session.tool_call_count !== 1 && "s"}
                </span>
                <span className="font-medium text-text">
                  {formatUsd(session.estimated_total_cost_usd ?? 0)}
                </span>
              </button>
            ))
          )}
        </div>

        {selectedSession && (
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[12px] font-medium text-text">Session detail</h3>
                  <p className="mt-1 text-[11px] text-text-quaternary">
                    {selectedSession.session_id}
                  </p>
                </div>
                <Badge variant={managedStatusVariant(selectedSession.status)}>
                  {selectedSession.status}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 text-[12px] text-text-secondary">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">User</span>
                  <span>{selectedSession.user_email ?? selectedSession.user_id}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Environment</span>
                  <span>{selectedSession.environment}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Model</span>
                  <span>{selectedSession.model ?? "unknown"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Runtime</span>
                  <span>{selectedSession.runtime_seconds?.toFixed(1)}s</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Estimated token cost</span>
                  <span>{formatUsd(selectedSession.estimated_token_cost_usd ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-tertiary">Estimated total cost</span>
                  <span>{formatUsd(selectedSession.estimated_total_cost_usd ?? 0)}</span>
                </div>
              </div>
              {selectedSession.last_error_message && (
                <div className="mt-3 rounded-[8px] border border-status-failed/20 bg-status-failed/5 px-3 py-2 text-[11px] text-status-failed">
                  {selectedSession.last_error_message}
                </div>
              )}
            </div>

            <div className={cardClass}>
              <h3 className="text-[12px] font-medium text-text">Cost samples</h3>
              {(selectedSessionSamples ?? []).length === 0 ? (
                <p className="mt-3 text-[12px] text-text-quaternary">
                  No cost samples recorded for this session yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {(selectedSessionSamples ?? []).slice(0, 8).map((sample) => (
                    <div
                      key={sample.id}
                      className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="tag">{sample.sample_type}</Badge>
                        <span className="text-text-quaternary">
                          {formatDateTimeShort(sample.sampled_at)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-text-tertiary">{sample.status}</span>
                        <span className="font-medium text-text">
                          {formatUsd(sample.estimated_total_cost_usd ?? 0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {selectedSession && (
          <div className={cardClass}>
            <h3 className="text-[12px] font-medium text-text">Lifecycle timeline</h3>
            {(selectedSessionEvents ?? []).length === 0 ? (
              <p className="mt-3 text-[12px] text-text-quaternary">
                No metadata events recorded for this session yet.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {(selectedSessionEvents ?? []).slice(0, 12).map((event) => (
                  <div
                    key={event.id}
                    className="rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2 text-[12px]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            event.severity === "error"
                              ? "failed"
                              : event.severity === "warn"
                                ? "open"
                                : "tag"
                          }
                        >
                          {event.event_type}
                        </Badge>
                        {event.tool_name && (
                          <span className="text-text-tertiary">{event.tool_name}</span>
                        )}
                      </div>
                      <span className="text-text-quaternary">
                        {formatDateTimeShort(event.created_at)}
                      </span>
                    </div>
                    {event.error_message && (
                      <p className="mt-2 text-[11px] text-status-failed">
                        {event.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Usage charts */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[13px] font-medium text-text-secondary">Activity usage</h2>
            <p className="mt-0.5 text-[11px] text-text-quaternary">
              {usageRangeLabel(usageDays)}
              {usageRowCount > 0 && (
                <span className="text-text-quaternary/80">
                  {" "}
                  · {usageRowCount.toLocaleString()} event{usageRowCount !== 1 ? "s" : ""} loaded
                </span>
              )}
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-[min(100%,280px)]">
            <div className="flex items-center justify-between gap-2 text-[11px] text-text-tertiary">
              <span>Time range</span>
              <span className="font-medium tabular-nums text-text-secondary">
                Last {usageDays} days
              </span>
            </div>
            <input
              type="range"
              min={7}
              max={90}
              step={1}
              value={usageDays}
              onChange={(e) => setUsageDays(Number(e.target.value))}
              className={cn(
                "h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-raised",
                "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm",
                "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent"
              )}
              aria-label="Number of days of activity to show"
            />
            <div className="flex justify-between text-[10px] text-text-quaternary">
              <span>7d</span>
              <span>90d</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cn(cardClass, "pt-4 pr-1")}>
            <p className="mb-2 px-1 text-[11px] font-medium text-text-tertiary">All activity</p>
            {usageLoading ? (
              <Skeleton className="h-[180px] w-full" />
            ) : (
              <UsageChart entries={usageRows ?? []} days={usageDays} />
            )}
          </div>
          <div className={cn(cardClass, "pt-4 pr-1")}>
            <p className="mb-2 px-1 text-[11px] font-medium text-text-tertiary">
              By person (top {USAGE_BY_ACTOR_TOP_N}, rest as Other)
            </p>
            {usageLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : (
              <UsageByActorChart rows={usageRows ?? []} days={usageDays} />
            )}
          </div>
        </div>
      </section>

      {/* Database storage */}
      <section className="space-y-3">
        <h2 className="text-[13px] font-medium text-text-secondary">
          Database storage
        </h2>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            value={dbSizes ? formatBytes(dbSizes.total_db_bytes) : "—"}
            label="Total database"
            loading={dbSizesLoading}
          />
          <StatCard
            value={dbSizes ? formatBytes(dbSizes.storage_bytes) : "—"}
            label="Artifact files"
            loading={dbSizesLoading}
          />
          <StatCard
            value={
              dbSizes
                ? formatBytes(dbSizes.total_db_bytes + dbSizes.storage_bytes)
                : "—"
            }
            label="Combined"
            loading={dbSizesLoading}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Table sizes */}
          <div className={cn(cardClass, "pt-4 pr-1")}>
            <p className="mb-2 px-1 text-[11px] font-medium text-text-tertiary">
              Size by table
            </p>
            {dbSizesLoading ? (
              <Skeleton className="h-[180px] w-full" />
            ) : dbSizes ? (
              <DbSizeChart tableSizes={dbSizes.table_sizes} />
            ) : (
              <p className="py-8 text-center text-[12px] text-text-quaternary">
                Could not load table sizes.
              </p>
            )}
          </div>

          {/* Growth over time */}
          <div className={cn(cardClass, "pt-4 pr-1")}>
            <p className="mb-2 px-1 text-[11px] font-medium text-text-tertiary">
              Growth over time
            </p>
            {dbSnapshotsLoading ? (
              <Skeleton className="h-[180px] w-full" />
            ) : (dbSnapshots ?? []).length > 0 ? (
              <DbGrowthChart snapshots={dbSnapshots!} />
            ) : (
              <p className="py-8 text-center text-[12px] text-text-quaternary">
                No snapshots yet — growth data will appear after the first hour.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Activity feed */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-text-secondary">
          Recent activity
        </h2>
        <div className={cn(cardClass, "p-0 overflow-hidden")}>
          {(activity ?? []).length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-text-quaternary">
              No activity yet.
            </p>
          ) : (
            (activity ?? []).slice(0, 30).map((entry) => (
              <div key={entry.id} className={cn(rowClass, "flex items-center gap-3 text-[12px]")}>
                <span className="w-[120px] shrink-0 text-text-quaternary">
                  {formatDateTimeShort(entry.created_at)}
                </span>
                <span
                  className={cn(
                    "w-[140px] shrink-0 truncate",
                    entry.actor?.startsWith("agent/")
                      ? "text-accent"
                      : "text-text-secondary"
                  )}
                  title={entry.actor_email ?? entry.actor}
                >
                  {entry.actor_email
                    ? entry.actor_email.split("@")[0]
                    : entry.actor}
                </span>
                <Badge
                  variant={
                    entry.action === "created"
                      ? "open"
                      : entry.action === "status_changed"
                        ? "running"
                        : "tag"
                  }
                >
                  {entry.action}
                </Badge>
                <span className="w-[80px] shrink-0 text-text-quaternary">
                  {entry.record_type}
                </span>
                <RecordLink recordId={entry.record_id} />
              </div>
            ))
          )}
        </div>
      </section>

      {/* Active users */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-text-secondary">
          Active users (last 7 days)
        </h2>
        <div className={cn(cardClass, "p-0 overflow-hidden")}>
          {(users ?? []).length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-text-quaternary">
              No users active.
            </p>
          ) : (
            (users ?? []).map((user) => (
              <div
                key={user.actor}
                className={cn(rowClass, "flex items-center gap-3 text-[12px]")}
              >
                <span
                  className={cn(
                    "w-[200px] shrink-0 truncate font-medium",
                    user.actor.startsWith("agent/")
                      ? "text-accent"
                      : "text-text"
                  )}
                >
                  {user.actor_email ?? user.actor}
                </span>
                <span className="text-text-tertiary">
                  {user.action_count} action{user.action_count !== 1 && "s"}
                </span>
                <span className="ml-auto text-text-quaternary">
                  last seen {formatDateTimeShort(user.last_seen)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Auth events */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-text-secondary">
          Login history
        </h2>
        <div className={cn(cardClass, "p-0 overflow-hidden")}>
          {(authEvents ?? []).length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-text-quaternary">
              No login events recorded yet.
            </p>
          ) : (
            (authEvents ?? []).map((evt) => (
              <div
                key={evt.id}
                className={cn(rowClass, "flex items-center gap-3 text-[12px]")}
              >
                <span className="w-[120px] shrink-0 text-text-quaternary">
                  {formatDateTimeShort(evt.created_at)}
                </span>
                <Badge
                  variant={
                    evt.event_type === "login"
                      ? "open"
                      : evt.event_type === "logout"
                        ? "tag"
                        : "running"
                  }
                >
                  {evt.event_type}
                </Badge>
                <span
                  className={cn(
                    "w-[160px] shrink-0 truncate font-medium",
                    evt.actor.startsWith("agent/")
                      ? "text-accent"
                      : "text-text"
                  )}
                >
                  {evt.actor_email
                    ? evt.actor_email.split("@")[0]
                    : evt.actor}
                </span>
                {evt.client_version && (
                  <span className="text-text-quaternary">
                    v{evt.client_version}
                  </span>
                )}
                {evt.programs && evt.programs.length > 0 && (
                  <span className="ml-auto truncate text-text-quaternary">
                    {evt.programs.join(", ")}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Agent tokens */}
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-text-secondary">
          Agent tokens
        </h2>
        <div className={cn(cardClass, "p-0 overflow-hidden")}>
          {(tokens ?? []).length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-text-quaternary">
              No tokens created. Use{" "}
              <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">
                sonde admin create-token
              </code>{" "}
              to create one.
            </p>
          ) : (
            (tokens ?? []).map((token) => (
              <div
                key={token.id}
                className={cn(rowClass, "flex items-center gap-3 text-[12px]")}
              >
                <span className="w-[160px] shrink-0 truncate font-medium text-text">
                  {token.name}
                </span>
                <span className="w-[200px] shrink-0 truncate text-text-tertiary">
                  {token.programs.join(", ")}
                </span>
                <Badge variant={tokenStatus(token)}>
                  {tokenStatusLabel(token)}
                </Badge>
                <span className="ml-auto text-text-quaternary">
                  expires {formatDateTimeShort(token.expires_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
