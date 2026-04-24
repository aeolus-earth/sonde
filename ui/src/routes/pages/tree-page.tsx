import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useAllExperimentsForTree } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
import { useQuestions } from "@/hooks/use-questions";
import { useProjects } from "@/hooks/use-projects";
import { usePrograms } from "@/hooks/use-programs";
import { useFindings } from "@/hooks/use-findings";
import { useFocusMode } from "@/hooks/use-focus";
import { FocusToggle } from "@/components/shared/focus-toggle";
import {
  useDeleteFindings,
  useDeleteQuestions,
  useTransitionExperiments,
} from "@/hooks/use-prune-mutations";
import { useActiveProgram } from "@/stores/program";
import { PruneActionBar } from "@/components/prune/prune-action-bar";
import { PruneConfirmDialog } from "@/components/prune/prune-confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResearchTree,
  type TreeNavigateTarget,
} from "@/components/visualizations/research-tree";
import {
  buildBulkActionPreview,
  emptyPruneSelection,
  experimentActionConfirmLabel,
  intersectPruneSelection,
  isExperimentActionEligible,
  removeAppliedFromSelection,
  samePruneSelection,
  togglePruneSelection,
  type BulkActionIntent,
} from "@/lib/prune-actions";
import {
  buildFocusedWorkspaceData,
  isDirectFocusReason,
} from "@/lib/focus-mode";
import { buildTimelineVisibleTreeData } from "@/lib/tree-timeline-visibility";
import { formatDateTimeShort } from "@/lib/utils";
import { CheckSquare2, Pause, Play } from "lucide-react";
import type {
  DirectionSummary,
  ExperimentSummary,
  Finding,
  PruneSelection,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

const ExperimentGraph = lazy(() =>
  import("@/components/visualizations/experiment-graph").then((m) => ({
    default: m.ExperimentGraph,
  })),
);

const routeApi = getRouteApi(ROUTE_API.authTree);

type TimelineEvent = {
  at: string;
  label: string;
};

const TIMELINE_SPEEDS = [
  { label: "0.5x", ms: 1200 },
  { label: "1x", ms: 700 },
  { label: "2x", ms: 350 },
] as const;

function buildTimelineEvents(
  projects: ProjectSummary[],
  directions: DirectionSummary[],
  questions: QuestionSummary[],
  experiments: ExperimentSummary[],
  findings: Finding[],
): TimelineEvent[] {
  const seen = new Set<string>();
  const all = [
    ...projects.map((item) => item.created_at),
    ...directions.map((item) => item.created_at),
    ...questions.map((item) => item.created_at),
    ...experiments.map((item) => item.created_at),
    ...findings.map((item) => item.created_at),
  ]
    .filter((at) => {
      if (!at || seen.has(at)) return false;
      seen.add(at);
      return true;
    })
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return all.map((at) => ({ at, label: formatDateTimeShort(at) }));
}

export default function TreePage() {
  const { data: experiments, isLoading: loadingExp } =
    useAllExperimentsForTree();
  const { data: directions, isLoading: loadingDir } = useDirections();
  const { data: questions, isLoading: loadingQuestions } = useQuestions();
  const { data: projects, isLoading: loadingProj } = useProjects();
  const { data: findings, isLoading: loadingFindings } = useFindings();
  const { data: programs } = usePrograms();
  const {
    enabled: focusEnabled,
    setEnabled: setFocusEnabled,
    actorSource,
    canFocus,
    description: focusDescription,
    disabledReason,
    touchedRecordIds,
  } = useFocusMode();
  const activeProgram = useActiveProgram();
  const navigate = routeApi.useNavigate();
  const [viewMode, setViewMode] = useState<"tree" | "map">("tree");
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineSpeedIndex, setTimelineSpeedIndex] = useState(1);
  const [manageMode, setManageMode] = useState(false);
  const [selection, setSelection] = useState<PruneSelection>(
    emptyPruneSelection(),
  );
  const [pendingAction, setPendingAction] = useState<BulkActionIntent | null>(
    null,
  );
  const deleteQuestions = useDeleteQuestions();
  const deleteFindings = useDeleteFindings();
  const transitionExperiments = useTransitionExperiments();

  const programLabel =
    programs?.find((p) => p.id === activeProgram)?.name ?? activeProgram;

  const timelineEvents = useMemo(
    () =>
      buildTimelineEvents(
        projects ?? [],
        directions ?? [],
        questions ?? [],
        experiments ?? [],
        findings ?? [],
      ),
    [projects, directions, questions, experiments, findings],
  );

  useEffect(() => {
    if (timelineEvents.length === 0) {
      setTimelineIndex(0);
      setIsPlaying(false);
      return;
    }
    setTimelineIndex((prev) => Math.min(prev, timelineEvents.length - 1));
  }, [timelineEvents]);

  useEffect(() => {
    if (!timelineEvents.length) return;
    setTimelineIndex(timelineEvents.length - 1);
  }, [activeProgram, timelineEvents.length]);

  useEffect(() => {
    if (!isPlaying || timelineEvents.length <= 1) return;
    if (timelineIndex >= timelineEvents.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setInterval(() => {
      setTimelineIndex((prev) => {
        if (prev >= timelineEvents.length - 1) {
          window.clearInterval(timer);
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, TIMELINE_SPEEDS[timelineSpeedIndex]?.ms ?? TIMELINE_SPEEDS[1].ms);
    return () => window.clearInterval(timer);
  }, [isPlaying, timelineEvents, timelineIndex, timelineSpeedIndex]);

  const timelineCutoff = timelineEvents[timelineIndex]?.at ?? null;
  const timelineSpeed =
    TIMELINE_SPEEDS[timelineSpeedIndex] ?? TIMELINE_SPEEDS[1];

  const visibleTreeData = useMemo(
    () =>
      buildTimelineVisibleTreeData({
        projects: projects ?? [],
        directions: directions ?? [],
        questions: questions ?? [],
        experiments: experiments ?? [],
        findings: findings ?? [],
        cutoff: timelineCutoff,
      }),
    [projects, directions, questions, experiments, findings, timelineCutoff],
  );

  const focusActive = focusEnabled && canFocus && !!actorSource;
  const focusedTreeData = useMemo(
    () =>
      focusActive
        ? buildFocusedWorkspaceData({
            projects: visibleTreeData.projects,
            directions: visibleTreeData.directions,
            questions: visibleTreeData.questions,
            experiments: visibleTreeData.experiments,
            findings: visibleTreeData.findings,
            actorSource,
            touchedRecordIds,
          })
        : null,
    [actorSource, focusActive, touchedRecordIds, visibleTreeData],
  );

  const visibleProjects = focusedTreeData?.projects ?? visibleTreeData.projects;
  const visibleDirections =
    focusedTreeData?.directions ?? visibleTreeData.directions;
  const visibleQuestions =
    focusedTreeData?.questions ?? visibleTreeData.questions;
  const visibleExperiments =
    focusedTreeData?.experiments ?? visibleTreeData.experiments;
  const visibleFindings = focusedTreeData?.findings ?? visibleTreeData.findings;
  const focusReasons = focusedTreeData?.reasons ?? null;
  const visibleExperimentIds = useMemo(
    () => new Set(visibleExperiments.map((item) => item.id)),
    [visibleExperiments],
  );
  const visibleQuestionIds = useMemo(
    () => new Set(visibleQuestions.map((item) => item.id)),
    [visibleQuestions],
  );
  const visibleFindingIds = useMemo(
    () => new Set(visibleFindings.map((item) => item.id)),
    [visibleFindings],
  );
  const selectableExperimentIds = useMemo(
    () =>
      focusActive && focusReasons
        ? new Set(
            visibleExperiments
              .filter((item) =>
                isDirectFocusReason(focusReasons.experiments.get(item.id)),
              )
              .map((item) => item.id),
          )
        : visibleExperimentIds,
    [focusActive, focusReasons, visibleExperimentIds, visibleExperiments],
  );
  const selectableQuestionIds = useMemo(
    () =>
      focusActive && focusReasons
        ? new Set(
            visibleQuestions
              .filter((item) =>
                isDirectFocusReason(focusReasons.questions.get(item.id)),
              )
              .map((item) => item.id),
          )
        : visibleQuestionIds,
    [focusActive, focusReasons, visibleQuestionIds, visibleQuestions],
  );
  const selectableFindingIds = useMemo(
    () =>
      focusActive && focusReasons
        ? new Set(
            visibleFindings
              .filter((item) =>
                isDirectFocusReason(focusReasons.findings.get(item.id)),
              )
              .map((item) => item.id),
          )
        : visibleFindingIds,
    [focusActive, focusReasons, visibleFindingIds, visibleFindings],
  );
  const visibleExperimentsById = useMemo(
    () => new Map(visibleExperiments.map((item) => [item.id, item])),
    [visibleExperiments],
  );
  const experimentSelectionEligibility = useMemo(
    () => ({
      complete: selection.experiments.filter((id) => {
        const experiment = visibleExperimentsById.get(id);
        return experiment
          ? isExperimentActionEligible(experiment.status, "complete")
          : false;
      }).length,
      failed: selection.experiments.filter((id) => {
        const experiment = visibleExperimentsById.get(id);
        return experiment
          ? isExperimentActionEligible(experiment.status, "failed")
          : false;
      }).length,
      superseded: selection.experiments.filter((id) => {
        const experiment = visibleExperimentsById.get(id);
        return experiment
          ? isExperimentActionEligible(experiment.status, "superseded")
          : false;
      }).length,
    }),
    [selection.experiments, visibleExperimentsById],
  );
  const pendingPreview = useMemo(
    () =>
      pendingAction
        ? buildBulkActionPreview(pendingAction, selection, visibleExperimentsById)
        : null,
    [pendingAction, selection, visibleExperimentsById],
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      navigate({ to: "/experiments/$id", params: { id } });
    },
    [navigate],
  );

  const handleProjectNavigate = useCallback(
    (projectId: string) => {
      navigate({ to: "/projects/$id", params: { id: projectId } });
    },
    [navigate],
  );

  const handleDirectionNavigate = useCallback(
    (directionId: string) => {
      navigate({ to: "/directions/$id", params: { id: directionId } });
    },
    [navigate],
  );

  const handleQuestionNavigate = useCallback(
    (questionId: string) => {
      navigate({ to: "/questions/$id", params: { id: questionId } });
    },
    [navigate],
  );

  const handleFindingNavigate = useCallback(
    (findingId: string) => {
      navigate({ to: "/findings/$id", params: { id: findingId } });
    },
    [navigate],
  );

  const handleTreeNavigate = useCallback(
    (target: TreeNavigateTarget) => {
      if (target.kind === "experiment") {
        navigate({ to: "/experiments/$id", params: { id: target.id } });
      } else if (target.kind === "project") {
        navigate({ to: "/projects/$id", params: { id: target.id } });
      } else if (target.kind === "direction") {
        navigate({ to: "/directions/$id", params: { id: target.id } });
      } else if (target.kind === "question") {
        navigate({ to: "/questions/$id", params: { id: target.id } });
      } else {
        navigate({ to: "/findings/$id", params: { id: target.id } });
      }
    },
    [navigate],
  );

  const toggleQuestionSelection = useCallback((questionId: string) => {
    if (
      focusActive &&
      focusReasons &&
      !isDirectFocusReason(focusReasons.questions.get(questionId))
    ) {
      return;
    }
    setSelection((prev) =>
      togglePruneSelection(prev, "question", questionId),
    );
  }, [focusActive, focusReasons]);

  const toggleExperimentSelection = useCallback((experimentId: string) => {
    if (
      focusActive &&
      focusReasons &&
      !isDirectFocusReason(focusReasons.experiments.get(experimentId))
    ) {
      return;
    }
    setSelection((prev) =>
      togglePruneSelection(prev, "experiment", experimentId),
    );
  }, [focusActive, focusReasons]);

  const toggleFindingSelection = useCallback((findingId: string) => {
    if (
      focusActive &&
      focusReasons &&
      !isDirectFocusReason(focusReasons.findings.get(findingId))
    ) {
      return;
    }
    setSelection((prev) => togglePruneSelection(prev, "finding", findingId));
  }, [focusActive, focusReasons]);

  useEffect(() => {
    setSelection(emptyPruneSelection());
    setPendingAction(null);
    setManageMode(false);
  }, [activeProgram]);

  useEffect(() => {
    if (manageMode) return;
    setPendingAction(null);
    setSelection((prev) =>
      samePruneSelection(prev, emptyPruneSelection())
        ? prev
        : emptyPruneSelection(),
    );
  }, [manageMode]);

  useEffect(() => {
    if (!manageMode) return;
    setSelection((prev) => {
      const next = intersectPruneSelection(prev, {
        questions: selectableQuestionIds,
        findings: selectableFindingIds,
        experiments: selectableExperimentIds,
      });
      return samePruneSelection(prev, next) ? prev : next;
    });
  }, [
    manageMode,
    selectableExperimentIds,
    selectableFindingIds,
    selectableQuestionIds,
  ]);

  const handleConfirmAction = useCallback(async () => {
    if (!pendingAction || !pendingPreview) return;

    if (pendingAction.kind === "question") {
      const result = await deleteQuestions.mutateAsync({
        ids: pendingPreview.eligibleIds,
      });
      setSelection((prev) =>
        removeAppliedFromSelection(
          prev,
          "question",
          result.applied.map((item) => item.id),
        ),
      );
      setPendingAction(null);
      return;
    }

    if (pendingAction.kind === "finding") {
      const result = await deleteFindings.mutateAsync({
        ids: pendingPreview.eligibleIds,
      });
      setSelection((prev) =>
        removeAppliedFromSelection(
          prev,
          "finding",
          result.applied.map((item) => item.id),
        ),
      );
      setPendingAction(null);
      return;
    }

    const result = await transitionExperiments.mutateAsync({
      ids: pendingPreview.eligibleIds,
      status: pendingAction.action,
    });
    setSelection((prev) =>
      removeAppliedFromSelection(
        prev,
        "experiment",
        result.applied.map((item) => item.id),
      ),
    );
    setPendingAction(null);
  }, [
    deleteFindings,
    deleteQuestions,
    pendingAction,
    pendingPreview,
    transitionExperiments,
  ]);

  const isLoading =
    loadingExp ||
    loadingDir ||
    loadingQuestions ||
    loadingProj ||
    loadingFindings;

  const hasGraphData =
    (visibleExperiments.length ?? 0) > 0 ||
    (visibleDirections.length ?? 0) > 0 ||
    (visibleProjects.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Research tree
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <FocusToggle
              enabled={focusEnabled}
              canFocus={canFocus}
              description={focusDescription}
              disabledReason={disabledReason}
              onToggle={() => setFocusEnabled(!focusEnabled)}
              compact
            />
            <button
              type="button"
              className={
                manageMode
                  ? "inline-flex items-center gap-1.5 rounded-[6px] border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent"
                  : "inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
              }
              onClick={() => setManageMode((prev) => !prev)}
            >
              <CheckSquare2 className="h-3.5 w-3.5" />
              {manageMode ? "Manage on" : "Manage"}
            </button>
            <div
              className="flex shrink-0 rounded-[6px] border border-border bg-surface p-0.5"
              role="tablist"
              aria-label="View mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "tree"}
                className={
                  viewMode === "tree"
                    ? "rounded-[4px] bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text shadow-sm"
                    : "rounded-[4px] px-2.5 py-1 text-[11px] font-medium text-text-tertiary hover:text-text-secondary"
                }
                onClick={() => setViewMode("tree")}
              >
                Tree
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "map"}
                className={
                  viewMode === "map"
                    ? "rounded-[4px] bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text shadow-sm"
                    : "rounded-[4px] px-2.5 py-1 text-[11px] font-medium text-text-tertiary hover:text-text-secondary"
                }
                onClick={() => setViewMode("map")}
              >
                Map
              </button>
            </div>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-text-secondary">
          Program → project → direction → question → experiment. Findings stay
          attached to the experiments that support them.
        </p>
        {focusActive ? (
          <p className="mt-1 text-[11px] text-text-quaternary">
            Focus mode keeps direct matches bright and shows container context
            in a muted style so the structure still makes sense.
          </p>
        ) : null}
        {manageMode ? (
          <p className="mt-1 text-[11px] text-accent">
            Manage mode is on. Click questions, experiments, and finding
            chips/nodes to select them. Use the inline Open buttons to inspect a
            record without leaving selection mode.
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-text-quaternary">
          Program:{" "}
          <span className="font-medium text-text-secondary">
            {programLabel}
          </span>
          <span className="mx-1.5 text-text-quaternary">·</span>
          <span className="text-text-quaternary">
            Legend: project → direction → experiment forks
          </span>
        </p>
      </div>

      {timelineEvents.length > 0 && (
        <div className="rounded-[8px] border border-border bg-surface px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-text-secondary">
                Knowledge timeline
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (timelineIndex >= timelineEvents.length - 1) {
                    setTimelineIndex(0);
                  }
                  setIsPlaying((prev) => !prev);
                }}
                className="inline-flex items-center gap-1.5 rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
              >
                {isPlaying ? (
                  <Pause className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Play className="h-3.5 w-3.5 shrink-0" />
                )}
                {isPlaying
                  ? "Pause"
                  : timelineIndex >= timelineEvents.length - 1
                    ? "Replay"
                    : "Play"}
              </button>
              <button
                type="button"
                onClick={() =>
                  setTimelineSpeedIndex(
                    (prev) => (prev + 1) % TIMELINE_SPEEDS.length,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
              >
                Speed {timelineSpeed.label}
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-[12px] text-text-secondary">
              Visible through{" "}
              <span className="font-medium text-text">
                {timelineEvents[timelineIndex]?.label}
              </span>
            </span>
            <span className="text-[11px] text-text-quaternary">
              {visibleProjects.length} proj · {visibleDirections.length} dir ·{" "}
              {visibleQuestions.length} questions · {visibleExperiments.length}{" "}
              exp · {visibleFindings.length} findings
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span className="shrink-0 text-[10px] text-text-quaternary">
              {timelineEvents[0]?.label}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(timelineEvents.length - 1, 0)}
              step={1}
              value={timelineIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setTimelineIndex(Number(e.target.value));
              }}
              className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-border-subtle accent-accent"
              aria-label="Knowledge timeline"
            />
            <span className="shrink-0 text-[10px] text-text-quaternary">
              {timelineEvents[timelineEvents.length - 1]?.label}
            </span>
          </div>
        </div>
      )}

      <div className="h-[calc(100vh-10rem)]">
        {isLoading ? (
          <Skeleton className="h-full w-full rounded-[8px]" />
        ) : hasGraphData ? (
          viewMode === "tree" ? (
            <ResearchTree
              experiments={visibleExperiments}
              directions={visibleDirections}
              projects={visibleProjects}
              findings={visibleFindings}
              questions={visibleQuestions}
              expansionResetKey={activeProgram}
              manageMode={manageMode}
              selection={selection}
              focusMode={focusActive}
              focusReasons={focusReasons}
              onToggleQuestionSelection={toggleQuestionSelection}
              onToggleExperimentSelection={toggleExperimentSelection}
              onToggleFindingSelection={toggleFindingSelection}
              onNavigate={handleTreeNavigate}
            />
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Skeleton className="h-full w-full rounded-[8px]" />
                </div>
              }
            >
              <ExperimentGraph
                experiments={visibleExperiments}
                directions={visibleDirections}
                projects={visibleProjects}
                findings={visibleFindings}
                questions={visibleQuestions}
                onNodeClick={handleNodeClick}
                onQuestionNavigate={handleQuestionNavigate}
                onProjectNavigate={handleProjectNavigate}
                onDirectionNavigate={handleDirectionNavigate}
                onFindingNavigate={handleFindingNavigate}
                manageMode={manageMode}
                selection={selection}
                focusMode={focusActive}
                focusReasons={focusReasons}
                onToggleQuestionSelection={toggleQuestionSelection}
                onToggleExperimentSelection={toggleExperimentSelection}
                onToggleFindingSelection={toggleFindingSelection}
              />
            </Suspense>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-text-quaternary">
            No projects, directions, or experiments in this program yet.
          </div>
        )}
      </div>

      {manageMode ? (
        <PruneActionBar
          selection={selection}
          eligibleExperimentCounts={experimentSelectionEligibility}
          onAction={setPendingAction}
          onClear={() => setSelection(emptyPruneSelection())}
          onExit={() => setManageMode(false)}
        />
      ) : null}

      {pendingAction && pendingPreview ? (
        <PruneConfirmDialog
          open
          kind={pendingAction.kind}
          action={pendingAction.action}
          title={
            pendingAction.kind === "question"
              ? "Delete selected questions?"
              : pendingAction.kind === "finding"
                ? "Delete selected findings?"
                : pendingAction.action === "superseded"
                  ? "Archive selected experiments?"
                  : `${experimentActionConfirmLabel(pendingAction.action)}?`
          }
          description={
            pendingAction.kind === "question"
              ? "Questions will be removed from the question inbox and linked tree/map views."
              : pendingAction.kind === "finding"
                ? "Findings will be removed, supersession links will be repaired, and linked artifacts will be queued for cleanup."
                : pendingAction.action === "superseded"
                  ? "Only complete or failed experiments can be archived in this pass."
                  : "Only open or running experiments are eligible for close-out from this bulk workflow."
          }
          preview={pendingPreview}
          isPending={
            deleteQuestions.isPending ||
            deleteFindings.isPending ||
            transitionExperiments.isPending
          }
          onClose={() => setPendingAction(null)}
          onConfirm={handleConfirmAction}
        />
      ) : null}
    </div>
  );
}
