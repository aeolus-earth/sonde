import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuestions } from "@/hooks/use-questions";
import { useDirections } from "@/hooks/use-directions";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { QuestionStatus, QuestionSummary } from "@/types/sonde";

const STATUS_ORDER: QuestionStatus[] = [
  "open",
  "investigating",
  "answered",
  "dismissed",
];

function statusVariant(
  status: QuestionStatus,
): "complete" | "running" | "default" {
  if (status === "answered") return "complete";
  if (status === "investigating") return "running";
  return "default";
}

function QuestionRow({
  question,
  directionLabel,
}: {
  question: QuestionSummary;
  directionLabel: string;
}) {
  return (
    <Link
      to="/questions/$id"
      params={{ id: question.id }}
      className="flex items-start gap-4 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-quaternary">
            {question.id}
          </span>
          <Badge variant={statusVariant(question.status)}>
            {question.status}
          </Badge>
          <span className="text-[11px] text-text-quaternary">
            {directionLabel}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-text">{question.question}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-quaternary">
          <span>{question.linked_experiment_count} experiments</span>
          <span>{question.linked_finding_count} findings</span>
          {question.raised_by && <span>raised by {question.raised_by}</span>}
        </div>
      </div>
      <span className="shrink-0 text-[11px] text-text-quaternary">
        {formatRelativeTime(question.updated_at)}
      </span>
    </Link>
  );
}

export default function QuestionsPage() {
  const { data: questions, isLoading } = useQuestions();
  const { data: directions } = useDirections();

  const directionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const direction of directions ?? []) {
      map.set(direction.id, `${direction.id} ${direction.title}`);
    }
    return map;
  }, [directions]);

  const grouped = useMemo(() => {
    const buckets = new Map<QuestionStatus, QuestionSummary[]>();
    for (const status of STATUS_ORDER) buckets.set(status, []);
    for (const question of questions ?? []) {
      const list = buckets.get(question.status);
      if (list) list.push(question);
    }
    return buckets;
  }, [questions]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Questions
          </h1>
        </div>
        <div className="rounded-[8px] border border-border bg-surface">
          {Array.from({ length: 6 }).map((_, index) => (
            <ListRowSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
          Questions
        </h1>
        <span className="text-[12px] text-text-quaternary">
          {questions?.length ?? 0} total
        </span>
      </div>

      {STATUS_ORDER.map((status) => {
        const items = grouped.get(status) ?? [];
        if (items.length === 0) return null;
        return (
          <section
            key={status}
            className="rounded-[8px] border border-border bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-medium capitalize text-text-secondary">
                  {status}
                </h2>
                <Badge variant={statusVariant(status)}>{items.length}</Badge>
              </div>
            </div>
            <div>
              {items.map((question) => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  directionLabel={
                    (question.direction_id &&
                      directionLabelById.get(question.direction_id)) ||
                    "No home direction"
                  }
                />
              ))}
            </div>
          </section>
        );
      })}

      {(questions?.length ?? 0) === 0 && (
        <div className="rounded-[8px] border border-border bg-surface py-10 text-center text-[13px] text-text-quaternary">
          No questions yet.
        </div>
      )}
    </div>
  );
}
