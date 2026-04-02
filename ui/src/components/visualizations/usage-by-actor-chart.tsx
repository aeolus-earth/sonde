import { memo, useMemo } from "react";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import type { ActivityUsageRow } from "@/hooks/use-admin";
import { buildUtcDayRange, utcDayKey } from "@/lib/activity-usage-buckets";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/** Shown as separate lines; remaining actors roll into “Other”. */
export const USAGE_BY_ACTOR_TOP_N = 5;

function shortActorLabel(row: ActivityUsageRow): string {
  if (row.actor_email) {
    const local = row.actor_email.split("@")[0] ?? row.actor_email;
    return local.length > 22 ? `${local.slice(0, 20)}…` : local;
  }
  const a = row.actor;
  return a.length > 22 ? `${a.slice(0, 20)}…` : a;
}

/** Stable display name per actor id (first row wins for email). */
function actorDisplayNames(rows: ActivityUsageRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (!m.has(r.actor)) {
      m.set(r.actor, shortActorLabel(r));
    }
  }
  return m;
}

export const UsageByActorChart = memo(function UsageByActorChart({
  rows,
  days,
}: {
  rows: ActivityUsageRow[];
  days: number;
}) {
  const colors = useThemeCssColors();

  const palette = useMemo(
    () => [
      colors.accent,
      colors.statusRunning,
      colors.statusComplete,
      colors.statusOpen,
      colors.statusFailed,
      colors.textTertiary,
    ],
    [colors]
  );

  const { data, lineKeys, labels } = useMemo(() => {
    const dayKeys = buildUtcDayRange(days);
    const daySet = new Set(dayKeys);

    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.actor, (totals.get(r.actor) ?? 0) + 1);
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const topActors = sorted.slice(0, USAGE_BY_ACTOR_TOP_N).map(([a]) => a);
    const topSet = new Set(topActors);
    const names = actorDisplayNames(rows);

    const perDay = new Map<string, Map<string, number>>();
    for (const d of dayKeys) {
      perDay.set(d, new Map());
    }
    for (const r of rows) {
      const day = utcDayKey(r.created_at);
      if (!daySet.has(day)) continue;
      const bucket = perDay.get(day)!;
      const key = topSet.has(r.actor) ? r.actor : "__other__";
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }

    const lineKeys: string[] = topActors.map((_, i) => `a${i}`);
    const labels: string[] = topActors.map((a) => names.get(a) ?? a);
    if (rows.some((r) => !topSet.has(r.actor))) {
      lineKeys.push("other");
      labels.push("Other");
    }

    const data = dayKeys.map((date) => {
      const m = perDay.get(date)!;
      const row: Record<string, string | number> = { date };
      topActors.forEach((actor, i) => {
        row[`a${i}`] = m.get(actor) ?? 0;
      });
      if (lineKeys.includes("other")) {
        row.other = m.get("__other__") ?? 0;
      }
      return row;
    });

    return { data, lineKeys, labels };
  }, [rows, days]);

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-[12px] text-text-quaternary">
        No activity in this range.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: colors.textTertiary }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis
          tick={{ fontSize: 10, fill: colors.textTertiary }}
          tickLine={false}
          axisLine={false}
          width={28}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: "5.5px",
            fontSize: "12px",
            color: colors.text,
            padding: "6px 10px",
          }}
          cursor={{ stroke: colors.textQuaternary, strokeDasharray: "4 4" }}
        />
        <Legend
          wrapperStyle={{ fontSize: "10px", paddingTop: 8 }}
          formatter={(value: string) => (
            <span className="text-text-secondary">{value}</span>
          )}
        />
        {lineKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={labels[i] ?? key}
            stroke={palette[i % palette.length]}
            strokeWidth={key === "other" ? 1.25 : 1.75}
            strokeOpacity={key === "other" ? 0.55 : 0.92}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});
