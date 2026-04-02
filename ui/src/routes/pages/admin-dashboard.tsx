import { useAdminStats, useActiveUsers, useAgentTokens } from "@/hooks/use-admin";
import { useGlobalActivity } from "@/hooks/use-activity";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordLink } from "@/components/shared/record-link";
import { formatDateTimeShort, cn } from "@/lib/utils";

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

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: activity } = useGlobalActivity(50);
  const { data: users } = useActiveUsers(7);
  const { data: tokens } = useAgentTokens();

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6">
      <h1 className="text-[15px] font-semibold text-text">Admin</h1>

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
