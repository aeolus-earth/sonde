import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useProjects } from "@/hooks/use-projects";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { ProjectSummary } from "@/types/sonde";

export default function ProjectsListPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  useRealtimeInvalidation("experiments", ["projects"]);

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
      <div className="space-y-3">
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Projects</h1>
        <span className="text-[12px] text-text-quaternary">{items.length}</span>
      </div>

      <div className="rounded-[8px] border border-border bg-surface">
        {items.map((p, idx) => (
          <div
            key={p.id}
            onClick={() => handleClick(p.id)}
            className={`flex cursor-pointer items-center gap-4 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover ${focusedIndex === idx ? "ring-1 ring-inset ring-accent bg-surface-hover" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-text-quaternary">{p.id}</span>
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
              <p className="mt-0.5 text-[13px] font-medium text-text">{p.name}</p>
              {p.objective && (
                <p className="mt-0.5 line-clamp-1 text-[12px] text-text-tertiary">{p.objective}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-right text-[11px]">
                <span className="text-text-quaternary">{p.direction_count} dir</span>
                <span className="mx-1 text-text-quaternary">·</span>
                <span className="text-text-quaternary">{p.experiment_count} exp</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <Badge variant="complete">{p.complete_count}</Badge>
                <Badge variant="running">{p.running_count}</Badge>
                <Badge variant="open">{p.open_count}</Badge>
              </div>
              <span className="text-[11px] text-text-quaternary">
                {formatRelativeTime(p.updated_at)}
              </span>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No projects yet. Create one with <span className="font-mono">sonde project create</span>
          </div>
        )}
      </div>
    </div>
  );
}
