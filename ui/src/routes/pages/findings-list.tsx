import { useCallback, useMemo, useState, type ReactNode } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import type { FindingsSearch } from "../findings";
import { useCurrentFindings } from "@/hooks/use-findings";
import { useFocusMode } from "@/hooks/use-focus";
import { useDeleteFindings } from "@/hooks/use-prune-mutations";
import { useRealtimeInvalidation } from "@/hooks/use-realtime";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { PruneConfirmDialog } from "@/components/prune/prune-confirm-dialog";
import { FocusToggle } from "@/components/shared/focus-toggle";
import { FindingConfidenceBadge } from "@/components/shared/finding-confidence-badge";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Button } from "@/components/ui/button";
import { TimeRangeBar } from "@/components/shared/time-range-bar";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { displaySourceLabel } from "@/lib/actor-source";
import {
  buildDirectFocusReasonMaps,
  isDirectFocusReason,
} from "@/lib/focus-mode";
import { buildBulkActionPreview } from "@/lib/prune-actions";
import {
  FINDING_CONFIDENCE_LEVELS,
  findingConfidenceLabel,
  parseFindingConfidenceFilter,
  serializeFindingConfidenceFilter,
} from "@/lib/finding-confidence";
import {
  FINDING_IMPORTANCE_LEVELS,
  findingImportanceLabel,
  parseFindingImportanceFilter,
  serializeFindingImportanceFilter,
  sortFindingsByImportanceAndRecency,
} from "@/lib/finding-importance";
import {
  buildFindingTimePoints,
  isFindingInTimeRange,
  resolveFindingTimeRangeSelection,
  serializeFindingTimeRangeValue,
} from "@/lib/finding-time-range";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Finding, FindingConfidence, FindingImportance } from "@/types/sonde";
import { Trash2 } from "lucide-react";

const routeApi = getRouteApi(ROUTE_API.authFindings);

const confidenceDotStyles: Record<FindingConfidence, string> = {
  very_low: "bg-confidence-very-low",
  low: "bg-confidence-low",
  medium: "bg-confidence-medium",
  high: "bg-confidence-high",
  very_high: "bg-confidence-very-high",
};

