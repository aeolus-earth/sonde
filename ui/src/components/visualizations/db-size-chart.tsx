import { memo, useMemo } from "react";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import { formatBytes } from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DbSizeChartProps {
  tableSizes: Record<string, number>;
}

export const DbSizeChart = memo(function DbSizeChart({
  tableSizes,
}: DbSizeChartProps) {
  const colors = useThemeCssColors();

  const data = useMemo(() => {
    return Object.entries(tableSizes)
      .map(([table, bytes]) => ({ table, bytes }))
      .sort((a, b) => b.bytes - a.bytes);
  }, [tableSizes]);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 28)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: colors.textTertiary }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatBytes(v)}
        />
        <YAxis
          type="category"
          dataKey="table"
          tick={{ fontSize: 10, fill: colors.textTertiary }}
          tickLine={false}
          axisLine={false}
          width={100}
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
          formatter={(value) => [formatBytes(Number(value)), "Size"]}
        />
        <Bar
          dataKey="bytes"
          fill={colors.accent}
          radius={[0, 2, 2, 0]}
          maxBarSize={16}
        />
      </BarChart>
    </ResponsiveContainer>
  );
});

