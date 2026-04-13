import { useCallback, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import {
  useFinding,
  useUpdateFindingConfidence,
  useUpdateFindingImportance,
} from "@/hooks/use-findings";
import { useQuestionsByFinding } from "@/hooks/use-questions";
import { useDirections } from "@/hooks/use-directions";
import { useProjects } from "@/hooks/use-projects";
import { useRecordActivity } from "@/hooks/use-activity";
import { useHotkey } from "@/hooks/use-keyboard";
import { FindingConfidenceBadge } from "@/components/shared/finding-confidence-badge";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Skeleton, DetailSectionSkeleton } from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { MarkdownView } from "@/components/ui/markdown-view";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordLink } from "@/components/shared/record-link";
import {
  FINDING_CONFIDENCE_LEVELS,
  findingConfidenceLabel,
} from "@/lib/finding-confidence";
import {
  FINDING_IMPORTANCE_LEVELS,
  findingImportanceLabel,
} from "@/lib/finding-importance";
import { supabase } from "@/lib/supabase";
import { cn, formatDateTime, formatDateTimeShort } from "@/lib/utils";
import { ArrowLeft, Check } from "lucide-react";
import type {
  DirectionSummary,
  ExperimentSummary,
  FindingConfidence,
  FindingImportance,
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

const importanceButtonStyles: Record<FindingImportance, string> = {
  low: "data-[active=true]:border-importance-low/25 data-[active=true]:bg-importance-low/10 data-[active=true]:text-importance-low",
  medium:
    "data-[active=true]:border-importance-medium/25 data-[active=true]:bg-importance-medium/10 data-[active=true]:text-importance-medium",
  high: "data-[active=true]:border-importance-high/25 data-[active=true]:bg-importance-high/10 data-[active=true]:text-importance-high",
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
  const updateImportance = useUpdateFindingImportance(id);
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
          <FindingConfidenceBadge confidence={finding.confidence} />
          <FindingImportanceBadge importance={finding.importance} />
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
              <FindingAxisEditor
                label="Confidence"
                valueLabel={findingConfidenceLabel(finding.confidence)}
                valueBadge={
                  <FindingConfidenceBadge
                    confidence={finding.confidence}
                    className="px-3 py-1.5 text-[11px]"
                    labelStyle="short"
                  />
                }
                helperText={updateConfidence.isPending ? "Saving..." : undefined}
                picker={
                  <SegmentedPicker
                    value={finding.confidence}
                    levels={FINDING_CONFIDENCE_LEVELS}
                    isPending={updateConfidence.isPending}
                    labelFor={findingConfidenceLabel}
                    buttonStyles={confidenceButtonStyles}
                    columnsClassName="grid-cols-5"
                    onChange={(confidence) =>
                      updateConfidence.mutate({ value: confidence })
                    }
                  />
                }
              />
              <FindingAxisEditor
                label="Importance"
                valueLabel={findingImportanceLabel(finding.importance)}
                valueBadge={
                  <FindingImportanceBadge
                    importance={finding.importance}
                    className="min-w-0 px-3 py-1.5 text-[11px]"
                  />
                }
                helperText={updateImportance.isPending ? "Saving..." : undefined}
                picker={
                  <SegmentedPicker
                    value={finding.importance}
                    levels={FINDING_IMPORTANCE_LEVELS}
                    isPending={updateImportance.isPending}
                    labelFor={findingImportanceLabel}
                    buttonStyles={importanceButtonStyles}
                    columnsClassName="grid-cols-3"
                    onChange={(importance) =>
                      updateImportance.mutate({ value: importance })
                    }
                  />
                }
              />
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

function FindingAxisEditor({
  label,
  valueLabel,
  valueBadge,
  helperText,
  picker,
}: {
  label: string;
  valueLabel: string;
  valueBadge: ReactNode;
  helperText?: string;
  picker: ReactNode;
}) {
  return (
    <div className="space-y-3 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] text-text-quaternary">{label}</p>
          <p className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-text">
            {valueLabel}
          </p>
          <p className="mt-1 text-[11px] text-text-quaternary">
            {helperText ?? `Set the current ${label.toLowerCase()} level for this finding.`}
          </p>
        </div>
        <div className="shrink-0">{valueBadge}</div>
      </div>
      <div className="rounded-[16px] bg-surface/60 p-1.5">
        {picker}
      </div>
    </div>
  );
}

function SegmentedPicker<T extends string>({
  value,
  levels,
  isPending,
  labelFor,
  buttonStyles,
  columnsClassName,
  onChange,
}: {
  value: T;
  levels: readonly T[];
  isPending: boolean;
  labelFor: (value: T) => string;
  buttonStyles: Record<T, string>;
  columnsClassName: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-[14px] border border-border-subtle bg-surface-raised/95 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_55%,transparent)]">
        <div
          className={cn(
            "grid divide-x divide-border-subtle",
            columnsClassName,
          )}
        >
          {levels.map((level) => {
            const isActive = value === level;
            return (
              <button
                key={level}
                type="button"
                data-active={isActive}
                disabled={isPending}
                onClick={() => onChange(level)}
                className={cn(
                  "relative flex min-h-[60px] items-center justify-center px-2 py-2.5 text-center text-[11px] font-medium leading-[1.15] text-text-tertiary transition-[background-color,color,box-shadow] hover:bg-surface hover:text-text-secondary focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50",
                  buttonStyles[level],
                )}
                aria-pressed={isActive}
              >
                <span className="flex items-center gap-1.5">
                  <span className="max-w-[72px] text-balance">
                    {labelFor(level)}
                  </span>
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border border-current/25 opacity-0 transition-opacity",
                      isActive && "opacity-100",
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
