import { describe, expect, it } from "vitest";
import type { Finding } from "@/types/sonde";
import {
  buildFindingTimePoints,
  isFindingInTimeRange,
  resolveFindingTimeRangeSelection,
  serializeFindingTimeRangeValue,
} from "./finding-time-range";

function finding(id: string, validFrom: string): Finding {
  return {
    id,
    program: "weather",
    topic: id,
    finding: "result",
    confidence: "medium",
    importance: "medium",
    content: null,
    metadata: {},
    evidence: [],
    source: "test",
    valid_from: validFrom,
    valid_until: null,
    supersedes: null,
    superseded_by: null,
    created_at: validFrom,
    updated_at: validFrom,
  };
}

describe("buildFindingTimePoints", () => {
  it("returns unique finding timestamps in ascending order", () => {
    const points = buildFindingTimePoints([
      finding("new", "2026-04-15T00:00:00Z"),
      finding("old", "2026-04-01T00:00:00Z"),
      finding("duplicate", "2026-04-15T00:00:00Z"),
    ]);

    expect(points).toEqual([
      Date.parse("2026-04-01T00:00:00Z"),
      Date.parse("2026-04-15T00:00:00Z"),
    ]);
  });
});

describe("resolveFindingTimeRangeSelection", () => {
  const points = [
    Date.parse("2026-04-01T00:00:00Z"),
    Date.parse("2026-04-10T00:00:00Z"),
    Date.parse("2026-04-15T00:00:00Z"),
  ];

  it("defaults to the full range", () => {
    expect(resolveFindingTimeRangeSelection(points, undefined, undefined)).toMatchObject({
      fromIndex: 0,
      toIndex: 2,
      isActive: false,
    });
  });

  it("resolves serialized search values back to point indexes", () => {
    const selection = resolveFindingTimeRangeSelection(
      points,
      serializeFindingTimeRangeValue(points[1]),
      serializeFindingTimeRangeValue(points[2]),
    );

    expect(selection).toMatchObject({
      fromIndex: 1,
      toIndex: 2,
      isActive: true,
    });
  });

  it("handles swapped search values defensively", () => {
    const selection = resolveFindingTimeRangeSelection(
      points,
      serializeFindingTimeRangeValue(points[2]),
      serializeFindingTimeRangeValue(points[0]),
    );

    expect(selection).toMatchObject({
      fromIndex: 0,
      toIndex: 2,
      isActive: false,
    });
  });
});

describe("isFindingInTimeRange", () => {
  it("keeps findings inside the selected inclusive window", () => {
    const points = [
      Date.parse("2026-04-01T00:00:00Z"),
      Date.parse("2026-04-10T00:00:00Z"),
      Date.parse("2026-04-15T00:00:00Z"),
    ];
    const selection = resolveFindingTimeRangeSelection(
      points,
      serializeFindingTimeRangeValue(points[1]),
      serializeFindingTimeRangeValue(points[2]),
    );

    expect(isFindingInTimeRange(finding("old", "2026-04-01T00:00:00Z"), selection)).toBe(
      false,
    );
    expect(
      isFindingInTimeRange(finding("inside", "2026-04-10T00:00:00Z"), selection),
    ).toBe(true);
  });
});
