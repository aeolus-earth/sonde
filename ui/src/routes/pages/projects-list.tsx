import { useCallback, useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useProjects } from "@/hooks/use-projects";
import { useDirections } from "@/hooks/use-directions";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { DirectionSummary, ProjectSummary } from "@/types/sonde";

export default function ProjectsListPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const { data: directions } = useDirections();
  useRealtimeInvalidation("experiments", ["projects"]);
  useRealtimeInvalidation("directions", ["directions"]);

  const directionsByProjectId = useMemo(() => {
    const map = new Map<string, DirectionSummary[]>();
    for (const d of directions ?? []) {
      if (!d.project_id) continue;
      const list = map.get(d.project_id);
      if (list) list.push(d);
      else map.set(d.project_id, [d]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    }
    return map;
  }, [directions]);

  const handleClick = useCallback(
    (id: string) => navigate({ to: "/projects/$id", params: { id } }),
    [navigate]
  );
  const handleSelect = useCallback(
    (p: ProjectSummary) => handleClick(p.id),
    [handleClick]
  );
  const items = projects ?? [];
  const { focusedIndex } = useListKeyboardNav(items, handleSelect);

  if (isLoading) {
    return (
      <div className="w-full min-w-0 space-y-3">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Projects</h1>
        <div className="rounded-[8px] border border-border bg-surface">
          {Array.from({ length: 6 }).map((_, i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="min-w-0 text-[15px] font-semibold tracking-[-0.015em] text-text">Projects</h1>
        <span className="shrink-0 text-[12px] text-text-quaternary">{items.length}</span>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        {items.map((p, idx) => {
          const projectDirections = directionsByProjectId.get(p.id) ?? [];
          return (
            <div
              key={p.id}
              className={`border-b border-border-subtle last:border-0 ${focusedIndex === idx ? "ring-1 ring-inset ring-accent" : ""}`}
            >
              <div
                onClick={() => handleClick(p.id)}
                className={`flex cursor-pointer flex-col gap-2 px-3 py-2.5 transition-colors hover:bg-surface-hover sm:flex-row sm:items-start sm:justify-between sm:gap-3 ${focusedIndex === idx ? "bg-surface-hover" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-mono text-[11px] text-text-quaternary">{p.id}</span>
                    <Badge
                      variant={
                        p.status === "active" ? "running" :
                        p.status === "completed" ? "complete" :
                        p.status === "archived" ? "superseded" : "default"
                      }
                    >
                      {p.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 break-words text-[13px] font-medium text-text">{p.name}</p>
                  {p.objective && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-text-tertiary">{p.objective}</p>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:max-w-[min(100%,20rem)] sm:justify-end">
                  <div className="whitespace-nowrap text-[11px] text-text-quaternary">
                    <span>{p.direction_count} dir</span>
                    <span className="mx-1">·</span>
                    <span>{p.experiment_count} exp</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="complete">{p.complete_count}</Badge>
                    <Badge variant="running">{p.running_count}</Badge>
                    <Badge variant="open">{p.open_count}</Badge>
                  </div>
                  <span className="whitespace-nowrap text-[11px] text-text-quaternary">
                    {formatRelativeTime(p.updated_at)}
                  </span>
                </div>
              </div>
              {projectDirections.length > 0 && (
                <div className="border-t border-border-subtle bg-bg/50 px-3 py-2 sm:pl-8">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-quaternary">
                    Directions
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {projectDirections.map((d) => (
                      <li key={d.id}>
                        <Link
                          to="/directions/$id"
                          params={{ id: d.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex min-w-0 items-baseline gap-2 rounded-[4px] px-1 py-0.5 text-left transition-colors hover:bg-surface-hover"
                        >
                          <span className="shrink-0 font-mono text-[10px] text-text-quaternary">{d.id}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{d.title}</span>
                          <Badge
                            className="shrink-0"
                            variant={
                              d.status === "active" ? "running" :
                              d.status === "completed" ? "complete" : "default"
                            }
                          >
                            {d.status}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No projects yet. Create one with <span className="font-mono">sonde project create</span>
          </div>
        )}
      </div>
    </div>
  );
}
