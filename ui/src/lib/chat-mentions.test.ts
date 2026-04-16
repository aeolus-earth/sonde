/**
 * Tests for chat-mentions helpers.
 *
 * These are small-but-load-bearing pure functions — a bug in any of them
 * corrupts the outgoing chat message:
 *   - missing regex escape → ReDoS or false positives on crafted IDs
 *   - broken dedupe → the same mention submitted twice
 *   - sameMention treating cross-program refs as identical → wrong program scope
 */

import { describe, expect, it } from "vitest";
import type { MentionRef } from "@/types/chat";
import {
  dedupeMentions,
  escapeRegExp,
  mentionTokenExists,
  sameMention,
} from "./chat-mentions";

function makeMention(overrides: Partial<MentionRef> = {}): MentionRef {
  return {
    id: "EXP-0001",
    type: "experiment",
    program: "weather-intervention",
    label: "Experiment 0001",
    ...overrides,
  } as MentionRef;
}

describe("escapeRegExp", () => {
  it("escapes all regex metacharacters from the set", () => {
    // This set matches the implementation's character class.
    expect(escapeRegExp(".*+?^${}()|[]\\"))
      .toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("leaves non-metacharacters untouched", () => {
    expect(escapeRegExp("EXP-0001")).toBe("EXP-0001");
    expect(escapeRegExp("weather_intervention")).toBe("weather_intervention");
  });

  it("produces a string safe for RegExp consumption (round-trip)", () => {
    const weird = "hello (world) [test]";
    const pattern = new RegExp(`^${escapeRegExp(weird)}$`);
    expect(pattern.test(weird)).toBe(true);
    expect(pattern.test("hello world test")).toBe(false);
  });

  it("handles empty string", () => {
    expect(escapeRegExp("")).toBe("");
  });
});

describe("mentionTokenExists", () => {
  it("matches a mention at the start of text", () => {
    expect(mentionTokenExists("@EXP-0001 hello", "EXP-0001")).toBe(true);
  });

  it("matches a mention in the middle of text", () => {
    expect(mentionTokenExists("hello @EXP-0001 world", "EXP-0001")).toBe(true);
  });

  it("matches a mention at the end of text", () => {
    expect(mentionTokenExists("hello @EXP-0001", "EXP-0001")).toBe(true);
  });

  it("does not match when the id is a prefix of another mention", () => {
    // @EXP-0001 should not match when only @EXP-00010 is present.
    expect(mentionTokenExists("hello @EXP-00010 world", "EXP-0001")).toBe(false);
  });

  it("does not match a mid-word occurrence (must be @-prefixed)", () => {
    expect(mentionTokenExists("xy@EXP-0001 world", "EXP-0001")).toBe(false);
  });

  it("does not match when the token does not start with @", () => {
    expect(mentionTokenExists("EXP-0001", "EXP-0001")).toBe(false);
  });

  it("handles ids with regex metacharacters safely", () => {
    // A naive implementation would let '.' wildcard-match anything.
    expect(mentionTokenExists("@EXP.0001", "EXP.0001")).toBe(true);
    expect(mentionTokenExists("@EXPX0001", "EXP.0001")).toBe(false);
  });

  it("returns false for empty id", () => {
    // Empty id would build a degenerate regex; the function doesn't
    // special-case this, but the result should still be false rather
    // than an accidental match. Test pins that.
    expect(mentionTokenExists("hello world", "")).toBe(false);
  });
});

describe("sameMention", () => {
  it("returns true for identical id, type, and program", () => {
    expect(
      sameMention(
        makeMention({ id: "EXP-0001", type: "experiment", program: "p" }),
        makeMention({ id: "EXP-0001", type: "experiment", program: "p" }),
      ),
    ).toBe(true);
  });

  it("returns false when id differs", () => {
    expect(
      sameMention(
        makeMention({ id: "EXP-0001" }),
        makeMention({ id: "EXP-0002" }),
      ),
    ).toBe(false);
  });

  it("returns false when type differs (same id across different record types)", () => {
    // A finding FIND-0001 and a question Q-0001 with the same numeric
    // suffix would collide if we only compared ids.
    expect(
      sameMention(
        makeMention({ id: "0001", type: "experiment" }),
        makeMention({ id: "0001", type: "finding" }),
      ),
    ).toBe(false);
  });

  it("returns false when program differs", () => {
    // Cross-program refs with the same id/type aren't the same record.
    expect(
      sameMention(
        makeMention({ program: "weather-intervention" }),
        makeMention({ program: "energy-trading" }),
      ),
    ).toBe(false);
  });

  it("ignores non-identity fields like label", () => {
    // Label is display-only and may differ between invocations.
    expect(
      sameMention(
        makeMention({ label: "Alpha" }),
        makeMention({ label: "Beta" }),
      ),
    ).toBe(true);
  });
});

describe("dedupeMentions", () => {
  it("returns an empty array for empty input", () => {
    expect(dedupeMentions([])).toEqual([]);
  });

  it("returns the input unchanged when there are no duplicates", () => {
    const input = [
      makeMention({ id: "EXP-0001" }),
      makeMention({ id: "EXP-0002" }),
    ];
    expect(dedupeMentions(input)).toEqual(input);
  });

  it("removes exact duplicates", () => {
    const a = makeMention({ id: "EXP-0001" });
    const result = dedupeMentions([a, a]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("EXP-0001");
  });

  it("preserves first-seen order when dropping dupes", () => {
    const first = makeMention({ id: "EXP-0001", label: "first" });
    const dup = makeMention({ id: "EXP-0001", label: "dup" });
    const different = makeMention({ id: "EXP-0002", label: "different" });
    const result = dedupeMentions([first, different, dup]);
    expect(result).toHaveLength(2);
    expect(result[0]?.label).toBe("first");
    expect(result[1]?.label).toBe("different");
  });

  it("treats cross-program same-id mentions as distinct", () => {
    // Pins the sameMention contract through dedupe — a regression that
    // dropped program from the identity check would collapse these.
    const a = makeMention({ id: "EXP-0001", program: "weather-intervention" });
    const b = makeMention({ id: "EXP-0001", program: "energy-trading" });
    expect(dedupeMentions([a, b])).toHaveLength(2);
  });

  it("treats cross-type same-id mentions as distinct", () => {
    const a = makeMention({ id: "0001", type: "experiment" });
    const b = makeMention({ id: "0001", type: "finding" });
    expect(dedupeMentions([a, b])).toHaveLength(2);
  });
});
