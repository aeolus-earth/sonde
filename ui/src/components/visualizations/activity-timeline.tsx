import { memo, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ExperimentsSearch } from "@/routes/pages/experiments-list";

interface TimelineProps {
  records: { created_at: string }[];
}

export const ActivityTimeline = memo(function ActivityTimeline({
  records,
}: TimelineProps) {
  const colors = useThemeCssColors();
  const navigate = useNavigate();

  const onBarClick = useCallback(
    (item: { payload?: { date?: string } }) => {
      const day = item.payload?.date;
      if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        navigate({
          to: "/experiments",
          search: (prev: ExperimentsSearch) => ({ ...prev, day }),
        });
      }
    },
    [navigate]
  );

  const data = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of records) {
      const day = r.created_at.slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    return Array.from(buckets, ([date, count]) => ({ date, count })).sort(
      (a, b) => a.date.localeCompare(b.date)
    );
  }, [records]);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} barCategoryGap="20%">
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
          cursor={{ fill: colors.surfaceHover }}
        />
        <Bar
          dataKey="count"
          fill={colors.accent}
          radius={[2, 2, 0, 0]}
          maxBarSize={20}
          cursor="pointer"
          onClick={onBarClick}
        />
      </BarChart>
    </ResponsiveContainer>
  );
});
