import type { Finding, FindingImportance } from "@/types/sonde";

export const FINDING_IMPORTANCE_LEVELS: FindingImportance[] = [
  "low",
  "medium",
  "high",
];

const FINDING_IMPORTANCE_LABELS: Record<FindingImportance, string> = {
  low: "low",
  medium: "medium",
  high: "high",
};

const FINDING_IMPORTANCE_RANK: Record<FindingImportance, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function isFindingImportance(value: string): value is FindingImportance {
  return FINDING_IMPORTANCE_LEVELS.includes(value as FindingImportance);
}

export function findingImportanceLabel(importance: FindingImportance): string {
  return FINDING_IMPORTANCE_LABELS[importance];
}

export function findingImportanceRank(importance: FindingImportance): number {
  return FINDING_IMPORTANCE_RANK[importance];
}

export function compareFindingImportance(
  left: FindingImportance,
  right: FindingImportance,
): number {
  return findingImportanceRank(left) - findingImportanceRank(right);
}

export function parseFindingImportanceFilter(
  value: string | undefined,
): FindingImportance[] {
  if (!value) return [];
  const unique = new Set<FindingImportance>();

  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (isFindingImportance(trimmed)) {
      unique.add(trimmed);
    }
  }

  return FINDING_IMPORTANCE_LEVELS.filter((level) => unique.has(level));
}

export function serializeFindingImportanceFilter(
  values: Iterable<FindingImportance>,
): string | undefined {
  const unique = new Set<FindingImportance>();

  for (const value of values) {
    if (isFindingImportance(value)) {
      unique.add(value);
    }
  }

  const ordered = FINDING_IMPORTANCE_LEVELS.filter((level) => unique.has(level));
  return ordered.length > 0 ? ordered.join(",") : undefined;
}

export function sortFindingsByImportanceAndRecency(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const byImportance = compareFindingImportance(left.importance, right.importance);
    if (byImportance !== 0) return byImportance;

    return (
      new Date(right.valid_from ?? right.created_at).getTime() -
      new Date(left.valid_from ?? left.created_at).getTime()
    );
  });
}
