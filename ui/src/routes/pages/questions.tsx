import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useFocusMode } from "@/hooks/use-focus";
import { useQuestions } from "@/hooks/use-questions";
import { useDirections } from "@/hooks/use-directions";
import { useDeleteQuestions } from "@/hooks/use-prune-mutations";
import { FocusToggle } from "@/components/shared/focus-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PruneConfirmDialog } from "@/components/prune/prune-confirm-dialog";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { displaySourceLabel } from "@/lib/actor-source";
import {
  buildDirectFocusReasonMaps,
  isDirectFocusReason,
} from "@/lib/focus-mode";
import { buildBulkActionPreview } from "@/lib/prune-actions";
import { formatRelativeTime } from "@/lib/utils";
import type { QuestionStatus, QuestionSummary } from "@/types/sonde";
import { Trash2 } from "lucide-react";

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
  actorSource,
  onDelete,
}: {
  question: QuestionSummary;
  directionLabel: string;
  actorSource: string | null;
  onDelete: (question: QuestionSummary) => void;
}) {
  return (
    <div className="group flex items-start gap-3 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover">
      <Link
        to="/questions/$id"
        params={{ id: question.id }}
        className="flex min-w-0 flex-1 items-start gap-4"
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
            <span title={question.source}>
              created by {displaySourceLabel(question.source, actorSource)}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-text-quaternary">
          {formatRelativeTime(question.updated_at)}
        </span>
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={`Delete ${question.id}`}
        onClick={() => onDelete(question)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function QuestionsPage() {
  const { data: questions, isLoading } = useQuestions();
  const { data: directions } = useDirections();
  const {
    enabled: focusEnabled,
    setEnabled: setFocusEnabled,
    actorSource,
    canFocus,
    description: focusDescription,
    disabledReason,
    touchedRecordIds,
  } = useFocusMode();
  const deleteQuestions = useDeleteQuestions();
  const [pendingDelete, setPendingDelete] = useState<QuestionSummary | null>(
    null,
  );
  const directFocusReasons = useMemo(
    () =>
      buildDirectFocusReasonMaps({
        projects: [],
        directions: [],
        questions: questions ?? [],
        experiments: [],
        findings: [],
        actorSource: actorSource ?? "",
        touchedRecordIds,
      }),
    [actorSource, questions, touchedRecordIds],
  );
  const focusActive = focusEnabled && canFocus;
  const visibleQuestions = useMemo(
    () =>
      focusActive
        ? (questions ?? []).filter((question) =>
            isDirectFocusReason(directFocusReasons.questions.get(question.id)),
          )
        : (questions ?? []),
    [directFocusReasons.questions, focusActive, questions],
  );

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
    for (const question of visibleQuestions) {
      const list = buckets.get(question.status);
      if (list) list.push(question);
    }
    return buckets;
  }, [visibleQuestions]);

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
          {visibleQuestions.length}
          {focusActive ? ` of ${questions?.length ?? 0}` : ""} total
        </span>
      </div>
      <FocusToggle
        enabled={focusEnabled}
        canFocus={canFocus}
        description={focusDescription}
        disabledReason={disabledReason}
        onToggle={() => setFocusEnabled(!focusEnabled)}
        compact
      />

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
                  actorSource={actorSource}
                  onDelete={setPendingDelete}
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

      {visibleQuestions.length === 0 && (
        <div className="rounded-[8px] border border-border bg-surface py-10 text-center text-[13px] text-text-quaternary">
          {focusActive ? "No focused questions yet." : "No questions yet."}
        </div>
      )}

      {pendingDelete ? (
        <PruneConfirmDialog
          open
          kind="question"
          action="delete"
          title={`Delete ${pendingDelete.id}?`}
          description="This removes the question from the question inbox and linked views. Experiments and findings stay in place."
          preview={buildBulkActionPreview(
            { kind: "question", action: "delete" },
            {
              questions: [pendingDelete.id],
              findings: [],
              experiments: [],
            },
            new Map(),
          )}
          isPending={deleteQuestions.isPending}
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            const result = await deleteQuestions.mutateAsync({
              ids: [pendingDelete.id],
            });
            if (result.summary.applied > 0) {
              setPendingDelete(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
