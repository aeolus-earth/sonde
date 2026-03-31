import { useMemo, useCallback, useRef, memo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ROUTE_API } from "../route-ids";
import { useExperiments } from "@/hooks/use-experiments";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExperimentRowSkeleton } from "@/components/ui/skeleton";
import { formatDateTimeShort, formatDateTime } from "@/lib/utils";
import type { ExperimentStatus, ExperimentSummary } from "@/types/sonde";

export type ExperimentsSearch = {
  q?: string;
  status?: ExperimentStatus | "all";
};

const routeApi = getRouteApi(ROUTE_API.authExperiments);

const ExperimentRow = memo(function ExperimentRow({
  exp,
  focused,
  onClick,
}: {
  exp: ExperimentSummary;
  focused: boolean;
  onClick: (id: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(exp.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(exp.id);
        }
      }}
      className={`grid cursor-pointer grid-cols-[80px_80px_1fr_1fr_100px_auto_120px] items-center gap-1 border-b border-border-subtle px-3 py-2 transition-colors last:border-0 hover:bg-surface-hover ${focused ? "ring-1 ring-inset ring-accent bg-surface-hover" : ""}`}
    >
      <span className="font-mono text-[12px] font-medium text-text">
        {exp.id}
      </span>
      <span className="flex items-center">
        <Badge variant={exp.status}>{exp.status}</Badge>
      </span>
      <span className="truncate text-[13px] text-text-secondary">
        {exp.hypothesis ?? "\u2014"}
      </span>
      <span className="truncate text-[13px] text-text-secondary">
        {exp.finding ?? "\u2014"}
      </span>
      <span className="truncate text-[12px] text-text-tertiary">
        {exp.source}
      </span>
      <span className="flex gap-1">
        {exp.tags.slice(0, 2).map((t) => (
          <Badge key={t} variant="tag" dot={false}>
            {t}
          </Badge>
        ))}
      </span>
      <span
        className="text-right text-[12px] text-text-quaternary"
        title={formatDateTime(exp.created_at)}
      >
        {formatDateTimeShort(exp.created_at)}
      </span>
    </div>
  );
});

export default function ExperimentsListPage() {
  const { data: experiments, isLoading } = useExperiments();
  const navigate = routeApi.useNavigate();
  const { q, status } = routeApi.useSearch();
  const filter = q ?? "";
  const statusFilter = status ?? "all";

  const filtered = useMemo(() => {
    if (!experiments) return [];
    let result = experiments;
    if (statusFilter !== "all") {
      result = result.filter((e) => e.status === statusFilter);
    }
    if (filter) {
      const ql = filter.toLowerCase();
      result = result.filter(
        (e) =>
          e.id.toLowerCase().includes(ql) ||
          e.hypothesis?.toLowerCase().includes(ql) ||
          e.finding?.toLowerCase().includes(ql) ||
          e.tags.some((t) => t.toLowerCase().includes(ql))
      );
    }
    return result;
  }, [experiments, filter, statusFilter]);

  const handleRowClick = useCallback(
    (id: string) => {
      navigate({ to: "/experiments/$id", params: { id } });
    },
    [navigate]
  );

  const handleSelect = useCallback(
    (exp: ExperimentSummary) => handleRowClick(exp.id),
    [handleRowClick]
  );

  const { focusedIndex } = useListKeyboardNav(filtered, handleSelect);

  const useVirtual = filtered.length > 100;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 20,
    enabled: useVirtual,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Experiments
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Filter…" disabled className="max-w-[240px]" />
        </div>
        <div className="rounded-[8px] border border-border bg-surface">
          <div className="grid grid-cols-[80px_80px_1fr_1fr_100px_auto_120px] gap-1 border-b border-border px-3 py-1.5 text-[11px] font-medium text-text-quaternary">
            <span>ID</span>
            <span>Status</span>
            <span>Hypothesis</span>
            <span>Finding</span>
            <span>Source</span>
            <span>Tags</span>
            <span className="text-right">Created</span>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <ExperimentRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const statuses: (ExperimentStatus | "all")[] = [
    "all",
    "open",
    "running",
    "complete",
    "failed",
    "superseded",
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
          Experiments
        </h1>
        <span className="text-[12px] text-text-quaternary">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) =>
            navigate({
              search: (prev: ExperimentsSearch) => ({
                ...prev,
                q: e.target.value || undefined,
              }),
              replace: true,
            })
          }
          className="max-w-[240px]"
        />
        <div className="flex h-8 shrink-0 overflow-hidden rounded-[5.5px] border border-border bg-surface">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() =>
                navigate({
                  search: (prev: ExperimentsSearch) => ({
                    ...prev,
                    status: s === "all" ? undefined : s,
                  }),
                  replace: true,
                })
              }
              className={`flex h-full min-w-0 items-center justify-center px-2.5 text-[12px] capitalize leading-none transition-colors first:rounded-l-[5.5px] last:rounded-r-[5.5px] ${
                statusFilter === s
                  ? "bg-surface-hover text-text"
                  : "text-text-quaternary hover:text-text-tertiary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[8px] border border-border bg-surface">
        <div className="grid grid-cols-[80px_80px_1fr_1fr_100px_auto_120px] gap-1 border-b border-border px-3 py-1.5 text-[11px] font-medium text-text-quaternary">
          <span>ID</span>
          <span>Status</span>
          <span>Hypothesis</span>
          <span>Finding</span>
          <span>Source</span>
          <span>Tags</span>
          <span className="text-right">Created</span>
        </div>
        {useVirtual ? (
          <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const exp = filtered[vRow.index];
                return (
                  <div
                    key={exp.id}
                    data-index={vRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    <ExperimentRow
                      exp={exp}
                      focused={focusedIndex === vRow.index}
                      onClick={handleRowClick}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          filtered.map((exp, idx) => (
            <ExperimentRow
              key={exp.id}
              exp={exp}
              focused={focusedIndex === idx}
              onClick={handleRowClick}
            />
          ))
        )}
        {filtered.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No experiments match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
