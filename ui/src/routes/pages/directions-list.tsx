import { useCallback } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useDirections } from "@/hooks/use-directions";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { DirectionSummary } from "@/types/sonde";

const routeApi = getRouteApi(ROUTE_API.authDirections);

export default function DirectionsListPage() {
  const navigate = routeApi.useNavigate();
  const { data: directions, isLoading } = useDirections();
  useRealtimeInvalidation("directions", ["directions"]);
  const handleClick = useCallback(
    (id: string) => navigate({ to: "/directions/$id", params: { id } }),
    [navigate]
  );
  const handleSelect = useCallback(
    (d: DirectionSummary) => handleClick(d.id),
    [handleClick]
  );
  const items = directions ?? [];
  const { focusedIndex } = useListKeyboardNav(items, handleSelect);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Directions
          </h1>
        </div>
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
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
          Directions
        </h1>
        <span className="text-[12px] text-text-quaternary">
          {directions?.length ?? 0}
        </span>
      </div>

      <div className="rounded-[8px] border border-border bg-surface">
        {items.map((d, idx) => (
          <div
            key={d.id}
            onClick={() => handleClick(d.id)}
            className={`flex cursor-pointer items-center gap-4 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover ${focusedIndex === idx ? "ring-1 ring-inset ring-accent bg-surface-hover" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-text-quaternary">
                  {d.id}
                </span>
                <Badge
                  variant={
                    d.status === "active"
                      ? "running"
                      : d.status === "completed"
                        ? "complete"
                        : d.status === "abandoned"
                          ? "failed"
                          : "default"
                  }
                >
                  {d.status}
                </Badge>
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-text">
                {d.title}
              </p>
              <p className="mt-0.5 text-[12px] text-text-tertiary">
                {d.question}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-4">
              <div className="flex items-center gap-2 text-[11px]">
                <Badge variant="complete">{d.complete_count}</Badge>
                <Badge variant="running">{d.running_count}</Badge>
                <Badge variant="open">{d.open_count}</Badge>
              </div>
              <span className="text-[11px] text-text-quaternary">
                {formatRelativeTime(d.updated_at)}
              </span>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No directions yet.
          </div>
        )}
      </div>
    </div>
  );
}
