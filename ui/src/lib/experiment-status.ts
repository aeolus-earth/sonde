import type { ExperimentStatus } from "@/types/sonde";

export type ExperimentStatusFilter = ExperimentStatus | "all";

export const EXPERIMENT_STATUS_FILTERS: ExperimentStatusFilter[] = [
  "all",
  "open",
  "running",
  "complete",
  "failed",
  "superseded",
];

const STATUS_FILTER_LABELS: Record<ExperimentStatusFilter, string> = {
  all: "All",
  open: "Open",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  superseded: "Archived",
};

export function normalizeExperimentStatusFilter(
  value: string | undefined,
): ExperimentStatusFilter | undefined {
  if (!value) return undefined;
  if (value === "archived") return "superseded";
  return (EXPERIMENT_STATUS_FILTERS as readonly string[]).includes(value)
    ? (value as ExperimentStatusFilter)
    : undefined;
}

export function experimentStatusFilterLabel(status: ExperimentStatusFilter): string {
  return STATUS_FILTER_LABELS[status];
}
