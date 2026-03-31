import { lazy, Suspense } from "react";
import { Link } from "@tanstack/react-router";
import { useExperiments } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useGlobalActivity } from "@/hooks/use-activity";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { Badge } from "@/components/ui/badge";
import { StatBlockSkeleton, Skeleton } from "@/components/ui/skeleton";
import { formatDateTimeShort, formatDateTime } from "@/lib/utils";

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
}: {
  value: number;
  label: string;
  color?: string;
}) {
  return (
    <div className="rounded-[8px] border border-border bg-surface p-3">
      <p
        className={`text-[20px] font-semibold tracking-[-0.02em] ${color ?? "text-text"}`}
      >
        {value}
      </p>
      <p className="text-[12px] text-text-tertiary">{label}</p>
    </div>
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
  const finds = findings ?? [];

  const running = exps.filter((e) => e.status === "running").length;
  const complete = exps.filter((e) => e.status === "complete").length;
  const failed = exps.filter((e) => e.status === "failed").length;

  return (
    <div className="space-y-5">
      <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
        Dashboard
      </h1>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatBlock value={exps.length} label="Experiments" />
        <StatBlock
          value={running}
          label="Running"
          color="text-status-running"
        />
        <StatBlock
          value={complete}
          label="Complete"
          color="text-status-complete"
        />
        <StatBlock value={failed} label="Failed" color="text-status-failed" />
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
            <span className="text-[11px] text-text-quaternary">
              {dirs.length}
            </span>
          </div>
          <div>
            {dirs.slice(0, 6).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between border-b border-border-subtle px-3 py-2 last:border-0"
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
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[13px] font-medium text-text-secondary">
              Current Findings
            </span>
            <span className="text-[11px] text-text-quaternary">
              {finds.length}
            </span>
          </div>
          <div>
            {finds.slice(0, 6).map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text">{f.topic}</p>
                  <p className="truncate text-[11px] text-text-tertiary">
                    {f.finding}
                  </p>
                </div>
                <Badge variant={f.confidence}>{f.confidence}</Badge>
              </div>
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
                className="flex items-start justify-between gap-2 border-b border-border-subtle px-3 py-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium text-text">
                      {a.action.replace("_", " ")}
                    </span>
                    <Link
                      to="/experiments/$id"
                      params={{ id: a.record_id }}
                      className="font-mono text-[11px] text-accent hover:underline"
                    >
                      {a.record_id}
                    </Link>
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
