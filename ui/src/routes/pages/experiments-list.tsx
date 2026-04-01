import {
  useMemo,
  useCallback,
  useRef,
  memo,
  useState,
  useDeferredValue,
  type Dispatch,
  type SetStateAction,
} from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ChevronRight } from "lucide-react";
import { ROUTE_API } from "../route-ids";
import { useExperiments, useExperimentSearch, useExperiment } from "@/hooks/use-experiments";
import { useProjects } from "@/hooks/use-projects";
import { useDirections } from "@/hooks/use-directions";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExperimentRowSkeleton } from "@/components/ui/skeleton";
import { formatDateTimeShort, formatDateTime, cn } from "@/lib/utils";
import {
  buildExperimentsProjectTree,
  flattenExperimentsInTreeOrder,
} from "@/lib/experiments-grouped";
import { useActiveProgram } from "@/stores/program";
import type { ArtifactType, ExperimentStatus, ExperimentSummary } from "@/types/sonde";
import { experimentMatchesSearchQuery } from "@/lib/experiment-search-match";

export type ExperimentsSearch = {
  q?: string;
  status?: ExperimentStatus | "all";
  artifact?: ArtifactType | "any" | undefined;
  view?: "list" | "grouped";
  /** ISO date YYYY-MM-DD — filter to experiments created on this calendar day (local). */
  day?: string;
  /** Sort by `created_at`: newest first (`desc`) or oldest first (`asc`). */
  created?: "asc" | "desc";
};

const routeApi = getRouteApi(ROUTE_API.authExperiments);

