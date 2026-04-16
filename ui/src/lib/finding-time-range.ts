import type { Finding } from "@/types/sonde";
import {
  buildTimePoints,
  isTimestampInTimeRange,
  resolveTimeRangeSelection,
  serializeTimeRangeValue,
  timestampFromIso,
  type TimeRangeSelection,
} from "./time-range";

export type FindingTimeRangeSelection = TimeRangeSelection;

export function findingTimestamp(finding: Finding): number | undefined {
  return timestampFromIso(finding.valid_from ?? finding.created_at);
}

export function buildFindingTimePoints(findings: Finding[]): number[] {
  return buildTimePoints(findings, findingTimestamp);
}

export const serializeFindingTimeRangeValue = serializeTimeRangeValue;

export function resolveFindingTimeRangeSelection(
  points: number[],
  fromValue: string | undefined,
  toValue: string | undefined,
): FindingTimeRangeSelection {
  return resolveTimeRangeSelection(points, fromValue, toValue);
}

export function isFindingInTimeRange(
  finding: Finding,
  selection: FindingTimeRangeSelection,
): boolean {
  return isTimestampInTimeRange(findingTimestamp(finding), selection);
}
