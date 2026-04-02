import { describe, expect, it } from "vitest";
import { bucketTotalByDay, buildUtcDayRange, utcDayKey } from "./activity-usage-buckets";

describe("activity-usage-buckets", () => {
  it("utcDayKey reads YYYY-MM-DD from ISO", () => {
    expect(utcDayKey("2026-04-02T15:30:00.000Z")).toBe("2026-04-02");
  });

  it("buildUtcDayRange returns consecutive days", () => {
    const days = buildUtcDayRange(3);
    expect(days).toHaveLength(3);
    expect(days[0]! < days[1]! && days[1]! < days[2]!).toBe(true);
  });

  it("bucketTotalByDay zero-fills missing days", () => {
    const keys = ["2026-04-01", "2026-04-02", "2026-04-03"];
    const rows = [{ created_at: "2026-04-02T12:00:00.000Z" }];
    const out = bucketTotalByDay(rows, keys);
    expect(out).toEqual([
      { date: "2026-04-01", count: 0 },
      { date: "2026-04-02", count: 1 },
      { date: "2026-04-03", count: 0 },
    ]);
  });
});