const ExperimentRow = memo(function ExperimentRow({
  exp,
  focused,
  onClick,
  nested,
  className,
}: {
  exp: ExperimentSummary;
  focused: boolean;
  onClick: (id: string) => void;
  /** When true, keep bottom border on last row (grouped under direction). */
  nested?: boolean;
  className?: string;
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
      className={cn(
        "grid cursor-pointer grid-cols-[80px_80px_1fr_1fr_100px_auto_120px] items-center gap-1 border-b border-border-subtle px-3 py-2 transition-colors hover:bg-surface-hover",
        !nested && "last:border-0",
        nested && "pl-3",
        focused ? "ring-1 ring-inset ring-accent bg-surface-hover" : "",
        className
      )}
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

function isExpanded(map: Record<string, boolean>, key: string): boolean {
  return map[key] !== false;
}

function toggleKey(
  setter: Dispatch<SetStateAction<Record<string, boolean>>>,
  key: string
) {
  setter((m) => ({ ...m, [key]: m[key] === false ? true : false }));
}

const CreatedSortHeader = memo(function CreatedSortHeader({
  createdSort,
  onToggle,
}: {
  createdSort: "asc" | "desc";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex w-full min-w-0 items-center justify-end gap-0.5 rounded-[4px] text-right font-medium text-text-quaternary transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      title={
        createdSort === "desc"
          ? "Newest first. Click for oldest first."
          : "Oldest first. Click for newest first."
      }
      aria-sort={createdSort === "desc" ? "descending" : "ascending"}
      aria-label={
        createdSort === "desc"
          ? "Sort by created: newest first. Activate to show oldest first."
          : "Sort by created: oldest first. Activate to show newest first."
      }
    >
      <span>Created</span>
      <ArrowDown
        className={cn(
          "h-3 w-3 shrink-0 opacity-80",
          createdSort === "asc" && "rotate-180"
        )}
        aria-hidden
      />
    </button>
  );
});

export default function ExperimentsListPage() {
  const { data: experiments, isLoading } = useExperiments();
  const { data: projects } = useProjects();
  const { data: directions } = useDirections();
  const activeProgram = useActiveProgram();
  const navigate = routeApi.useNavigate();
  const { q, status, artifact, view, day, created } = routeApi.useSearch();
  const filter = q ?? "";
  const deferredFilter = useDeferredValue(filter);
  const statusFilter = status ?? "all";
  const artifactFilter = artifact ?? undefined;
  const viewMode = view ?? "list";
  const dayFilter = day;
  const createdSort = created ?? "desc";

  const { data: serverMatchIds } = useExperimentSearch(deferredFilter);

  const [projOpen, setProjOpen] = useState<Record<string, boolean>>({});
  const [dirOpen, setDirOpen] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!experiments) return [];
    let result = experiments;
    if (statusFilter !== "all") {
      result = result.filter((e) => e.status === statusFilter);
    }
    if (artifactFilter === "any") {
      result = result.filter((e) => e.artifact_count > 0);
    } else if (artifactFilter) {
      result = result.filter(
        (e) => e.artifact_types?.includes(artifactFilter) ?? false
      );
    }
    if (dayFilter) {
      result = result.filter((e) => e.created_at.slice(0, 10) === dayFilter);
    }
    if (deferredFilter.trim()) {
      const serverIds = new Set(serverMatchIds ?? []);
      result = result.filter(
        (e) =>
          experimentMatchesSearchQuery(e, deferredFilter) || serverIds.has(e.id)
      );
    }
    return result;
  }, [
    experiments,
    deferredFilter,
    statusFilter,
    artifactFilter,
    dayFilter,
    serverMatchIds,
  ]);

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    const asc = createdSort === "asc";
    arr.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return asc ? ta - tb : tb - ta;
    });
    return arr;
  }, [filtered, createdSort]);

  const projectTree = useMemo(
    () =>
      buildExperimentsProjectTree(
        sortedFiltered,
        projects ?? [],
        directions ?? [],
        { createdSort }
      ),
    [sortedFiltered, projects, directions, createdSort]
  );

  const keyboardNavItems = useMemo(() => {
    if (viewMode === "grouped") {
      return flattenExperimentsInTreeOrder(projectTree);
    }
    return sortedFiltered;
  }, [viewMode, projectTree, sortedFiltered]);

  const toggleCreatedSort = useCallback(() => {
    navigate({
      search: (prev: ExperimentsSearch) => {
        const curr = prev.created ?? "desc";
        const next = curr === "desc" ? "asc" : "desc";
        return {
          ...prev,
          created: next === "desc" ? undefined : next,
        };
      },
      replace: true,
    });
  }, [navigate]);

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

  const { focusedIndex } = useListKeyboardNav(keyboardNavItems, handleSelect);

  const focusIndexByExpId = useMemo(() => {
    const m = new Map<string, number>();
    keyboardNavItems.forEach((e, i) => m.set(e.id, i));
    return m;
  }, [keyboardNavItems]);

  const useVirtual = viewMode === "list" && sortedFiltered.length > 100;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedFiltered.length,
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
            <CreatedSortHeader
              createdSort={createdSort}
              onToggle={toggleCreatedSort}
            />
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
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Experiments
          </h1>
          {viewMode === "grouped" && (
            <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-text-quaternary">
              Program{" "}
              <span className="font-mono text-text-tertiary">{activeProgram}</span>
              {" → Project → Direction → Experiment"}
            </p>
          )}
        </div>
        <span className="text-[12px] text-text-quaternary sm:shrink-0">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {dayFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-text-secondary">
            Created{" "}
            <span className="font-mono text-[12px] text-text">{dayFilter}</span>
          </span>
          <button
            type="button"
            onClick={() =>
              navigate({
                search: (prev: ExperimentsSearch) => ({
                  ...prev,
                  day: undefined,
                }),
                replace: true,
              })
            }
            className="rounded-[5.5px] border border-border bg-surface px-2 py-0.5 text-[11px] text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear day
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by ID, text, tag, or filename…"
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
          className="max-w-[280px]"
        />
        <div className="flex h-8 shrink-0 overflow-hidden rounded-[5.5px] border border-border bg-surface">
          <button
            type="button"
            onClick={() =>
              navigate({
                search: (prev: ExperimentsSearch) => ({
                  ...prev,
                  view: undefined,
                }),
                replace: true,
              })
            }
            className={`flex h-full min-w-0 items-center justify-center px-2.5 text-[12px] leading-none transition-colors first:rounded-l-[5.5px] ${
              viewMode === "list"
                ? "bg-surface-hover text-text"
                : "text-text-quaternary hover:text-text-tertiary"
            }`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() =>
              navigate({
                search: (prev: ExperimentsSearch) => ({
                  ...prev,
                  view: "grouped",
                }),
                replace: true,
              })
            }
            className={`flex h-full min-w-0 items-center justify-center px-2.5 text-[12px] leading-none transition-colors last:rounded-r-[5.5px] ${
              viewMode === "grouped"
                ? "bg-surface-hover text-text"
                : "text-text-quaternary hover:text-text-tertiary"
            }`}
          >
            By project
          </button>
        </div>
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
        {/* Artifact type filters */}
        <div className="flex h-8 shrink-0 overflow-hidden rounded-[5.5px] border border-border bg-surface">
          {(["any", "figure", "dataset", "paper", "notebook", "config", "log"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() =>
                navigate({
                  search: (prev: ExperimentsSearch) => ({
                    ...prev,
                    artifact: artifactFilter === a ? undefined : a,
                  }),
                  replace: true,
                })
              }
              className={`flex h-full min-w-0 items-center justify-center px-2.5 text-[12px] capitalize leading-none transition-colors first:rounded-l-[5.5px] last:rounded-r-[5.5px] ${
                artifactFilter === a
                  ? "bg-surface-hover text-text"
                  : "text-text-quaternary hover:text-text-tertiary"
              }`}
            >
              {a === "any" ? "Has files" : a}
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
          <CreatedSortHeader
            createdSort={createdSort}
            onToggle={toggleCreatedSort}
          />
        </div>
        {viewMode === "grouped" ? (
          <div className="max-h-[600px] space-y-4 overflow-y-auto px-0.5 pb-1 pt-0.5">
            {projectTree.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-text-quaternary">
                No experiments match your filters.
              </div>
            ) : (
              projectTree.map((pg) => (
                <div
                  key={pg.key}
                  className="overflow-hidden rounded-[8px] border border-border-subtle bg-surface shadow-sm"
                >
                  <div className="flex items-center gap-2 border-b border-accent/20 bg-accent-muted px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => toggleKey(setProjOpen, pg.key)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-[5.5px] px-1 py-0.5 text-left transition-colors hover:bg-accent/10"
                      aria-expanded={isExpanded(projOpen, pg.key)}
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 shrink-0 text-accent transition-transform",
                          isExpanded(projOpen, pg.key) && "rotate-90"
                        )}
                      />
                      <span className="min-w-0 truncate text-[13px] font-semibold text-text">
                        {pg.label}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-accent/90">
                        {pg.displayId}
                      </span>
                    </button>
                    {pg.projectId && (
                      <Link
                        to="/projects/$id"
                        params={{ id: pg.projectId }}
                        className="shrink-0 rounded-[5.5px] px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/15 hover:text-accent-hover"
                      >
                        Open project
                      </Link>
                    )}
                  </div>
                  {isExpanded(projOpen, pg.key) &&
                    pg.directions.map((dg) => {
                      const dirKey = `${pg.key}::${dg.directionId ?? "none"}`;
                      return (
                        <div key={dirKey}>
                          <button
                            type="button"
                            onClick={() => toggleKey(setDirOpen, dirKey)}
                            className="flex w-full items-center gap-2 border-b border-status-running/20 bg-status-running/10 py-1.5 pl-5 pr-3 text-left transition-colors hover:bg-status-running/18"
                            aria-expanded={isExpanded(dirOpen, dirKey)}
                          >
                            <ChevronRight
                              className={cn(
                                "h-3.5 w-3.5 shrink-0 text-status-running transition-transform",
                                isExpanded(dirOpen, dirKey) && "rotate-90"
                              )}
                            />
                            <span className="truncate text-[12px] font-medium text-text">
                              {dg.label}
                            </span>
                            {dg.directionId && (
                              <span className="shrink-0 font-mono text-[10px] text-status-running/85">
                                {dg.directionId}
                              </span>
                            )}
                          </button>
                          {isExpanded(dirOpen, dirKey) &&
                            dg.experiments.map((exp) => (
                              <ExperimentRow
                                key={exp.id}
                                exp={exp}
                                nested
                                focused={
                                  focusedIndex ===
                                  (focusIndexByExpId.get(exp.id) ?? -1)
                                }
                                onClick={handleRowClick}
                              />
                            ))}
                        </div>
                      );
                    })}
                </div>
              ))
            )}
          </div>
        ) : useVirtual ? (
          <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const exp = sortedFiltered[vRow.index];
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
          sortedFiltered.map((exp, idx) => (
            <ExperimentRow
              key={exp.id}
              exp={exp}
              focused={focusedIndex === idx}
              onClick={handleRowClick}
            />
          ))
        )}
        {viewMode === "list" && sortedFiltered.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No experiments match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
