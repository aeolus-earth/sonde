import { useCallback } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { Finding } from "@/types/sonde";

const routeApi = getRouteApi(ROUTE_API.authFindings);

export default function FindingsListPage() {
  const navigate = routeApi.useNavigate();
  const { data: findings, isLoading } = useCurrentFindings();
  useRealtimeInvalidation("findings", ["findings"]);
  const handleClick = useCallback(
    (id: string) => navigate({ to: "/findings/$id", params: { id } }),
    [navigate]
  );
  const handleSelect = useCallback(
    (f: Finding) => handleClick(f.id),
    [handleClick]
  );
  const items = findings ?? [];
  const { focusedIndex } = useListKeyboardNav(items, handleSelect);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Findings
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
          Findings
        </h1>
        <span className="text-[12px] text-text-quaternary">
          {findings?.length ?? 0} current
        </span>
      </div>

      <div className="rounded-[8px] border border-border bg-surface">
        {items.map((f, idx) => (
          <div
            key={f.id}
            onClick={() => handleClick(f.id)}
            className={`flex cursor-pointer items-start gap-4 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover ${focusedIndex === idx ? "ring-1 ring-inset ring-accent bg-surface-hover" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-text-quaternary">
                  {f.id}
                </span>
                <Badge variant={f.confidence}>{f.confidence}</Badge>
              </div>
              <p className="mt-0.5 text-[13px] font-medium text-text">
                {f.topic}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-tertiary">
                {f.finding}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] text-text-quaternary">
                {f.evidence.length} exp{f.evidence.length !== 1 ? "s" : ""}
              </p>
              <p className="text-[11px] text-text-quaternary">
                {formatRelativeTime(f.valid_from)}
              </p>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No current findings.
          </div>
        )}
      </div>
    </div>
  );
}
