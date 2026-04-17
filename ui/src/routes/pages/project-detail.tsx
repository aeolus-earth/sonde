import { useState, useMemo, useCallback } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  useProject,
  useExperimentsByProject,
  useDirectionsByProject,
} from "@/hooks/use-projects";
import { useQuestions } from "@/hooks/use-questions";
import { useRecordActivity } from "@/hooks/use-activity";
import {
  isBlobCacheable,
  useArtifactBlob,
  useArtifacts,
  useArtifactUrl,
} from "@/hooks/use-artifacts";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import {
  Skeleton,
  DetailSectionSkeleton,
  ExperimentRowSkeleton,
} from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordUnavailable } from "@/components/shared/record-unavailable";
import { RecordLink } from "@/components/shared/record-link";
import { ArtifactGallery } from "@/components/artifacts/artifact-gallery";
import { EmbeddedDocumentPreview } from "@/components/artifacts/embedded-document-preview";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { projectDetailShareUrl } from "@/lib/app-origin";
import { ArrowLeft, Copy, Download, FileText } from "lucide-react";
import type {
  Artifact,
  DirectionSummary,
  ExperimentStatus,
  ExperimentSummary,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

export default function ProjectDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const { data: proj, isLoading: loadingProj } = useProject(id);
  const { data: directions, isLoading: loadingDirections } =
    useDirectionsByProject(id, proj?.program);
  const { data: experiments, isLoading: loadingExps } =
    useExperimentsByProject(id);
  const { data: questions } = useQuestions();
  const { data: activity } = useRecordActivity(id);
  const { data: projectArtifacts, isLoading: loadingProjectArtifacts } =
    useArtifacts(id);
  const [linkCopied, setLinkCopied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ExperimentStatus | "all">(
    "all",
  );
  const shareUrl = useMemo(() => projectDetailShareUrl(id), [id]);
  useHotkey(
    "Escape",
    useCallback(() => navigate({ to: "/projects" }), [navigate]),
  );

  const filtered = useMemo(() => {
    if (!experiments) return [];
    if (statusFilter === "all") return experiments;
    return experiments.filter((e) => e.status === statusFilter);
  }, [experiments, statusFilter]);

  const experimentsByDirection = useMemo(() => {
    const grouped = new Map<string, ExperimentSummary[]>();
    const projectOnly: ExperimentSummary[] = [];
    const knownDirectionIds = new Set(
      (directions ?? []).map((direction) => direction.id),
    );

    for (const experiment of filtered) {
      if (
        experiment.direction_id &&
        knownDirectionIds.has(experiment.direction_id)
      ) {
        const existing = grouped.get(experiment.direction_id);
        if (existing) {
          existing.push(experiment);
        } else {
          grouped.set(experiment.direction_id, [experiment]);
        }
        continue;
      }
      projectOnly.push(experiment);
    }

    return { grouped, projectOnly };
  }, [directions, filtered]);
  const questionsByDirection = useMemo(() => {
    const grouped = new Map<string, QuestionSummary[]>();
    const directionIds = new Set(
      (directions ?? []).map((direction) => direction.id),
    );
    for (const question of questions ?? []) {
      if (!question.direction_id || !directionIds.has(question.direction_id))
        continue;
      const existing = grouped.get(question.direction_id) ?? [];
      existing.push(question);
      grouped.set(question.direction_id, existing);
    }
    return grouped;
  }, [directions, questions]);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  }, [shareUrl]);

  const reportPdf = useMemo(
    () =>
      findProjectReportArtifact(
        projectArtifacts,
        proj?.report_pdf_artifact_id ?? null,
        "pdf",
      ),
    [projectArtifacts, proj?.report_pdf_artifact_id],
  );
  const reportTex = useMemo(
    () =>
      findProjectReportArtifact(
        projectArtifacts,
        proj?.report_tex_artifact_id ?? null,
        "tex",
      ),
    [projectArtifacts, proj?.report_tex_artifact_id],
  );

  if (!loadingProj && !proj) {
    return <RecordUnavailable recordLabel="Project" recordId={id} />;
  }

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

  const statuses: (ExperimentStatus | "all")[] = [
    "all",
    "open",
    "running",
    "complete",
    "failed",
  ];

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Projects", to: "/projects" }, { label: proj.id }]}
      />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link
            to="/projects"
            className="shrink-0 rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
              {proj.id}
            </h1>
            <Badge
              variant={
                proj.status === "active"
                  ? "running"
                  : proj.status === "completed"
                    ? "complete"
                    : proj.status === "archived"
                      ? "superseded"
                      : "default"
              }
            >
              {proj.status}
            </Badge>
          </div>
          <span
            className="text-[12px] text-text-quaternary"
            title={formatDateTime(proj.created_at)}
          >
            {formatDateTimeShort(proj.created_at)}
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
            <Copy
              className="h-3.5 w-3.5 shrink-0 text-text-quaternary"
              aria-hidden
            />
            {linkCopied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* Main */}
        <div className="min-w-0 space-y-3">
          <Section title="Project">
            <p className="text-[14px] font-medium text-text">{proj.name}</p>
            {proj.objective && (
              <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                {proj.objective}
              </p>
            )}
          </Section>

          <ProjectReportSection
            project={proj}
            pdf={reportPdf}
            tex={reportTex}
            isLoading={loadingProjectArtifacts}
          />

          {(directions?.length ?? 0) > 0 && (
            <Section
              title="Questions"
              count={Array.from(questionsByDirection.values()).reduce(
                (total, items) => total + (items?.length ?? 0),
                0,
              )}
            >
              <div className="space-y-2">
                {(directions ?? []).map((direction) => {
                  const items = questionsByDirection.get(direction.id) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div
                      key={direction.id}
                      className="rounded-[7px] border border-border-subtle"
                    >
                      <div className="border-b border-border-subtle px-3 py-2 text-[12px] font-medium text-text-secondary">
                        {direction.id} {direction.title}
                      </div>
                      <div className="divide-y divide-border-subtle">
                        {items.map((question) => (
                          <Link
                            key={question.id}
                            to="/questions/$id"
                            params={{ id: question.id }}
                            className="block px-3 py-2 text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            <span className="mr-2 font-mono text-[11px] text-text-quaternary">
                              {question.id}
                            </span>
                            {question.question}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <div className="rounded-[8px] border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-medium text-text-secondary">
                  Research structure
                </h3>
                <span className="text-[11px] text-text-quaternary">
                  {loadingDirections
                    ? proj.direction_count
                    : (directions?.length ?? 0)}{" "}
                  directions
                </span>
              </div>
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
            {loadingExps || loadingDirections ? (
              <div>
                {Array.from({ length: 3 }).map((_, i) => (
                  <ExperimentRowSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {(directions ?? []).map((direction) => (
                  <ProjectDirectionGroup
                    key={direction.id}
                    direction={direction}
                    experiments={
                      experimentsByDirection.grouped.get(direction.id) ?? []
                    }
                    statusFilter={statusFilter}
                    onExperimentClick={(expId) =>
                      navigate({
                        to: "/experiments/$id",
                        params: { id: expId },
                      })
                    }
                  />
                ))}

                {experimentsByDirection.projectOnly.length > 0 && (
                  <div className="px-3 py-2.5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-text-quaternary">
                        PROJECT
                      </span>
                      <Badge variant="default">unlinked</Badge>
                      <span className="text-[12px] text-text-secondary">
                        Experiments not attached to a direction yet
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-[7px] border border-dashed border-border-subtle">
                      {experimentsByDirection.projectOnly.map((exp, index) => (
                        <ProjectExperimentRow
                          key={exp.id}
                          experiment={exp}
                          isLast={
                            index ===
                            experimentsByDirection.projectOnly.length - 1
                          }
                          onClick={() =>
                            navigate({
                              to: "/experiments/$id",
                              params: { id: exp.id },
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}

                {(directions?.length ?? 0) === 0 && filtered.length === 0 && (
                  <div className="py-8 text-center text-[13px] text-text-quaternary">
                    No directions or experiments under this project yet.
                  </div>
                )}

                {(directions?.length ?? 0) > 0 && filtered.length === 0 && (
                  <div className="py-8 text-center text-[13px] text-text-quaternary">
                    No experiments{" "}
                    {statusFilter !== "all"
                      ? `with status "${statusFilter}"`
                      : "under this project"}
                  </div>
                )}
              </div>
            )}
          </div>

          <Section title="Artifacts">
            <ArtifactGallery parentId={proj.id} />
          </Section>
        </div>

        {/* Sidebar */}
        <div className="min-w-0 space-y-3 lg:min-w-[280px]">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{proj.program}</DetailRow>
              <DetailRow label="Status">
                <Badge
                  variant={
                    proj.status === "active"
                      ? "running"
                      : proj.status === "completed"
                        ? "complete"
                        : "default"
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

function findProjectReportArtifact(
  artifacts: Artifact[] | undefined,
  artifactId: string | null,
  extension: "pdf" | "tex",
): Artifact | null {
  if (!artifacts?.length) return null;
  if (artifactId) {
    const exact = artifacts.find((a) => a.id === artifactId);
    if (exact) return exact;
  }
  const canonicalSuffix = `/reports/project-report.${extension}`;
  return (
    artifacts.find((a) => a.storage_path.endsWith(canonicalSuffix)) ?? null
  );
}

function ProjectReportSection({
  project,
  pdf,
  tex,
  isLoading,
}: {
  project: ProjectSummary;
  pdf: Artifact | null;
  tex: Artifact | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Section title="Project Report">
        <Skeleton className="h-[360px] w-full rounded-[8px]" />
      </Section>
    );
  }

  if (!pdf) {
    return (
      <Section title="Project Report">
        <div className="rounded-[8px] border border-dashed border-border-subtle bg-surface-raised px-4 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-[7px] border border-border bg-surface p-2 text-text-tertiary">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-secondary">
                No final project report yet
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-text-quaternary">
                Register the curated PDF + LaTeX source before closing this
                project.
              </p>
              <code className="mt-3 block overflow-x-auto rounded-[6px] bg-bg px-2 py-1.5 font-mono text-[11px] text-text-tertiary">
                sonde project report {project.id} --pdf build/report.pdf --tex
                report/main.tex
              </code>
            </div>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Project Report">
      <ProjectReportPdf artifact={pdf} />
      {tex && <ReportSourceLink artifact={tex} />}
      {project.report_updated_at && (
        <p
          className="mt-2 text-[11px] text-text-quaternary"
          title={formatDateTime(project.report_updated_at)}
        >
          Report updated {formatDateTimeShort(project.report_updated_at)}
        </p>
      )}
    </Section>
  );
}

function ProjectDirectionGroup({
  direction,
  experiments,
  statusFilter,
  onExperimentClick,
}: {
  direction: DirectionSummary;
  experiments: ExperimentSummary[];
  statusFilter: ExperimentStatus | "all";
  onExperimentClick: (experimentId: string) => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <RecordLink recordId={direction.id} />
            <Badge
              variant={
                direction.status === "active"
                  ? "running"
                  : direction.status === "completed"
                    ? "complete"
                    : "default"
              }
            >
              {direction.status}
            </Badge>
            <span className="text-[11px] text-text-quaternary">
              {experiments.length} shown
            </span>
          </div>
          <p className="mt-0.5 break-words text-[12px] text-text">
            {direction.title}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-[11px]">
          <Badge variant="complete">{direction.complete_count}</Badge>
          <Badge variant="running">{direction.running_count}</Badge>
          <Badge variant="open">{direction.open_count}</Badge>
        </div>
      </div>

      {experiments.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-[7px] border border-border-subtle">
          {experiments.map((experiment, index) => (
            <ProjectExperimentRow
              key={experiment.id}
              experiment={experiment}
              isLast={index === experiments.length - 1}
              onClick={() => onExperimentClick(experiment.id)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 pl-3 text-[12px] text-text-quaternary">
          No experiments{" "}
          {statusFilter !== "all" ? `with status "${statusFilter}" ` : ""}in
          this direction.
        </p>
      )}
    </div>
  );
}

function ProjectExperimentRow({
  experiment,
  isLast,
  onClick,
}: {
  experiment: ExperimentSummary;
  isLast: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-hover ${isLast ? "" : "border-b border-border-subtle"}`}
    >
      <span className="font-mono text-[12px] font-medium text-text">
        {experiment.id}
      </span>
      <Badge variant={experiment.status}>{experiment.status}</Badge>
      <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
        {experiment.finding ?? experiment.hypothesis ?? "—"}
      </span>
      <span
        className="text-[11px] text-text-quaternary"
        title={formatDateTime(experiment.created_at)}
      >
        {formatDateTimeShort(experiment.created_at)}
      </span>
    </div>
  );
}

function ProjectReportPdf({ artifact }: { artifact: Artifact }) {
  const shouldEmbedBlob = isBlobCacheable(artifact.size_bytes);
  const { data: signedUrl } = useArtifactUrl(artifact.storage_path);
  const { data: blobUrl, error: blobError } = useArtifactBlob(
    artifact.storage_path,
    shouldEmbedBlob ? artifact.size_bytes : null,
  );
  const embedUrl = shouldEmbedBlob && !blobError ? blobUrl : signedUrl;

  if (!signedUrl || !embedUrl) {
    return <Skeleton className="h-[360px] w-full rounded-[8px]" />;
  }

  return (
    <EmbeddedDocumentPreview
      fileUrl={signedUrl}
      embedUrl={embedUrl}
      title={artifact.filename}
    />
  );
}

function ReportSourceLink({ artifact }: { artifact: Artifact }) {
  const { data: url } = useArtifactUrl(artifact.storage_path);

  if (!url) return null;

  return (
    <a
      href={url}
      download={artifact.filename}
      className="mt-3 inline-flex items-center gap-1.5 rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1.5 text-[12px] text-text-tertiary transition-colors hover:border-accent/30 hover:text-text-secondary"
    >
      <Download className="h-3.5 w-3.5" />
      Download LaTeX source
    </a>
  );
}
