/**
 * Tests for finding-confidence.ts.
 *
 * The confidence filter drives URL query-string persistence for the brief
 * and findings pages. A break in parse/serialize corrupts shareable URLs
 * or silently drops the user's filter on navigation.
 */

import { describe, expect, it } from "vitest";
import {
  FINDING_CONFIDENCE_LEVELS,
  findingConfidenceLabel,
  isFindingConfidence,
  parseFindingConfidenceFilter,
  serializeFindingConfidenceFilter,
} from "./finding-confidence";

describe("isFindingConfidence", () => {
  it("accepts all five valid levels", () => {
    for (const level of FINDING_CONFIDENCE_LEVELS) {
      expect(isFindingConfidence(level)).toBe(true);
    }
  });

  it("rejects near-miss strings (case-sensitive)", () => {
    expect(isFindingConfidence("High")).toBe(false);
    expect(isFindingConfidence("VERY_HIGH")).toBe(false);
    expect(isFindingConfidence("very high")).toBe(false);
    expect(isFindingConfidence("")).toBe(false);
  });

  it("rejects adjacent levels that are not in the set", () => {
    expect(isFindingConfidence("critical")).toBe(false);
    expect(isFindingConfidence("unknown")).toBe(false);
  });
});

describe("findingConfidenceLabel", () => {
  it("returns human-readable labels with a space for multi-word levels", () => {
    expect(findingConfidenceLabel("very_low")).toBe("very low");
    expect(findingConfidenceLabel("very_high")).toBe("very high");
  });

  it("returns the level name for single-word levels", () => {
    expect(findingConfidenceLabel("low")).toBe("low");
    expect(findingConfidenceLabel("medium")).toBe("medium");
    expect(findingConfidenceLabel("high")).toBe("high");
  });
});

describe("parseFindingConfidenceFilter", () => {
  it("parses canonical order regardless of input order", () => {
    expect(parseFindingConfidenceFilter("high,very_low")).toEqual([
      "very_low",
      "high",
    ]);
  });

  it("trims whitespace around each value", () => {
    expect(parseFindingConfidenceFilter(" high , medium ")).toEqual([
      "medium",
      "high",
    ]);
  });

  it("deduplicates repeated values", () => {
    expect(parseFindingConfidenceFilter("high,high,very_high")).toEqual([
      "high",
      "very_high",
    ]);
  });

  it("drops unknown levels silently", () => {
    expect(parseFindingConfidenceFilter("high,critical,low")).toEqual([
      "low",
      "high",
    ]);
  });

  it("returns empty for undefined", () => {
    expect(parseFindingConfidenceFilter(undefined)).toEqual([]);
  });

  it("returns empty for empty string", () => {
    expect(parseFindingConfidenceFilter("")).toEqual([]);
  });
});

describe("serializeFindingConfidenceFilter", () => {
  it("emits canonical order", () => {
    expect(serializeFindingConfidenceFilter(["high", "very_low"])).toBe(
      "very_low,high",
    );
  });

  it("round-trips through parse", () => {
    const serialized = serializeFindingConfidenceFilter(["very_high", "low"]);
    expect(parseFindingConfidenceFilter(serialized)).toEqual(["low", "very_high"]);
  });

  it("returns undefined for empty input", () => {
    expect(serializeFindingConfidenceFilter([])).toBeUndefined();
  });

  it("drops invalid values silently (robust against upstream drift)", () => {
    expect(
      serializeFindingConfidenceFilter([
        "high",
        "stellar" as never,
        "low",
      ]),
    ).toBe("low,high");
  });
});
