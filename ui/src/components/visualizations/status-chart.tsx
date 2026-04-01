import { memo, useCallback, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useStatusChartColors, useThemeCssColors } from "@/hooks/use-theme-css-colors";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ExperimentStatus } from "@/types/sonde";
import type { ExperimentsSearch } from "@/routes/pages/experiments-list";
import { cn } from "@/lib/utils";

interface StatusChartProps {
  experiments: { status: ExperimentStatus }[];
}

export const StatusChart = memo(function StatusChart({
  experiments,
}: StatusChartProps) {
  const colors = useThemeCssColors();
  const statusColors = useStatusChartColors();
  const navigate = useNavigate();

  const goToStatus = useCallback(
    (status: ExperimentStatus) => {
      navigate({
        to: "/experiments",
        search: (prev: ExperimentsSearch) => ({ ...prev, status }),
      });
    },
    [navigate]
  );

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
            cursor="pointer"
            onClick={(sector) => {
              const row = sector.payload as { status?: ExperimentStatus } | undefined;
              const st =
                (sector as { status?: ExperimentStatus }).status ?? row?.status;
              if (st) goToStatus(st);
            }}
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
          <Link
            key={d.status}
            to="/experiments"
            search={(prev: ExperimentsSearch) => ({ ...prev, status: d.status })}
            className={cn(
              "flex items-center gap-2 rounded-[5.5px] px-1.5 py-0.5 -mx-1.5 transition-colors",
              "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            )}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: statusColors[d.status] }}
            />
            <span className="text-[12px] text-text-secondary capitalize">
              {d.status}
            </span>
            <span className="text-[12px] font-medium text-text">{d.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
});
