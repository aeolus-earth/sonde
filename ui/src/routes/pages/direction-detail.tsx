import { useState, useMemo, useCallback } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useDirection, useChildDirections, useParentDirection } from "@/hooks/use-directions";
import { useExperimentsByDirection } from "@/hooks/use-experiments";
import { useRecordActivity } from "@/hooks/use-activity";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Skeleton, DetailSectionSkeleton, ExperimentRowSkeleton } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { directionDetailShareUrl } from "@/lib/app-origin";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { ArrowLeft, Copy, GitFork } from "lucide-react";
import type { ExperimentStatus } from "@/types/sonde";

const routeApi = getRouteApi(ROUTE_API.authDirectionDetail);

export default function DirectionDetailPage() {
  const { id } = routeApi.useParams();
  const navigate = routeApi.useNavigate();
  const [linkCopied, setLinkCopied] = useState(false);
  const { data: dir, isLoading: loadingDir } = useDirection(id);
  const { data: experiments, isLoading: loadingExps } = useExperimentsByDirection(id);
  const { data: activity } = useRecordActivity(id);
  const { data: childDirections } = useChildDirections(id);
  const { data: parentDir } = useParentDirection(dir?.parent_direction_id);
  const [statusFilter, setStatusFilter] = useState<ExperimentStatus | "all">("all");
  const shareUrl = useMemo(() => directionDetailShareUrl(id), [id]);
  useHotkey("Escape", useCallback(() => navigate({ to: "/directions" }), [navigate]));

  const filtered = useMemo(() => {
    if (!experiments) return [];
    if (statusFilter === "all") return experiments;
    return experiments.filter((e) => e.status === statusFilter);
  }, [experiments, statusFilter]);

  const handleExpClick = useCallback(
    (expId: string) => navigate({ to: "/experiments/$id", params: { id: expId } }),
    [navigate]
  );

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  }, [shareUrl]);

  if (loadingDir || !dir) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-6 w-6 rounded-[5.5px]" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-3">
            <DetailSectionSkeleton />
            <div className="rounded-[8px] border border-border bg-surface">
              {Array.from({ length: 4 }).map((_, i) => (
                <ExperimentRowSkeleton key={i} />
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <DetailSectionSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const statuses: (ExperimentStatus | "all")[] = ["all", "open", "running", "complete", "failed"];

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Directions", to: "/directions" },
          ...(parentDir
            ? [{ label: `${parentDir.id} ${parentDir.title}`, to: `/directions/${parentDir.id}` }]
            : []),
          { label: dir.id },
        ]}
      />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link
            to="/directions"
            className="shrink-0 rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
              {dir.id}
            </h1>
            <Badge
              variant={
                dir.status === "active" ? "running" :
                dir.status === "completed" ? "complete" :
                dir.status === "abandoned" ? "failed" : "default"
              }
            >
              {dir.status}
            </Badge>
          </div>
          <span className="text-[12px] text-text-quaternary" title={formatDateTime(dir.created_at)}>
            {formatDateTimeShort(dir.created_at)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 justify-end">
          <button
            type="button"
            onClick={() => void copyShareLink()}
            title={shareUrl}
            aria-label={linkCopied ? "Link copied" : `Copy link: ${shareUrl}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <Copy className="h-3.5 w-3.5 shrink-0 text-text-quaternary" aria-hidden />
            {linkCopied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          <Section title="Research Question">
            {dir.spawned_from_experiment_id && (
              <div className="mb-2 flex items-center gap-1.5 text-[12px] text-text-tertiary">
                <GitFork className="h-3 w-3" />
                <span>Spawned from</span>
                <Link
                  to="/experiments/$id"
                  params={{ id: dir.spawned_from_experiment_id }}
                  className="font-mono text-accent hover:underline"
                >
                  {dir.spawned_from_experiment_id}
                </Link>
              </div>
            )}
            <p className="text-[14px] font-medium text-text">{dir.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
              {dir.question}
            </p>
          </Section>

          {childDirections && childDirections.length > 0 && (
            <Section title="Sub-directions" count={childDirections.length}>
              <div className="divide-y divide-border-subtle">
                {childDirections.map((child) => (
                  <div
                    key={child.id}
                    onClick={() => navigate({ to: "/directions/$id", params: { id: child.id } })}
                    className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-hover"
                  >
                    <GitFork className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
                    <span className="shrink-0 font-mono text-[12px] font-medium text-text">
                      {child.id}
                    </span>
                    <Badge
                      variant={
                        child.status === "active" ? "running" :
                        child.status === "completed" ? "complete" :
                        child.status === "abandoned" ? "failed" : "default"
                      }
                    >
                      {child.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
                      {child.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                      <Badge variant="complete">{child.complete_count}</Badge>
                      <Badge variant="running">{child.running_count}</Badge>
                      <Badge variant="open">{child.open_count}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Experiments under this direction */}
          <div className="rounded-[8px] border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <h3 className="text-[13px] font-medium text-text-secondary">
                Experiments
              </h3>
              <div className="flex rounded-[5.5px] border border-border bg-bg">
                {statuses.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-1.5 py-0.5 text-[11px] capitalize transition-colors first:rounded-l-[5.5px] last:rounded-r-[5.5px] ${
                      statusFilter === s
                        ? "bg-surface-hover text-text"
                        : "text-text-quaternary hover:text-text-tertiary"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {loadingExps ? (
              <div>
                {Array.from({ length: 3 }).map((_, i) => (
                  <ExperimentRowSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div>
                {filtered.map((exp) => (
                  <div
                    key={exp.id}
                    onClick={() => handleExpClick(exp.id)}
                    className="flex min-w-0 cursor-pointer items-center gap-3 border-b border-border-subtle px-3 py-2 transition-colors last:border-0 hover:bg-surface-hover"
                  >
                    <span className="shrink-0 font-mono text-[12px] font-medium text-text">
                      {exp.id}
                    </span>
                    <Badge variant={exp.status}>{exp.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
                      {exp.finding ?? exp.hypothesis ?? "—"}
                    </span>
                    <span
                      className="shrink-0 text-[11px] text-text-quaternary"
                      title={formatDateTime(exp.created_at)}
                    >
                      {formatDateTimeShort(exp.created_at)}
                    </span>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="py-8 text-center text-[13px] text-text-quaternary">
                    No experiments {statusFilter !== "all" ? `with status "${statusFilter}"` : ""}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{dir.program}</DetailRow>
              <DetailRow label="Status">
                <Badge
                  variant={
                    dir.status === "active" ? "running" :
                    dir.status === "completed" ? "complete" : "default"
                  }
                >
                  {dir.status}
                </Badge>
              </DetailRow>
              {parentDir && (
                <DetailRow label="Parent">
                  <Link
                    to="/directions/$id"
                    params={{ id: parentDir.id }}
                    className="font-mono text-[12px] text-accent hover:underline"
                  >
                    {parentDir.id}
                  </Link>
                  <span className="ml-1 text-[11px] text-text-quaternary">{parentDir.title}</span>
                </DetailRow>
              )}
              {dir.spawned_from_experiment_id && (
                <DetailRow label="Spawned from">
                  <Link
                    to="/experiments/$id"
                    params={{ id: dir.spawned_from_experiment_id }}
                    className="font-mono text-[12px] text-accent hover:underline"
                  >
                    {dir.spawned_from_experiment_id}
                  </Link>
                </DetailRow>
              )}
              <DetailRow label="Created">
                <span title={formatDateTime(dir.created_at)}>
                  {formatDateTimeShort(dir.created_at)}
                </span>
              </DetailRow>
              <DetailRow label="Experiments">{dir.experiment_count}</DetailRow>
              <DetailRow label="Complete">{dir.complete_count}</DetailRow>
              <DetailRow label="Running">{dir.running_count}</DetailRow>
              <DetailRow label="Open">{dir.open_count}</DetailRow>
              {childDirections && childDirections.length > 0 && (
                <DetailRow label="Sub-directions">{childDirections.length}</DetailRow>
              )}
            </div>
          </Section>

          {activity && activity.length > 0 && (
            <Section title="Activity" count={activity.length}>
              <div className="space-y-2">
                {activity.slice(0, 10).map((a) => (
                  <div key={a.id}>
                    <span className="text-[12px] font-medium text-text">
                      {a.action.replace("_", " ")}
                    </span>
                    <p className="text-[11px] text-text-quaternary">
                      {a.actor_name ?? a.actor} ·{" "}
                      <span title={formatDateTime(a.created_at)}>
                        {formatDateTimeShort(a.created_at)}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
