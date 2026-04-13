import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { supabase } from "@/lib/supabase";
import { useQuestion } from "@/hooks/use-questions";
import { useDirection } from "@/hooks/use-directions";
import { useRecordActivity } from "@/hooks/use-activity";
import { useHotkey } from "@/hooks/use-keyboard";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Badge } from "@/components/ui/badge";
import {
  Skeleton,
  DetailSectionSkeleton,
  ExperimentRowSkeleton,
} from "@/components/ui/skeleton";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Section, DetailRow } from "@/components/shared/detail-layout";
import { RecordLink } from "@/components/shared/record-link";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import { sortFindingsByImportanceAndRecency } from "@/lib/finding-importance";
import { formatDateTime, formatDateTimeShort } from "@/lib/utils";
import type { ExperimentSummary, Finding } from "@/types/sonde";
import { ArrowLeft } from "lucide-react";

const routeApi = getRouteApi(ROUTE_API.authQuestionDetail);

function statusVariant(status: string): "complete" | "running" | "default" {
  if (status === "answered") return "complete";
  if (status === "investigating") return "running";
  return "default";
}

export default function QuestionDetailPage() {
  const { id } = routeApi.useParams();
  const navigate = routeApi.useNavigate();
  const { data: question, isLoading } = useQuestion(id);
  const { data: direction } = useDirection(question?.direction_id ?? "");
  const { data: activity } = useRecordActivity(id);
  useHotkey(
    "Escape",
    useCallback(() => navigate({ to: "/questions" }), [navigate]),
  );

  const { data: experiments } = useQuery({
    queryKey: ["questions", "detail", id, "experiments"] as const,
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data: links, error: linkError } = await supabase
        .from("question_experiments")
        .select("experiment_id,is_primary")
        .eq("question_id", id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (linkError) throw linkError;
      const experimentIds = (links ?? [])
        .map((row) => row.experiment_id as string | null)
        .filter((row): row is string => !!row);
      if (experimentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .in("id", experimentIds);
      if (error) throw error;
      const byId = new Map(
        (data ?? []).map((row) => [row.id as string, row as ExperimentSummary]),
      );
      return experimentIds
        .map((experimentId) => byId.get(experimentId))
        .filter(Boolean) as ExperimentSummary[];
    },
    enabled: !!id,
  });

  const { data: findings } = useQuery({
    queryKey: ["questions", "detail", id, "findings"] as const,
    queryFn: async (): Promise<Finding[]> => {
      const { data: links, error: linkError } = await supabase
        .from("question_findings")
        .select("finding_id")
        .eq("question_id", id)
        .order("created_at", { ascending: true });
      if (linkError) throw linkError;
      const findingIds = (links ?? [])
        .map((row) => row.finding_id as string | null)
        .filter((row): row is string => !!row);
      if (findingIds.length === 0) return [];
      const { data, error } = await supabase
        .from("findings")
        .select("*")
        .in("id", findingIds);
      if (error) throw error;
      const byId = new Map(
        (data ?? []).map((row) => [row.id as string, row as Finding]),
      );
      return findingIds
        .map((findingId) => byId.get(findingId))
        .filter(Boolean) as Finding[];
    },
    enabled: !!id,
  });
  const sortedFindings = sortFindingsByImportanceAndRecency(findings ?? []);

  if (isLoading || !question) {
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
            <div className="rounded-[8px] border border-border bg-surface">
              {Array.from({ length: 3 }).map((_, index) => (
                <ExperimentRowSkeleton key={index} />
              ))}
            </div>
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
        items={[
          { label: "Questions", to: "/questions" },
          ...(direction
            ? [{ label: direction.id, to: `/directions/${direction.id}` }]
            : []),
          { label: question.id },
        ]}
      />
      <div className="flex items-center gap-2.5">
        <Link
          to="/questions"
          className="rounded-[5.5px] p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-text">
            {question.id}
          </h1>
          <Badge variant={statusVariant(question.status)}>
            {question.status}
          </Badge>
        </div>
        <span
          className="text-[12px] text-text-quaternary"
          title={formatDateTime(question.created_at)}
        >
          {formatDateTimeShort(question.created_at)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <Section title="Question">
            <p className="text-[14px] font-medium text-text">
              {question.question}
            </p>
            {question.context && (
              <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                {question.context}
              </p>
            )}
          </Section>

          {experiments && experiments.length > 0 && (
            <Section title="Experiments" count={experiments.length}>
              <div className="space-y-1">
                {experiments.map((experiment) => (
                  <div key={experiment.id} className="flex items-center gap-2">
                    <RecordLink recordId={experiment.id} />
                    {experiment.primary_question_id === question.id && (
                      <Badge variant="running">primary</Badge>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {sortedFindings.length > 0 && (
            <Section title="Findings" count={sortedFindings.length}>
              <div className="space-y-1">
                {sortedFindings.map((finding) => (
                  <div key={finding.id} className="flex items-center gap-2">
                    <RecordLink recordId={finding.id} />
                    <FindingImportanceBadge importance={finding.importance} />
                    <Badge variant={finding.confidence}>
                      {findingConfidenceLabel(finding.confidence)}
                    </Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-3">
          <Section title="Details">
            <div className="divide-y divide-border-subtle">
              <DetailRow label="Program">{question.program}</DetailRow>
              <DetailRow label="Direction">
                {question.direction_id ? (
                  <RecordLink recordId={question.direction_id} />
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Source">{question.source}</DetailRow>
              <DetailRow label="Experiments">
                {question.linked_experiment_count}
              </DetailRow>
              <DetailRow label="Findings">
                {question.linked_finding_count}
              </DetailRow>
            </div>
          </Section>

          {activity && activity.length > 0 && (
            <Section title="Activity" count={activity.length}>
              <div className="space-y-2">
                {activity.slice(0, 10).map((item) => (
                  <div key={item.id}>
                    <span className="text-[12px] font-medium text-text">
                      {item.action.replace("_", " ")}
                    </span>
                    <p className="text-[11px] text-text-quaternary">
                      {item.actor_name ?? item.actor} ·{" "}
                      <span title={formatDateTime(item.created_at)}>
                        {formatDateTimeShort(item.created_at)}
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