export default function FindingsListPage() {
  const navigate = routeApi.useNavigate();
  const { confidence, importance, from, to } = routeApi.useSearch();
  const { data: findings, isLoading } = useCurrentFindings();
  const {
    enabled: focusEnabled,
    setEnabled: setFocusEnabled,
    actorSource,
    canFocus,
    description: focusDescription,
    disabledReason,
    touchedRecordIds,
  } = useFocusMode();
  const deleteFindings = useDeleteFindings();
  const [pendingDelete, setPendingDelete] = useState<Finding | null>(null);
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
  const directFocusReasons = useMemo(
    () =>
      buildDirectFocusReasonMaps({
        projects: [],
        directions: [],
        questions: [],
        experiments: [],
        findings: findings ?? [],
        actorSource: actorSource ?? "",
        touchedRecordIds,
      }),
    [actorSource, findings, touchedRecordIds]
  );
  const focusActive = focusEnabled && canFocus;
  const baseFindings = useMemo(
    () =>
      focusActive
        ? (findings ?? []).filter((finding) =>
            isDirectFocusReason(directFocusReasons.findings.get(finding.id))
          )
        : (findings ?? []),
    [directFocusReasons.findings, findings, focusActive]
  );
  const timePoints = useMemo(
    () => buildFindingTimePoints(baseFindings),
    [baseFindings]
  );
  const activeTimeRange = useMemo(
    () => resolveFindingTimeRangeSelection(timePoints, from, to),
    [from, timePoints, to]
  );
  const hasActiveFilter =
    activeConfidence.length > 0 ||
    activeImportance.length > 0 ||
    activeTimeRange.isActive ||
    focusActive;
  const items = useMemo(() => {
    const source = sortFindingsByImportanceAndRecency(baseFindings);
    return source.filter((finding) => {
      const confidenceMatch =
        activeConfidenceSet.size === 0 ||
        activeConfidenceSet.has(finding.confidence);
      const importanceMatch =
        activeImportanceSet.size === 0 ||
        activeImportanceSet.has(finding.importance);
      const timeMatch = isFindingInTimeRange(finding, activeTimeRange);
      return confidenceMatch && importanceMatch && timeMatch;
    });
  }, [activeConfidenceSet, activeImportanceSet, activeTimeRange, baseFindings]);
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

  const updateTimeRange = useCallback(
    (fromIndex: number, toIndex: number) => {
      const maxIndex = timePoints.length - 1;
      const nextFromIndex = Math.max(0, Math.min(fromIndex, maxIndex));
      const nextToIndex = Math.max(0, Math.min(toIndex, maxIndex));
      const lowerIndex = Math.min(nextFromIndex, nextToIndex);
      const upperIndex = Math.max(nextFromIndex, nextToIndex);
      const isFullRange = lowerIndex === 0 && upperIndex === maxIndex;

      navigate({
        search: (prev: FindingsSearch) => ({
          ...prev,
          from: isFullRange
            ? undefined
            : serializeFindingTimeRangeValue(timePoints[lowerIndex]),
          to: isFullRange
            ? undefined
            : serializeFindingTimeRangeValue(timePoints[upperIndex]),
        }),
        replace: true,
      });
    },
    [navigate, timePoints]
  );

  const clearTimeRange = useCallback(() => {
    navigate({
      search: (prev: FindingsSearch) => ({
        ...prev,
        from: undefined,
        to: undefined,
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
          {hasActiveFilter ? ` of ${baseFindings.length}` : ""}{" "}
          current
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FocusToggle
          enabled={focusEnabled}
          canFocus={canFocus}
          description={focusDescription}
          disabledReason={disabledReason}
          onToggle={() => setFocusEnabled(!focusEnabled)}
          compact
        />
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
              <span className="inline-flex items-center gap-1.5 text-inherit">
                <span
                  className={cn(
                    "h-[6px] w-[6px] rounded-full",
                    confidenceDotStyles[level],
                  )}
                />
                <span>{findingConfidenceLabel(level)}</span>
              </span>
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
            content: (
              <span className="inline-flex items-center gap-1.5 text-inherit">
                <span className="h-[6px] w-[6px] rounded-full bg-current/70" />
                <span>{findingImportanceLabel(level)}</span>
              </span>
            ),
          }))}
        />
        {timePoints.length > 0 && (
          <TimeRangeBar
            points={timePoints}
            fromIndex={activeTimeRange.fromIndex}
            toIndex={activeTimeRange.toIndex}
            isActive={activeTimeRange.isActive}
            onChange={updateTimeRange}
            onClear={clearTimeRange}
          />
        )}
      </div>

      <div className="rounded-[8px] border border-border bg-surface">
        {items.map((f, idx) => (
          <div
            key={f.id}
            className={`group flex items-start gap-3 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover ${focusedIndex === idx ? "ring-1 ring-inset ring-accent bg-surface-hover" : ""}`}
          >
            <button
              type="button"
              onClick={() => handleClick(f.id)}
              className="flex min-w-0 flex-1 items-start gap-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-text-quaternary">
                    {f.id}
                  </span>
                  <FindingConfidenceBadge confidence={f.confidence} />
                  <FindingImportanceBadge importance={f.importance} />
                </div>
                <p className="mt-0.5 text-[13px] font-medium text-text">
                  {f.topic}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-tertiary">
                  {f.finding}
                </p>
                <p
                  className="mt-1 text-[11px] text-text-quaternary"
                  title={f.source}
                >
                  Created by {displaySourceLabel(f.source, actorSource)}
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
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label={`Delete ${f.id}`}
              onClick={() => setPendingDelete(f)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            {focusActive
              ? "No focused findings match the selected filters."
              : hasActiveFilter
                ? "No findings match the selected confidence, importance, and time filters."
                : "No current findings."}
          </div>
        )}
      </div>

      {pendingDelete ? (
        <PruneConfirmDialog
          open
          kind="finding"
          action="delete"
          title={`Delete ${pendingDelete.id}?`}
          description="This removes the finding, repairs supersession links if needed, and queues any linked artifacts for cleanup."
          preview={buildBulkActionPreview(
            { kind: "finding", action: "delete" },
            {
              questions: [],
              findings: [pendingDelete.id],
              experiments: [],
            },
            new Map(),
          )}
          isPending={deleteFindings.isPending}
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            const result = await deleteFindings.mutateAsync({
              ids: [pendingDelete.id],
            });
            if (result.summary.applied > 0) {
              setPendingDelete(null);
            }
          }}
        />
      ) : null}
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
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-text-quaternary">{label}</span>
      <div className="flex h-8 shrink-0 overflow-hidden rounded-[5.5px] border border-border bg-surface">
        <SegmentButton
          active={isClearActive}
          onClick={onClear}
          content={
            <span className="text-[12px] font-medium text-inherit">{clearLabel}</span>
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
        "flex h-full min-w-0 items-center justify-center px-2.5 text-[12px] leading-none transition-colors first:rounded-l-[5.5px] last:rounded-r-[5.5px] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
        active
          ? "bg-surface-hover text-text"
          : "text-text-quaternary hover:text-text-tertiary",
      )}
    >
      {content}
    </button>
  );
}
