import { Button } from "@/components/ui/button";
import { experimentActionButtonLabel } from "@/lib/prune-actions";
import type { BulkActionIntent } from "@/lib/prune-actions";
import type { PruneSelection } from "@/types/sonde";

interface PruneActionBarProps {
  selection: PruneSelection;
  eligibleExperimentCounts: Record<"complete" | "failed" | "superseded", number>;
  onAction: (intent: BulkActionIntent) => void;
  onClear: () => void;
  onExit: () => void;
}

export function PruneActionBar({
  selection,
  eligibleExperimentCounts,
  onAction,
  onClear,
  onExit,
}: PruneActionBarProps) {
  const totalSelected =
    selection.questions.length +
    selection.findings.length +
    selection.experiments.length;

  if (totalSelected === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 mt-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-surface px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <div>
          <p className="text-[12px] font-medium text-text">
            {totalSelected} selected
          </p>
          <p className="mt-1 text-[11px] text-text-quaternary">
            {selection.questions.length} questions · {selection.findings.length} findings ·{" "}
            {selection.experiments.length} experiments
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selection.questions.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onAction({ kind: "question", action: "delete" })}
            >
              Delete questions
            </Button>
          ) : null}
          {selection.findings.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onAction({ kind: "finding", action: "delete" })}
            >
              Delete findings
            </Button>
          ) : null}
          {selection.experiments.length > 0 ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onAction({ kind: "experiment", action: "complete" })}
              disabled={eligibleExperimentCounts.complete === 0}
            >
              {experimentActionButtonLabel("complete")}
            </Button>
          ) : null}
          {selection.experiments.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onAction({ kind: "experiment", action: "failed" })}
              disabled={eligibleExperimentCounts.failed === 0}
            >
              {experimentActionButtonLabel("failed")}
            </Button>
          ) : null}
          {selection.experiments.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onAction({ kind: "experiment", action: "superseded" })}
              disabled={eligibleExperimentCounts.superseded === 0}
            >
              {experimentActionButtonLabel("superseded")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onExit}>
            Exit manage mode
          </Button>
        </div>
      </div>
    </div>
  );
}
