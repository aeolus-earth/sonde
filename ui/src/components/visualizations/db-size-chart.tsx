import { memo, useMemo } from "react";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

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
          formatter={(value: number) => [formatBytes(value), "Size"]}
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

export { formatBytes };
