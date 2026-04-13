import type { FindingConfidence } from "@/types/sonde";

export const FINDING_CONFIDENCE_LEVELS: FindingConfidence[] = [
  "very_low",
  "low",
  "medium",
  "high",
  "very_high",
];

const FINDING_CONFIDENCE_LABELS: Record<FindingConfidence, string> = {
  very_low: "very low",
  low: "low",
  medium: "medium",
  high: "high",
  very_high: "very high",
};

export function isFindingConfidence(value: string): value is FindingConfidence {
  return FINDING_CONFIDENCE_LEVELS.includes(value as FindingConfidence);
}

export function findingConfidenceLabel(confidence: FindingConfidence): string {
  return FINDING_CONFIDENCE_LABELS[confidence];
}

export function parseFindingConfidenceFilter(
  value: string | undefined,
): FindingConfidence[] {
  if (!value) return [];
  const unique = new Set<FindingConfidence>();

  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (isFindingConfidence(trimmed)) {
      unique.add(trimmed);
    }
  }

  return FINDING_CONFIDENCE_LEVELS.filter((level) => unique.has(level));
}

export function serializeFindingConfidenceFilter(
  values: Iterable<FindingConfidence>,
): string | undefined {
  const unique = new Set<FindingConfidence>();

  for (const value of values) {
    if (isFindingConfidence(value)) {
      unique.add(value);
    }
  }

  const ordered = FINDING_CONFIDENCE_LEVELS.filter((level) => unique.has(level));
  return ordered.length > 0 ? ordered.join(",") : undefined;
}
