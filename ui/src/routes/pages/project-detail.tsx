import { useState, useMemo, useCallback } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useProject, useExperimentsByProject, useDirectionsByProject } from "@/hooks/use-projects";
import { useRecordActivity } from "@/hooks/use-activity";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Skeleton, DetailSectionSkeleton, ExperimentRowSkeleton } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordLink } from "@/components/shared/record-link";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import type { ExperimentStatus } from "@/types/sonde";

export default function ProjectDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const { data: proj, isLoading: loadingProj } = useProject(id);
  const { data: directions, isLoading: loadingDirections } = useDirectionsByProject(id, proj?.program);
  const { data: experiments, isLoading: loadingExps } = useExperimentsByProject(id);
  const { data: activity } = useRecordActivity(id);
  const [statusFilter, setStatusFilter] = useState<ExperimentStatus | "all">("all");
  useHotkey("Escape", useCallback(() => navigate({ to: "/projects" }), [navigate]));

  const filtered = useMemo(() => {
    if (!experiments) return [];
    if (statusFilter === "all") return experiments;
    return experiments.filter((e) => e.status === statusFilter);
  }, [experiments, statusFilter]);

  if (loadingProj || !proj) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-6 w-6 rounded-[5.5px]" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <DetailSectionSkeleton />
            {Array.from({ length: 3 }).map((_, i) => (
              <ExperimentRowSkeleton key={i} />
            ))}
          </div>
          <DetailSectionSkeleton />
        </div>
      </div>
    );
  }

  const statuses: (ExperimentStatus | "all")[] = ["all", "open", "running", "complete", "failed"];

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Projects", to: "/projects" }, { label: proj.id }]} />
      <div className="flex items-center gap-2.5">
        <Link
          to="/projects"
          className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">{proj.id}</h1>
          <Badge
            variant={
              proj.status === "active" ? "running" :
              proj.status === "completed" ? "complete" :
              proj.status === "archived" ? "superseded" : "default"
            }
          >
            {proj.status}
          </Badge>
        </div>
        <span className="text-[12px] text-text-quaternary" title={formatDateTime(proj.created_at)}>
          {formatDateTimeShort(proj.created_at)}
        </span>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* Main */}
        <div className="min-w-0 space-y-3">
          <Section title="Project">
            <p className="text-[14px] font-medium text-text">{proj.name}</p>
            {proj.objective && (
              <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{proj.objective}</p>
            )}
          </Section>

          {/* Directions — always shown so project scope is visible next to experiments */}
          <Section
            title="Directions"
            count={
              loadingDirections ? proj.direction_count : (directions?.length ?? 0)
            }
          >
            {loadingDirections ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-[6px]" />
                <Skeleton className="h-12 w-full rounded-[6px]" />
              </div>
            ) : directions && directions.length > 0 ? (
              <div className="space-y-2">
                {directions.map((d) => (
                  <div
                    key={d.id}
                    className="flex min-w-0 flex-col gap-2 border-b border-border-subtle pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <RecordLink recordId={d.id} />
                        <Badge
                          variant={
                            d.status === "active" ? "running" :
                            d.status === "completed" ? "complete" : "default"
                          }
                        >
                          {d.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 break-words text-[12px] text-text">{d.title}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 text-[11px]">
                      <Badge variant="complete">{d.complete_count}</Badge>
                      <Badge variant="running">{d.running_count}</Badge>
                      <Badge variant="open">{d.open_count}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-text-quaternary">
                No directions scoped to this project yet. Link one with{" "}
                <span className="font-mono text-[12px]">sonde direction update DIR-… --project …</span>.
              </p>
            )}
          </Section>

          {/* Experiments */}
          <div className="rounded-[8px] border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <h3 className="text-[13px] font-medium text-text-secondary">Experiments</h3>
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
                    onClick={() => navigate({ to: "/experiments/$id", params: { id: exp.id } })}
                    className="flex cursor-pointer items-center gap-3 border-b border-border-subtle px-3 py-2 transition-colors last:border-0 hover:bg-surface-hover"
                  >
                    <span className="font-mono text-[12px] font-medium text-text">{exp.id}</span>
                    <Badge variant={exp.status}>{exp.status}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
                      {exp.finding ?? exp.hypothesis ?? "—"}
                    </span>
                    <span className="text-[11px] text-text-quaternary" title={formatDateTime(exp.created_at)}>
                      {formatDateTimeShort(exp.created_at)}
                    </span>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className="py-8 text-center text-[13px] text-text-quaternary">
                    No experiments {statusFilter !== "all" ? `with status "${statusFilter}"` : "under this project"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="min-w-0 space-y-3 lg:min-w-[280px]">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{proj.program}</DetailRow>
              <DetailRow label="Status">
                <Badge
                  variant={
                    proj.status === "active" ? "running" :
                    proj.status === "completed" ? "complete" : "default"
                  }
                >
                  {proj.status}
                </Badge>
              </DetailRow>
              <DetailRow label="Created">
                <span title={formatDateTime(proj.created_at)}>
                  {formatDateTimeShort(proj.created_at)}
                </span>
              </DetailRow>
              <DetailRow label="Directions">{proj.direction_count}</DetailRow>
              <DetailRow label="Experiments">{proj.experiment_count}</DetailRow>
              <DetailRow label="Complete">{proj.complete_count}</DetailRow>
              <DetailRow label="Running">{proj.running_count}</DetailRow>
              <DetailRow label="Open">{proj.open_count}</DetailRow>
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
