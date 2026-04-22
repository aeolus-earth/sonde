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
import { useActiveProgram } from "@/stores/program";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResearchTree,
  type TreeNavigateTarget,
} from "@/components/visualizations/research-tree";
import { buildTimelineVisibleTreeData } from "@/lib/tree-timeline-visibility";
import { formatDateTimeShort } from "@/lib/utils";
import { Pause, Play } from "lucide-react";
import type {
  DirectionSummary,
  ExperimentSummary,
  Finding,
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
  const activeProgram = useActiveProgram();
  const navigate = routeApi.useNavigate();
  const [viewMode, setViewMode] = useState<"tree" | "map">("tree");
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineSpeedIndex, setTimelineSpeedIndex] = useState(1);

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

  const visibleProjects = visibleTreeData.projects;
  const visibleDirections = visibleTreeData.directions;
  const visibleQuestions = visibleTreeData.questions;
  const visibleExperiments = visibleTreeData.experiments;
  const visibleFindings = visibleTreeData.findings;

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
        <p className="mt-1 text-[12px] text-text-secondary">
          Program → project → direction → question → experiment. Findings stay
          attached to the experiments that support them.
        </p>
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
              />
            </Suspense>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-text-quaternary">
            No projects, directions, or experiments in this program yet.
          </div>
        )}
      </div>
    </div>
  );
}
