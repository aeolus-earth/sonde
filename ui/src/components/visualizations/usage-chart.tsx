import { memo, useMemo } from "react";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import { bucketTotalByDay, buildUtcDayRange } from "@/lib/activity-usage-buckets";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UsageChartProps {
  entries: { created_at: string }[];
  days: number;
}

export const UsageChart = memo(function UsageChart({
  entries,
  days,
}: UsageChartProps) {
  const colors = useThemeCssColors();

  const data = useMemo(() => {
    const dayKeys = buildUtcDayRange(days);
    return bucketTotalByDay(entries, dayKeys);
  }, [entries, days]);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity={0.2} />
            <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
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
          width={24}
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
        <Area
          type="monotone"
          dataKey="count"
          stroke={colors.accent}
          strokeWidth={1.5}
          fill="url(#usageFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});
