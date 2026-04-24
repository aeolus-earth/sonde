import type {
  BulkActionPreview,
  BulkActionSkip,
  ExperimentPruneAction,
  ExperimentSummary,
  PruneAction,
  PruneSelection,
  PruneableRecordKind,
} from "@/types/sonde";

export type BulkActionIntent =
  | { kind: "question"; action: "delete" }
  | { kind: "finding"; action: "delete" }
  | { kind: "experiment"; action: ExperimentPruneAction };

export function emptyPruneSelection(): PruneSelection {
  return {
    questions: [],
    findings: [],
    experiments: [],
  };
}

export function pruneSelectionCount(selection: PruneSelection): number {
  return (
    selection.questions.length +
    selection.findings.length +
    selection.experiments.length
  );
}

export function pruneSelectionForKind(
  selection: PruneSelection,
  kind: PruneableRecordKind,
): string[] {
  if (kind === "question") return selection.questions;
  if (kind === "finding") return selection.findings;
  return selection.experiments;
}

export function togglePruneSelection(
  selection: PruneSelection,
  kind: PruneableRecordKind,
  id: string,
): PruneSelection {
  const next = new Set(pruneSelectionForKind(selection, kind));
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  if (kind === "question") {
    return { ...selection, questions: [...next].sort() };
  }
  if (kind === "finding") {
    return { ...selection, findings: [...next].sort() };
  }
  return { ...selection, experiments: [...next].sort() };
}

export function removeAppliedFromSelection(
  selection: PruneSelection,
  kind: PruneableRecordKind,
  appliedIds: string[],
): PruneSelection {
  if (appliedIds.length === 0) return selection;
  const applied = new Set(appliedIds);
  if (kind === "question") {
    return {
      ...selection,
      questions: selection.questions.filter((id) => !applied.has(id)),
    };
  }
  if (kind === "finding") {
    return {
      ...selection,
      findings: selection.findings.filter((id) => !applied.has(id)),
    };
  }
  return {
    ...selection,
    experiments: selection.experiments.filter((id) => !applied.has(id)),
  };
}

export function intersectPruneSelection(
  selection: PruneSelection,
  visible: {
    questions: Set<string>;
    findings: Set<string>;
    experiments: Set<string>;
  },
): PruneSelection {
  return {
    questions: selection.questions.filter((id) => visible.questions.has(id)),
    findings: selection.findings.filter((id) => visible.findings.has(id)),
    experiments: selection.experiments.filter((id) =>
      visible.experiments.has(id),
    ),
  };
}

export function samePruneSelection(
  left: PruneSelection,
  right: PruneSelection,
): boolean {
  return (
    sameIdList(left.questions, right.questions) &&
    sameIdList(left.findings, right.findings) &&
    sameIdList(left.experiments, right.experiments)
  );
}

export function isExperimentActionEligible(
  status: ExperimentSummary["status"],
  action: ExperimentPruneAction,
): boolean {
  if (action === "superseded") {
    return status === "complete" || status === "failed";
  }
  return status === "open" || status === "running";
}

export function experimentActionButtonLabel(
  action: ExperimentPruneAction,
): string {
  if (action === "complete") return "Mark complete";
  if (action === "failed") return "Mark failed";
  return "Archive";
}

export function experimentActionConfirmLabel(
  action: ExperimentPruneAction,
): string {
  if (action === "complete") return "Mark selected complete";
  if (action === "failed") return "Mark selected failed";
  return "Archive selected";
}

export function pruneKindLabel(
  kind: PruneableRecordKind,
  count: number,
): string {
  if (kind === "question") return count === 1 ? "question" : "questions";
  if (kind === "finding") return count === 1 ? "finding" : "findings";
  return count === 1 ? "experiment" : "experiments";
}

export function buildBulkActionPreview(
  intent: BulkActionIntent,
  selection: PruneSelection,
  experimentsById: Map<string, ExperimentSummary>,
): BulkActionPreview {
  if (intent.kind === "question") {
    return {
      kind: "question",
      action: "delete",
      eligibleIds: selection.questions,
      sampleIds: selection.questions.slice(0, 6),
      skipped: [],
    };
  }

  if (intent.kind === "finding") {
    return {
      kind: "finding",
      action: "delete",
      eligibleIds: selection.findings,
      sampleIds: selection.findings.slice(0, 6),
      skipped: [],
    };
  }

  const eligibleIds: string[] = [];
  const skipped: BulkActionSkip[] = [];
  for (const id of selection.experiments) {
    const experiment = experimentsById.get(id);
    if (!experiment) {
      skipped.push({
        id,
        reason: "not_visible",
        message: "Experiment is no longer visible in this view.",
      });
      continue;
    }
    if (!isExperimentActionEligible(experiment.status, intent.action)) {
      skipped.push({
        id,
        reason: "ineligible_status",
        message:
          intent.action === "superseded"
            ? "Only complete or failed experiments can be archived."
            : "Only open or running experiments can be marked complete or failed.",
        current_status: experiment.status,
      });
      continue;
    }
    eligibleIds.push(id);
  }

  return {
    kind: "experiment",
    action: intent.action,
    eligibleIds,
    sampleIds: eligibleIds.slice(0, 6),
    skipped,
  };
}

export function isDeleteAction(action: PruneAction): action is "delete" {
  return action === "delete";
}

function sameIdList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
