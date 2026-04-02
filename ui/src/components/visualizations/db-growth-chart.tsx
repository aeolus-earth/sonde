import { memo, useMemo } from "react";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import { formatBytes } from "@/lib/format";
import type { DbSizeSnapshot } from "@/hooks/use-admin";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DbGrowthChartProps {
  snapshots: DbSizeSnapshot[];
}

export const DbGrowthChart = memo(function DbGrowthChart({
  snapshots,
}: DbGrowthChartProps) {
  const colors = useThemeCssColors();

  const data = useMemo(() => {
    return snapshots.map((s) => ({
      date: s.captured_at.slice(0, 10),
      time: s.captured_at.slice(0, 16).replace("T", " "),
      db: s.total_db_bytes,
      storage: s.storage_bytes ?? 0,
    }));
  }, [snapshots]);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="dbGrowthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity={0.2} />
            <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="storageFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.statusRunning} stopOpacity={0.2} />
            <stop offset="100%" stopColor={colors.statusRunning} stopOpacity={0} />
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
          width={48}
          tickFormatter={(v: number) => formatBytes(v)}
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
          formatter={(value: number, name: string) => [
            formatBytes(value),
            name === "db" ? "Database" : "Files",
          ]}
          labelFormatter={(label: string) => label}
        />
        <Area
          type="monotone"
          dataKey="db"
          name="db"
          stroke={colors.accent}
          strokeWidth={1.5}
          fill="url(#dbGrowthFill)"
        />
        <Area
          type="monotone"
          dataKey="storage"
          name="storage"
          stroke={colors.statusRunning}
          strokeWidth={1.5}
          fill="url(#storageFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
});
