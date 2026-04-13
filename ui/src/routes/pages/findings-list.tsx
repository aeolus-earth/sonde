import { useCallback, useMemo, type ReactNode } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import type { FindingsSearch } from "../findings";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import {
  FINDING_CONFIDENCE_LEVELS,
  findingConfidenceLabel,
  parseFindingConfidenceFilter,
  serializeFindingConfidenceFilter,
} from "@/lib/finding-confidence";
import {
  FINDING_IMPORTANCE_LEVELS,
  parseFindingImportanceFilter,
  serializeFindingImportanceFilter,
  sortFindingsByImportanceAndRecency,
} from "@/lib/finding-importance";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Finding, FindingConfidence, FindingImportance } from "@/types/sonde";

const routeApi = getRouteApi(ROUTE_API.authFindings);

export default function FindingsListPage() {
  const navigate = routeApi.useNavigate();
  const { confidence, importance } = routeApi.useSearch();
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
  const activeImportance = useMemo(
    () => parseFindingImportanceFilter(importance),
    [importance]
  );
  const activeImportanceSet = useMemo(
    () => new Set(activeImportance),
    [activeImportance]
  );
  const items = useMemo(() => {
    const source = sortFindingsByImportanceAndRecency(findings ?? []);
    return source.filter((finding) => {
      const confidenceMatch =
        activeConfidenceSet.size === 0 ||
        activeConfidenceSet.has(finding.confidence);
      const importanceMatch =
        activeImportanceSet.size === 0 ||
        activeImportanceSet.has(finding.importance);
      return confidenceMatch && importanceMatch;
    });
  }, [activeConfidenceSet, activeImportanceSet, findings]);
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

  const toggleImportance = useCallback(
    (level: FindingImportance) => {
      const next = new Set(activeImportance);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }

      navigate({
        search: (prev: FindingsSearch) => ({
          ...prev,
          importance: serializeFindingImportanceFilter(next),
        }),
        replace: true,
      });
    },
    [activeImportance, navigate]
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

  const clearImportanceFilter = useCallback(() => {
    navigate({
      search: (prev: FindingsSearch) => ({
        ...prev,
        importance: undefined,
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
          {activeConfidence.length > 0 || activeImportance.length > 0
            ? ` of ${findings?.length ?? 0}`
            : ""}{" "}
          current
        </span>
      </div>

      <div className="rounded-[10px] border border-border bg-surface">
        <div className="border-b border-border-subtle px-3 py-2">
          <span className="text-[12px] font-medium text-text-secondary">
            Filters
          </span>
        </div>
        <div className="space-y-3 px-3 py-3">
          <FilterAxisBar
            label="Confidence"
            clearLabel="Any"
            isClearActive={activeConfidence.length === 0}
            onClear={clearConfidenceFilter}
            options={FINDING_CONFIDENCE_LEVELS.map((level) => ({
              key: level,
              active: activeConfidenceSet.has(level),
              onClick: () => toggleConfidence(level),
              content: (
                <Badge variant={level} className="text-[11px]">
                  {findingConfidenceLabel(level)}
                </Badge>
              ),
            }))}
          />
          <FilterAxisBar
            label="Importance"
            clearLabel="Any"
            isClearActive={activeImportance.length === 0}
            onClear={clearImportanceFilter}
            options={FINDING_IMPORTANCE_LEVELS.map((level) => ({
              key: level,
              active: activeImportanceSet.has(level),
              onClick: () => toggleImportance(level),
              content: <FindingImportanceBadge importance={level} />,
            }))}
          />
        </div>
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
                <FindingImportanceBadge importance={f.importance} />
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
            {activeConfidence.length > 0 || activeImportance.length > 0
              ? "No findings match the selected confidence and importance filters."
              : "No current findings."}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterAxisBar({
  label,
  clearLabel,
  isClearActive,
  onClear,
  options,
}: {
  label: string;
  clearLabel: string;
  isClearActive: boolean;
  onClear: () => void;
  options: {
    key: string;
    active: boolean;
    onClick: () => void;
    content: ReactNode;
  }[];
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[92px_minmax(0,1fr)] md:items-center">
      <span className="text-[12px] font-medium text-text-quaternary">{label}</span>
      <div className="overflow-hidden rounded-[10px] border border-border-subtle bg-surface-raised">
        <div
          className="grid divide-x divide-border-subtle"
          style={{ gridTemplateColumns: `repeat(${options.length + 1}, minmax(0, 1fr))` }}
        >
          <SegmentButton
            active={isClearActive}
            onClick={onClear}
            content={
              <span className="text-[11px] font-medium text-inherit">{clearLabel}</span>
            }
          />
          {options.map((option) => (
            <SegmentButton
              key={option.key}
              active={option.active}
              onClick={option.onClick}
              content={option.content}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  content,
}: {
  active: boolean;
  onClick: () => void;
  content: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[48px] items-center justify-center px-3 py-2 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
        active
          ? "bg-surface text-text shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_55%,transparent)]"
          : "bg-surface-raised text-text-quaternary hover:bg-surface hover:text-text-secondary",
      )}
    >
      {content}
    </button>
  );
}
