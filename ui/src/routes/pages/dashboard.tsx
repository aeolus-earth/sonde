import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { useExperiments } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useGlobalActivity } from "@/hooks/use-activity";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Badge } from "@/components/ui/badge";
import { StatBlockSkeleton, Skeleton } from "@/components/ui/skeleton";
import { RecordLink } from "@/components/shared/record-link";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import { sortFindingsByImportanceAndRecency } from "@/lib/finding-importance";
import { formatDateTimeShort, formatDateTime, cn } from "@/lib/utils";
import type { ExperimentsSearch } from "@/routes/pages/experiments-list";

const dashboardRowClass =
  "border-b border-border-subtle px-3 py-2 transition-colors last:border-0 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

const StatusChart = lazy(() =>
  import("@/components/visualizations/status-chart").then((m) => ({
    default: m.StatusChart,
  }))
);
const ActivityTimeline = lazy(() =>
  import("@/components/visualizations/activity-timeline").then((m) => ({
    default: m.ActivityTimeline,
  }))
);

function ChartFallback() {
  return <Skeleton className="h-[160px] w-full rounded-[5.5px]" />;
}

function StatBlock({
  value,
  label,
  color,
  search,
}: {
  value: number;
  label: string;
  color?: string;
  search:
    | ExperimentsSearch
    | ((prev: ExperimentsSearch) => ExperimentsSearch);
}) {
  return (
    <Link
      to="/experiments"
      search={search}
      className="group block rounded-[8px] border border-border bg-surface p-3 transition-colors hover:border-border hover:bg-surface-hover/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent active:opacity-95"
    >
      <p
        className={cn(
          "text-[20px] font-semibold tracking-[-0.02em] transition-colors group-hover:text-text",
          color ?? "text-text"
        )}
      >
        {value}
      </p>
      <p className="text-[12px] text-text-tertiary">{label}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { data: experiments, isLoading: loadingExp } = useExperiments();
  const { data: directions, isLoading: loadingDir } = useDirections();
  const { data: findings, isLoading: loadingFind } = useCurrentFindings();
  const { data: activity } = useGlobalActivity(20);

  useRealtimeInvalidation("experiments", ["experiments"]);

  if (loadingExp || loadingDir || loadingFind) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-28" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatBlockSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-2.5 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[8px] border border-border bg-surface p-3"
            >
              <Skeleton className="h-[160px] w-full rounded-[5.5px]" />
            </div>
          ))}
        </div>
        <div className="grid gap-2.5 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[8px] border border-border bg-surface"
            >
              <div className="border-b border-border px-3 py-2">
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="space-y-0">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div
                    key={j}
                    className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5 last:border-0"
                  >
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3.5 w-12" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const exps = experiments ?? [];
  const dirs = directions ?? [];
  const finds = sortFindingsByImportanceAndRecency(findings ?? []);

  const running = exps.filter((e) => e.status === "running").length;
  const complete = exps.filter((e) => e.status === "complete").length;
  const failed = exps.filter((e) => e.status === "failed").length;

  return (
    <div className="space-y-5">
      <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
        Dashboard
      </h1>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatBlock
          value={exps.length}
          label="Experiments"
          search={(prev: ExperimentsSearch) => ({
            ...prev,
            status: undefined,
          })}
        />
        <StatBlock
          value={running}
          label="Running"
          color="text-status-running"
          search={(prev: ExperimentsSearch) => ({
            ...prev,
            status: "running",
          })}
        />
        <StatBlock
          value={complete}
          label="Complete"
          color="text-status-complete"
          search={(prev: ExperimentsSearch) => ({
            ...prev,
            status: "complete",
          })}
        />
        <StatBlock
          value={failed}
          label="Failed"
          color="text-status-failed"
          search={(prev: ExperimentsSearch) => ({
            ...prev,
            status: "failed",
          })}
        />
      </div>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <div className="rounded-[8px] border border-border bg-surface p-3">
          <p className="mb-2 text-[13px] font-medium text-text-secondary">
            Status
          </p>
          <Suspense fallback={<ChartFallback />}>
            <StatusChart experiments={exps} />
          </Suspense>
        </div>
        <div className="rounded-[8px] border border-border bg-surface p-3">
          <p className="mb-2 text-[13px] font-medium text-text-secondary">
            Activity
          </p>
          <Suspense fallback={<ChartFallback />}>
            <ActivityTimeline records={exps} />
          </Suspense>
        </div>
      </div>

      <div className="grid gap-2.5 lg:grid-cols-3">
        <div className="rounded-[8px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[13px] font-medium text-text-secondary">
              Directions
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-quaternary">
                {dirs.length}
              </span>
              <Link
                to="/directions"
                className="text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                View all
              </Link>
            </div>
          </div>
          <div>
            {dirs.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                to="/directions/$id"
                params={{ id: d.id }}
                className={cn(
                  "flex items-center justify-between",
                  dashboardRowClass
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">{d.title}</p>
                  <p className="text-[11px] text-text-quaternary">{d.id}</p>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <Badge variant="complete">{d.complete_count}</Badge>
                  <Badge variant="running">{d.running_count}</Badge>
                  <Badge variant="open">{d.open_count}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[13px] font-medium text-text-secondary">
              Current Findings
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-quaternary">
                {finds.length}
              </span>
              <Link
                to="/findings"
                className="text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                View all
              </Link>
            </div>
          </div>
          <div>
            {finds.slice(0, 6).map((f) => (
              <Link
                key={f.id}
                to="/findings/$id"
                params={{ id: f.id }}
                className={cn(
                  "flex items-center justify-between gap-3",
                  dashboardRowClass
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">{f.topic}</p>
                  <p className="truncate text-[11px] text-text-tertiary">
                    {f.finding}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <FindingImportanceBadge importance={f.importance} />
                  <Badge variant={f.confidence}>
                    {findingConfidenceLabel(f.confidence)}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[13px] font-medium text-text-secondary">
              Recent Activity
            </span>
            <Link
              to="/activity"
              className="text-[11px] text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          <div>
            {activity?.slice(0, 8).map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-2 border-b border-border-subtle px-3 py-2 transition-colors last:border-0 hover:bg-surface-hover/80"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="text-[12px] font-medium text-text">
                      {a.action.replace("_", " ")}
                    </span>
                    <RecordLink
                      recordId={a.record_id}
                      className="font-mono text-[11px] font-medium text-accent hover:underline focus-visible:rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>
                  <p className="text-[11px] text-text-quaternary">
                    {a.actor_name ?? a.actor}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[10px] text-text-quaternary"
                  title={formatDateTime(a.created_at)}
                >
                  {formatDateTimeShort(a.created_at)}
                </span>
              </div>
            ))}
            {(!activity || activity.length === 0) && (
              <div className="py-6 text-center text-[12px] text-text-quaternary">
                No activity yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
