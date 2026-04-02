import { useState, useMemo } from "react";
import {
  useAdminStats,
  useActiveUsers,
  useAgentTokens,
  useActivityUsageDetail,
  useDbSizes,
  useDbSnapshots,
  useCaptureDbSnapshot,
} from "@/hooks/use-admin";
import { useGlobalActivity } from "@/hooks/use-activity";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordLink } from "@/components/shared/record-link";
import { UsageChart } from "@/components/visualizations/usage-chart";
import {
  UsageByActorChart,
  USAGE_BY_ACTOR_TOP_N,
} from "@/components/visualizations/usage-by-actor-chart";
import { DbSizeChart, formatBytes } from "@/components/visualizations/db-size-chart";
import { DbGrowthChart } from "@/components/visualizations/db-growth-chart";
import { formatDateTimeShort, cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

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

export default function AdminDashboard() {
  const [usageDays, setUsageDays] = useState(30);

  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: activity } = useGlobalActivity(50);
  const { data: users } = useActiveUsers(7);
  const { data: tokens } = useAgentTokens();
  const { data: usageRows, isLoading: usageLoading } = useActivityUsageDetail(usageDays);
  const { data: dbSizes, isLoading: dbSizesLoading } = useDbSizes();
  const { data: dbSnapshots, isLoading: dbSnapshotsLoading } = useDbSnapshots(30);

  useCaptureDbSnapshot(); // fire-and-forget, rate-limited to 1/hour server-side

  const usageRowCount = useMemo(() => usageRows?.length ?? 0, [usageRows]);

  useRealtimeInvalidation("activity_log", ["admin"]);
  useRealtimeInvalidation("activity_log", ["activity", "global"]);

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
