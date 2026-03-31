import { memo, useMemo } from "react";
import { useStatusChartColors, useThemeCssColors } from "@/hooks/use-theme-css-colors";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ExperimentStatus } from "@/types/sonde";

interface StatusChartProps {
  experiments: { status: ExperimentStatus }[];
}

export const StatusChart = memo(function StatusChart({
  experiments,
}: StatusChartProps) {
  const colors = useThemeCssColors();
  const statusColors = useStatusChartColors();

  const data = useMemo(() => {
    const counts = new Map<ExperimentStatus, number>();
    for (const e of experiments) {
      counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
    }
    return Array.from(counts, ([status, count]) => ({ status, count }));
  }, [experiments]);

  if (data.length === 0) return null;

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="status"
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={60}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell key={entry.status} fill={statusColors[entry.status]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: "5.5px",
              fontSize: "12px",
              color: colors.text,
              padding: "6px 10px",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.status} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: statusColors[d.status] }}
            />
            <span className="text-[12px] text-text-secondary capitalize">
              {d.status}
            </span>
            <span className="text-[12px] font-medium text-text">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
