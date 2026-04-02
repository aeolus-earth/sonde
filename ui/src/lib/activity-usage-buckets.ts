/** UTC date key YYYY-MM-DD from ISO timestamp (matches Postgres timestamptz). */
export function utcDayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Oldest → newest UTC calendar days covering the last `days` days through today (UTC). */
export function buildUtcDayRange(days: number): string[] {
  const result: string[] = [];
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(utcMidnight - i * 86400000);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

export function bucketTotalByDay(
  rows: { created_at: string }[],
  dayKeys: string[]
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const day = utcDayKey(r.created_at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return dayKeys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}
