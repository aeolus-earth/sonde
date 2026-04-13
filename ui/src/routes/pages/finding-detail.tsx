import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useFinding, useUpdateFindingConfidence } from "@/hooks/use-findings";
import { useQuestionsByFinding } from "@/hooks/use-questions";
import { useDirections } from "@/hooks/use-directions";
import { useProjects } from "@/hooks/use-projects";
import { useRecordActivity } from "@/hooks/use-activity";
import { useHotkey } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Skeleton, DetailSectionSkeleton } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { MarkdownView } from "@/components/ui/markdown-view";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordLink } from "@/components/shared/record-link";
import {
  FINDING_CONFIDENCE_LEVELS,
  findingConfidenceLabel,
} from "@/lib/finding-confidence";
import { supabase } from "@/lib/supabase";
import { cn, formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { ArrowLeft, Check } from "lucide-react";
import type {
  DirectionSummary,
  ExperimentSummary,
  FindingConfidence,
  ProjectSummary,
} from "@/types/sonde";

const routeApi = getRouteApi(ROUTE_API.authFindingDetail);

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,3}\s|^\s*[-*]\s|\*\*|`{1,3}|^\|.*\|$/m.test(text);
}

const confidenceButtonStyles: Record<FindingConfidence, string> = {
  very_low:
    "data-[active=true]:border-confidence-very-low/30 data-[active=true]:bg-confidence-very-low/12 data-[active=true]:text-confidence-very-low",
  low: "data-[active=true]:border-confidence-low/30 data-[active=true]:bg-confidence-low/12 data-[active=true]:text-confidence-low",
  medium:
    "data-[active=true]:border-confidence-medium/35 data-[active=true]:bg-confidence-medium/12 data-[active=true]:text-confidence-medium",
  high: "data-[active=true]:border-confidence-high/30 data-[active=true]:bg-confidence-high/12 data-[active=true]:text-confidence-high",
  very_high:
    "data-[active=true]:border-confidence-very-high/30 data-[active=true]:bg-confidence-very-high/12 data-[active=true]:text-confidence-very-high",
};

export default function FindingDetailPage() {
  const { id } = routeApi.useParams();
  const nav = routeApi.useNavigate();
  const { data: finding, isLoading } = useFinding(id);
  const { data: linkedQuestions } = useQuestionsByFinding(id);
  const { data: projects } = useProjects();
  const { data: directions } = useDirections();
  const { data: activity } = useRecordActivity(id);
  const updateConfidence = useUpdateFindingConfidence(id);
  const evidenceIds = finding?.evidence ?? [];
  const { data: evidenceExperiments } = useQuery({
    queryKey: ["findings", "detail", id, "evidence-experiments", evidenceIds] as const,
    queryFn: async (): Promise<ExperimentSummary[]> => {
      if (evidenceIds.length === 0) return [];
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .in("id", evidenceIds);
      if (error) throw error;
      const byId = new Map(
        (data ?? []).map((row) => [row.id as string, row as ExperimentSummary]),
      );
      return evidenceIds
        .map((expId) => byId.get(expId))
        .filter(Boolean) as ExperimentSummary[];
    },
    enabled: evidenceIds.length > 0,
  });
  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );
  const directionById = useMemo(
    () => new Map((directions ?? []).map((direction) => [direction.id, direction])),
    [directions],
  );
  useHotkey(
    "Escape",
    useCallback(() => nav({ to: "/findings" }), [nav]),
  );

  if (isLoading || !finding) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-6 w-6 rounded-[5.5px]" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <DetailSectionSkeleton />
            <DetailSectionSkeleton />
          </div>
          <div className="space-y-3">
            <DetailSectionSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Findings", to: "/findings" }, { label: finding.id }]}
      />
      <div className="flex items-center gap-2.5">
        <Link
          to="/findings"
          className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
            {finding.id}
          </h1>
          <Badge variant={finding.confidence}>
            {findingConfidenceLabel(finding.confidence)}
          </Badge>
        </div>
        <span
          className="text-[12px] text-text-quaternary"
          title={formatDateTime(finding.valid_from)}
        >
          {finding.source} · {formatDateTimeShort(finding.valid_from)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <Section title="Topic">
            <p className="text-[14px] font-medium text-text">{finding.topic}</p>
          </Section>

          <Section title="Finding">
            {looksLikeMarkdown(finding.finding) ? (
              <MarkdownView content={finding.finding} />
            ) : (
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {finding.finding}
              </p>
            )}
          </Section>

          {finding.evidence.length > 0 && (
            <Section title="Evidence" count={finding.evidence.length}>
              <div className="space-y-1">
                {(evidenceExperiments ?? []).map((experiment, index, items) => (
                  <EvidenceExperimentRow
                    key={experiment.id}
                    experiment={experiment}
                    project={experiment.project_id ? projectById.get(experiment.project_id) : undefined}
                    direction={experiment.direction_id ? directionById.get(experiment.direction_id) : undefined}
                    isLast={index === items.length - 1}
                  />
                ))}
              </div>
            </Section>
          )}

          {linkedQuestions && linkedQuestions.length > 0 && (
            <Section title="Questions" count={linkedQuestions.length}>
              <div className="space-y-1">
                {linkedQuestions.map((question) => (
                  <div key={question.id} className="flex items-center gap-2">
                    <RecordLink recordId={question.id} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {finding.supersedes && (
            <Section title="Supersedes">
              <RecordLink recordId={finding.supersedes} />
            </Section>
          )}

          {finding.superseded_by && (
            <Section title="Superseded by">
              <div className="flex items-center gap-2">
                <RecordLink recordId={finding.superseded_by} />
                <span className="text-[11px] text-text-quaternary">
                  This finding is no longer current.
                </span>
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-3">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{finding.program}</DetailRow>
              <DetailRow label="Source">{finding.source}</DetailRow>
              <div className="space-y-2.5 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-text-quaternary">
                    Confidence
                  </span>
                  <div className="flex items-center gap-3">
                    <Badge variant={finding.confidence}>
                      {findingConfidenceLabel(finding.confidence)}
                    </Badge>
                    <span className="text-[11px] text-text-quaternary">
                      {updateConfidence.isPending ? "Saving..." : "Tap to update"}
                    </span>
                  </div>
                </div>
                <ConfidencePicker
                  value={finding.confidence}
                  isPending={updateConfidence.isPending}
                  onChange={(confidence) => updateConfidence.mutate({ confidence })}
                />
              </div>
              <DetailRow label="Valid from">
                <span title={formatDateTime(finding.valid_from)}>
                  {formatDateTimeShort(finding.valid_from)}
                </span>
              </DetailRow>
              {finding.valid_until && (
                <DetailRow label="Valid until">
                  <span title={formatDateTime(finding.valid_until)}>
                    {formatDateTimeShort(finding.valid_until)}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Evidence">
                {finding.evidence.length} experiments
              </DetailRow>
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

function ConfidencePicker({
  value,
  isPending,
  onChange,
}: {
  value: FindingConfidence;
  isPending: boolean;
  onChange: (confidence: FindingConfidence) => void;
}) {
  return (
    <div className="w-full">
      <div className="rounded-[12px] border border-border-subtle bg-surface-raised/90 p-1.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_55%,transparent)]">
        <div className="grid grid-cols-5 gap-1.5">
          {FINDING_CONFIDENCE_LEVELS.map((level) => {
            const isActive = value === level;
            return (
              <button
                key={level}
                type="button"
                data-active={isActive}
                disabled={isPending}
                onClick={() => onChange(level)}
                className={cn(
                  "flex min-h-[52px] items-center justify-center rounded-[9px] border border-transparent px-1.5 py-2 text-center text-[10px] font-medium leading-tight text-text-quaternary transition-[background-color,border-color,color,box-shadow] hover:bg-surface hover:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 data-[active=true]:shadow-sm",
                  confidenceButtonStyles[level]
                )}
                aria-pressed={isActive}
              >
                <span className="flex flex-col items-center gap-1">
                  <span>{findingConfidenceLabel(level)}</span>
                  <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border border-current/25 opacity-0 transition-opacity",
                    isActive && "opacity-100"
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EvidenceExperimentRow({
  experiment,
  project,
  direction,
  isLast,
}: {
  experiment: ExperimentSummary;
  project?: ProjectSummary;
  direction?: DirectionSummary;
  isLast: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 px-3 py-2 ${isLast ? "" : "border-b border-border-subtle"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <RecordLink recordId={experiment.id} />
          <Badge variant={experiment.status}>{experiment.status}</Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] text-text-tertiary">
          {experiment.finding ?? experiment.hypothesis ?? "No finding recorded"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {project ? (
          <Link
            to="/projects/$id"
            params={{ id: project.id }}
            className="max-w-[240px] truncate text-[11px] font-medium text-text-secondary hover:text-text hover:underline"
            title={project.name}
          >
            {project.name}
          </Link>
        ) : (
          <span className="text-[11px] text-text-quaternary">No project</span>
        )}
        {direction ? (
          <div className="flex max-w-[260px] items-center gap-1 text-[11px] text-text-quaternary">
            {project ? <span>→</span> : null}
            <Link
              to="/directions/$id"
              params={{ id: direction.id }}
              className="truncate text-text-tertiary hover:text-text hover:underline"
              title={direction.title}
            >
              {direction.title}
            </Link>
          </div>
        ) : (
          <span className="text-[11px] text-text-quaternary">
            {project ? "→ no direction" : "No direction"}
          </span>
        )}
      </div>
    </div>
  );
}
