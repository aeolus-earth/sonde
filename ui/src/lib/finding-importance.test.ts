/**
 * Tests for finding-importance.ts.
 *
 * `sortFindingsByImportanceAndRecency` drives the default order shown in
 * brief / dashboard / admin. A regression that silently reorders by the
 * wrong key (or breaks date parsing) would mean low-importance or stale
 * findings appear first — users make worse decisions without noticing.
 * The filter parse/serialize functions back query-string round-trips;
 * a break there corrupts shareable URLs.
 */

import { describe, expect, it } from "vitest";
import type { Finding } from "@/types/sonde";
import {
  compareFindingImportance,
  FINDING_IMPORTANCE_LEVELS,
  findingImportanceLabel,
  findingImportanceRank,
  isFindingImportance,
  parseFindingImportanceFilter,
  serializeFindingImportanceFilter,
  sortFindingsByImportanceAndRecency,
} from "./finding-importance";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "FIND-0001",
    program: "weather-intervention",
    topic: "test",
    finding: "test",
    confidence: "medium",
    importance: "medium",
    evidence: [],
    source: "human/test",
    supersedes: null,
    superseded_by: null,
    valid_from: "2026-04-10T00:00:00Z",
    valid_until: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  } as Finding;
}

describe("isFindingImportance", () => {
  it("accepts the three valid levels", () => {
    for (const level of FINDING_IMPORTANCE_LEVELS) {
      expect(isFindingImportance(level)).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    expect(isFindingImportance("critical")).toBe(false);
    expect(isFindingImportance("")).toBe(false);
    expect(isFindingImportance("HIGH")).toBe(false);
  });
});

describe("findingImportanceRank", () => {
  it("ranks high < medium < low (lower = higher priority)", () => {
    expect(findingImportanceRank("high")).toBeLessThan(
      findingImportanceRank("medium"),
    );
    expect(findingImportanceRank("medium")).toBeLessThan(
      findingImportanceRank("low"),
    );
  });
});

describe("compareFindingImportance", () => {
  it("high < medium < low in sort order", () => {
    const order = ["low", "high", "medium"] as const;
    const sorted = [...order].sort(compareFindingImportance);
    expect(sorted).toEqual(["high", "medium", "low"]);
  });

  it("returns 0 for equal importance", () => {
    expect(compareFindingImportance("medium", "medium")).toBe(0);
  });
});

describe("findingImportanceLabel", () => {
  it("returns a label for each level", () => {
    expect(findingImportanceLabel("low")).toBe("low");
    expect(findingImportanceLabel("medium")).toBe("medium");
    expect(findingImportanceLabel("high")).toBe("high");
  });
});

describe("parseFindingImportanceFilter", () => {
  it("parses a comma-separated value into levels in canonical order", () => {
    expect(parseFindingImportanceFilter("high,low")).toEqual(["low", "high"]);
  });

  it("trims whitespace around each value", () => {
    expect(parseFindingImportanceFilter(" high , medium ")).toEqual([
      "medium",
      "high",
    ]);
  });

  it("deduplicates repeated values", () => {
    expect(parseFindingImportanceFilter("high,high,medium")).toEqual([
      "medium",
      "high",
    ]);
  });

  it("drops unknown levels silently (query-string round-trip safety)", () => {
    expect(parseFindingImportanceFilter("high,bogus,low")).toEqual([
      "low",
      "high",
    ]);
  });

  it("returns an empty list for undefined input", () => {
    expect(parseFindingImportanceFilter(undefined)).toEqual([]);
  });

  it("returns an empty list for empty string", () => {
    expect(parseFindingImportanceFilter("")).toEqual([]);
  });
});

describe("serializeFindingImportanceFilter", () => {
  it("emits levels in canonical order, not input order", () => {
    expect(serializeFindingImportanceFilter(["high", "low"])).toBe("low,high");
  });

  it("round-trips through parse", () => {
    const input = ["high", "medium"] as const;
    const serialized = serializeFindingImportanceFilter(input);
    expect(parseFindingImportanceFilter(serialized)).toEqual(["medium", "high"]);
  });

  it("deduplicates on serialization", () => {
    expect(serializeFindingImportanceFilter(["high", "high"])).toBe("high");
  });

  it("returns undefined for empty input (omits the query key)", () => {
    expect(serializeFindingImportanceFilter([])).toBeUndefined();
  });
});

describe("sortFindingsByImportanceAndRecency", () => {
  it("sorts by importance first, high to low", () => {
    const findings = [
      makeFinding({ id: "F-low", importance: "low" }),
      makeFinding({ id: "F-high", importance: "high" }),
      makeFinding({ id: "F-medium", importance: "medium" }),
    ];
    const sorted = sortFindingsByImportanceAndRecency(findings);
    expect(sorted.map((f) => f.id)).toEqual(["F-high", "F-medium", "F-low"]);
  });

  it("breaks ties by recency (valid_from descending)", () => {
    const findings = [
      makeFinding({
        id: "F-older",
        importance: "high",
        valid_from: "2026-04-01T00:00:00Z",
      }),
      makeFinding({
        id: "F-newer",
        importance: "high",
        valid_from: "2026-04-15T00:00:00Z",
      }),
    ];
    const sorted = sortFindingsByImportanceAndRecency(findings);
    expect(sorted.map((f) => f.id)).toEqual(["F-newer", "F-older"]);
  });

  it("falls back to created_at when valid_from is null", () => {
    const findings = [
      makeFinding({
        id: "F-older",
        importance: "high",
        valid_from: null,
        created_at: "2026-04-01T00:00:00Z",
      }),
      makeFinding({
        id: "F-newer",
        importance: "high",
        valid_from: null,
        created_at: "2026-04-15T00:00:00Z",
      }),
    ];
    const sorted = sortFindingsByImportanceAndRecency(findings);
    expect(sorted.map((f) => f.id)).toEqual(["F-newer", "F-older"]);
  });

  it("does not mutate the input array", () => {
    const findings = [
      makeFinding({ id: "F-1", importance: "low" }),
      makeFinding({ id: "F-2", importance: "high" }),
    ];
    const originalOrder = findings.map((f) => f.id);
    sortFindingsByImportanceAndRecency(findings);
    expect(findings.map((f) => f.id)).toEqual(originalOrder);
  });

  it("returns an empty array for empty input", () => {
    expect(sortFindingsByImportanceAndRecency([])).toEqual([]);
  });
});
