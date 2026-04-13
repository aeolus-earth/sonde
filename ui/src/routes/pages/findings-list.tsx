import { useCallback, useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import type { FindingsSearch } from "../findings";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import {
  FINDING_CONFIDENCE_LEVELS,
  findingConfidenceLabel,
  parseFindingConfidenceFilter,
  serializeFindingConfidenceFilter,
} from "@/lib/finding-confidence";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Finding, FindingConfidence } from "@/types/sonde";

const routeApi = getRouteApi(ROUTE_API.authFindings);

export default function FindingsListPage() {
  const navigate = routeApi.useNavigate();
  const { confidence } = routeApi.useSearch();
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
  const activeConfidence = useMemo(
    () => parseFindingConfidenceFilter(confidence),
    [confidence]
  );
  const activeConfidenceSet = useMemo(
    () => new Set(activeConfidence),
    [activeConfidence]
  );
  const items = useMemo(() => {
    const source = findings ?? [];
    if (activeConfidenceSet.size === 0) return source;
    return source.filter((f) => activeConfidenceSet.has(f.confidence));
  }, [activeConfidenceSet, findings]);
  const { focusedIndex } = useListKeyboardNav(items, handleSelect);

  const toggleConfidence = useCallback(
    (level: FindingConfidence) => {
      const next = new Set(activeConfidence);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }

      navigate({
        search: (prev: FindingsSearch) => ({
          ...prev,
          confidence: serializeFindingConfidenceFilter(next),
        }),
        replace: true,
      });
    },
    [activeConfidence, navigate]
  );

  const clearConfidenceFilter = useCallback(() => {
    navigate({
      search: (prev: FindingsSearch) => ({
        ...prev,
        confidence: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

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
          {items.length}
          {activeConfidence.length > 0 ? ` of ${findings?.length ?? 0}` : ""} current
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={clearConfidenceFilter}
          className={cn(
            "rounded-[5.5px] border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
            activeConfidence.length === 0
              ? "border-border bg-surface-hover text-text"
              : "border-border bg-surface text-text-quaternary hover:bg-surface-hover hover:text-text"
          )}
        >
          All confidence
        </button>
        {FINDING_CONFIDENCE_LEVELS.map((level) => {
          const active = activeConfidenceSet.has(level);
          return (
            <button
              key={level}
              type="button"
              onClick={() => toggleConfidence(level)}
              className={cn(
                "rounded-[5.5px] border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                active
                  ? "border-border bg-surface-hover"
                  : "border-border bg-surface hover:bg-surface-hover"
              )}
              aria-pressed={active}
            >
              <Badge variant={level} className="text-[11px]">
                {findingConfidenceLabel(level)}
              </Badge>
            </button>
          );
        })}
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
                <Badge variant={f.confidence}>
                  {findingConfidenceLabel(f.confidence)}
                </Badge>
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
            {activeConfidence.length > 0
              ? "No findings match the selected confidence levels."
              : "No current findings."}
          </div>
        )}
      </div>
    </div>
  );
}
