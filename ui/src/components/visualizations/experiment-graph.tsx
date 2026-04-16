import { useState, useMemo, useCallback, memo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Briefcase,
  ChevronRight,
  ChevronDown,
  CircleHelp,
  GitFork,
  Lightbulb,
} from "lucide-react";
import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Badge } from "@/components/ui/badge";
import {
  useStatusChartColors,
  useThemeCssColors,
} from "@/hooks/use-theme-css-colors";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import type {
  DirectionSummary,
  ExperimentSummary,
  ExperimentStatus,
  Finding,
  FindingConfidence,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";
import {
  bucketProjectId,
  buildExperimentGraph,
  buildFindingsByExperiment,
  projectNodeId,
} from "./experiment-graph/graph-builder";

type StatusColorMap = Record<ExperimentStatus, string>;
type NodeAction = (() => void) | undefined;

type ExperimentNodeData = ExperimentSummary & {
  statusColors: StatusColorMap;
  hasChildren: boolean;
  childCount: number;
  isExpanded: boolean;
  depth: number;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

type ProjectNodeData = {
  label: string;
  projectId: string | null;
  count: number;
  expanded: boolean;
  directionCount: number;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

type DirectionNodeData = {
  label: string;
  dirId: string;
  count: number;
  expanded: boolean;
  statusCounts: Record<string, number>;
  statusColors: StatusColorMap;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

type QuestionNodeData = {
  question: string;
  questionId: string;
  count: number;
  findingCount: number;
  expanded: boolean;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

type UngroupedNodeData = {
  count: number;
  expanded: boolean;
  statusCounts: Record<string, number>;
  statusColors: StatusColorMap;
  onToggle?: NodeAction;
};

type FindingNodeData = Finding & {
  onOpen?: NodeAction;
};

// ── Node dimensions ────────────────────────────────────────────

// Dimensions live in ./experiment-graph/graph-builder.ts (NODE_DIMENSIONS)
// so the layout engine and the node-component widths stay in lockstep.
// Keep the inline pixel values in each node component consistent with
// NODE_DIMENSIONS when tweaking sizes.

// ── Custom nodes ───────────────────────────────────────────────

function ExperimentNode({ data }: NodeProps) {
  const d = data as unknown as ExperimentNodeData;
  return (
    <div
      className="w-[220px] rounded-[8px] border border-border bg-surface transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
      style={{ borderLeftWidth: 3, borderLeftColor: d.statusColors[d.status] }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <div className="px-2.5 py-2">
        <div className="flex items-start gap-2">
          {d.hasChildren ? (
            <button
              type="button"
              aria-label={d.isExpanded ? `Collapse ${d.id}` : `Expand ${d.id}`}
              onClick={(event) => {
                event.stopPropagation();
                d.onToggle?.();
              }}
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-text-quaternary transition-colors hover:bg-surface-raised hover:text-text-secondary"
            >
              {d.isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              d.onOpen?.();
            }}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center justify-between gap-1">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="truncate font-mono text-[11px] font-medium text-text">
                  {d.id}
                </span>
              </div>
              <Badge variant={d.status}>{d.status}</Badge>
            </div>
            {d.branch_type && (
              <div className="mt-0.5 flex items-center gap-1 text-[9px] text-text-quaternary">
                <GitFork className="h-2.5 w-2.5" />
                {d.branch_type}
              </div>
            )}
            {(d.finding || d.hypothesis) && (
              <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-text-tertiary">
                {d.finding ?? d.hypothesis}
              </p>
            )}
            {!d.isExpanded && d.childCount > 0 && (
              <p className="mt-1 text-[9px] text-text-quaternary">
                {d.childCount} child{d.childCount !== 1 ? "ren" : ""}
              </p>
            )}
          </button>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !bg-border"
      />
    </div>
  );
}

function ProjectNode({ data }: NodeProps) {
  const d = data as unknown as ProjectNodeData;
  return (
    <div className="relative w-[280px] rounded-[8px] border-2 border-border bg-bg px-3 py-2.5 shadow-sm transition-colors hover:border-border-subtle">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <div className="flex items-center gap-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-surface-raised text-text-secondary">
          <Briefcase className="h-3.5 w-3.5" />
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            d.onOpen?.();
          }}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-[12px] font-semibold text-text">
            {d.label}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {d.projectId && (
              <span className="font-mono text-[10px] text-text-quaternary">
                {d.projectId}
              </span>
            )}
            {!d.expanded && (
              <span className="text-[10px] text-text-quaternary">
                {d.directionCount} dir · {d.count} exp
              </span>
            )}
            {d.expanded && (
              <span className="text-[10px] text-text-quaternary">
                {d.count} experiment{d.count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </button>
        <button
          type="button"
          aria-label={d.expanded ? `Collapse ${d.label}` : `Expand ${d.label}`}
          onClick={(event) => {
            event.stopPropagation();
            d.onToggle?.();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-text-quaternary transition-colors hover:bg-surface-raised hover:text-text-secondary"
        >
          {d.expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !bg-border"
      />
    </div>
  );
}

function DirectionNode({ data }: NodeProps) {
  const d = data as unknown as DirectionNodeData;
  return (
    <div className="flex w-[260px] items-center gap-2.5 rounded-[8px] border border-accent/20 bg-accent/5 px-3 py-2.5 transition-colors hover:border-accent/40">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-accent"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !bg-accent"
      />
      <button
        type="button"
        aria-label={d.expanded ? `Collapse ${d.dirId}` : `Expand ${d.dirId}`}
        onClick={(event) => {
          event.stopPropagation();
          d.onToggle?.();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-accent transition-colors hover:bg-accent/10"
      >
        {d.expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          d.onOpen?.();
        }}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[12px] font-medium text-text">{d.label}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-text-quaternary">{d.dirId}</span>
          {!d.expanded && (
            <div className="flex items-center gap-1.5">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <span
                  key={status}
                  className="flex items-center gap-0.5 text-[10px]"
                  style={{ color: d.statusColors[status as ExperimentStatus] }}
                >
                  <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                  {count}
                </span>
              ))}
            </div>
          )}
          {d.expanded && (
            <span className="text-[10px] text-text-quaternary">
              {d.count} exp{d.count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

function QuestionNode({ data }: NodeProps) {
  const d = data as unknown as QuestionNodeData;
  return (
    <div className="flex w-[240px] items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 transition-colors hover:border-border">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <button
        type="button"
        aria-label={
          d.expanded ? `Collapse ${d.questionId}` : `Expand ${d.questionId}`
        }
        onClick={(event) => {
          event.stopPropagation();
          d.onToggle?.();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-text-tertiary transition-colors hover:bg-surface hover:text-text-secondary"
      >
        {d.expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          d.onOpen?.();
        }}
        className="min-w-0 flex-1 text-left"
      >
        <p className="line-clamp-2 text-[11px] font-medium text-text">
          {d.question}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-quaternary">
            {d.questionId}
          </span>
          <span className="text-[10px] text-text-quaternary">
            {d.count} exp · {d.findingCount} findings
          </span>
        </div>
      </button>
      <CircleHelp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
    </div>
  );
}

function UngroupedNode({ data }: NodeProps) {
  const d = data as unknown as UngroupedNodeData;
  return (
    <div className="flex w-[260px] items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 transition-colors hover:border-border">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <button
        type="button"
        aria-label={
          d.expanded
            ? "Collapse unlinked experiments"
            : "Expand unlinked experiments"
        }
        onClick={(event) => {
          event.stopPropagation();
          d.onToggle?.();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-text-tertiary transition-colors hover:bg-surface hover:text-text-secondary"
      >
        {d.expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-text-secondary">
          No direction
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          {!d.expanded && (
            <div className="flex items-center gap-1.5">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <span
                  key={status}
                  className="flex items-center gap-0.5 text-[10px]"
                  style={{ color: d.statusColors[status as ExperimentStatus] }}
                >
                  <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                  {count}
                </span>
              ))}
            </div>
          )}
          {d.expanded && (
            <span className="text-[10px] text-text-quaternary">
              {d.count} experiment{d.count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function confidenceVariant(
  confidence: FindingConfidence,
): FindingConfidence {
  return confidence;
}

function FindingNode({ data }: NodeProps) {
  const d = data as unknown as FindingNodeData;
  return (
    <div className="w-[220px] rounded-[8px] border border-border-subtle bg-surface-raised transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          d.onOpen?.();
        }}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-bg text-text-tertiary">
          <Lightbulb className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px] font-medium text-text">
              {d.id}
            </span>
            <div className="flex items-center gap-1.5">
              <FindingImportanceBadge
                importance={d.importance}
                className="px-1.5 py-0.5"
              />
              <Badge variant={confidenceVariant(d.confidence)}>
                {findingConfidenceLabel(d.confidence)}
              </Badge>
            </div>
          </div>
          <p className="mt-0.5 truncate text-[10px] font-medium text-text-secondary">
            {d.topic}
          </p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-text-tertiary">
            {d.finding}
          </p>
        </div>
      </button>
    </div>
  );
}

const nodeTypes = {
  experiment: memo(ExperimentNode),
  project: memo(ProjectNode),
  direction: memo(DirectionNode),
  question: memo(QuestionNode),
  ungrouped: memo(UngroupedNode),
  finding: memo(FindingNode),
};


// ── Main component ─────────────────────────────────────────────

interface ExperimentGraphProps {
  experiments: ExperimentSummary[];
  directions: DirectionSummary[];
  projects: ProjectSummary[];
  findings: Finding[];
  questions: QuestionSummary[];
  onNodeClick?: (id: string) => void;
  onQuestionNavigate?: (questionId: string) => void;
  onProjectNavigate?: (projectId: string) => void;
  onDirectionNavigate?: (directionId: string) => void;
  onFindingNavigate?: (findingId: string) => void;
}

export const ExperimentGraph = memo(function ExperimentGraph({
  experiments,
  directions,
  projects,
  findings,
  questions,
  onNodeClick,
  onQuestionNavigate,
  onProjectNavigate,
  onDirectionNavigate,
  onFindingNavigate,
}: ExperimentGraphProps) {
  const colors = useThemeCssColors();
  const statusColor = useStatusChartColors();
  const knownProjectIds = useMemo(
    () => new Set(projects.map((p) => p.id)),
    [projects],
  );
  const findingsByExperiment = useMemo(
    () => buildFindingsByExperiment(findings),
    [findings],
  );
  const expandAllKeys = useMemo(() => {
    const keys = new Set<string>();

    const needsUnassigned =
      directions.some(
        (d) => bucketProjectId(d.project_id, knownProjectIds) === null,
      ) ||
      experiments.some(
        (e) => bucketProjectId(e.project_id, knownProjectIds) === null,
      );

    for (const project of projects) {
      keys.add(projectNodeId(project.id));
      keys.add(`nodir-${projectNodeId(project.id)}`);
    }
    if (needsUnassigned) {
      keys.add(projectNodeId(null));
      keys.add(`nodir-${projectNodeId(null)}`);
    }
    for (const direction of directions) {
      keys.add(`dir-${direction.id}`);
    }
    for (const question of questions) {
      keys.add(`question-${question.id}`);
    }
    for (const experiment of experiments) {
      if (
        experiments.some(
          (candidate) => candidate.parent_id === experiment.id,
        ) ||
        directions.some(
          (direction) => direction.spawned_from_experiment_id === experiment.id,
        ) ||
        (findingsByExperiment.get(experiment.id)?.length ?? 0) > 0
      ) {
        keys.add(experiment.id);
      }
    }
    return keys;
  }, [
    projects,
    directions,
    experiments,
    questions,
    knownProjectIds,
    findingsByExperiment,
  ]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(expandAllKeys),
  );
  const [hasUserAdjustedExpansion, setHasUserAdjustedExpansion] =
    useState(false);

  useEffect(() => {
    if (hasUserAdjustedExpansion) return;
    setExpanded(new Set(expandAllKeys));
  }, [expandAllKeys, hasUserAdjustedExpansion]);

  const toggle = useCallback((key: string) => {
    setHasUserAdjustedExpansion(true);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Single call into the pure graph builder — replaces 200 lines of
  // per-subtree recursion + manual orphan filtering. The builder
  // guarantees that no edge reaches React Flow without both endpoints
  // also in `nodes`; see ./experiment-graph/graph-builder.ts.
  const { nodes: initialNodes, edges: initialEdges, droppedOrphanEdges } =
    useMemo(
      () =>
        buildExperimentGraph({
          projects,
          directions,
          experiments,
          questions,
          findings,
          expanded,
          toggle,
          statusColor,
          borderColor: colors.border,
          projectEdgeColor: colors.textTertiary,
          navigation: {
            onExperimentOpen: onNodeClick,
            onQuestionOpen: onQuestionNavigate,
            onDirectionOpen: onDirectionNavigate,
            onFindingOpen: onFindingNavigate,
            onProjectOpen: onProjectNavigate,
          },
          knownProjectIds,
        }),
      [
        projects,
        directions,
        experiments,
        questions,
        findings,
        expanded,
        knownProjectIds,
        statusColor,
        colors.border,
        colors.textTertiary,
        toggle,
        onNodeClick,
        onQuestionNavigate,
        onDirectionNavigate,
        onFindingNavigate,
        onProjectNavigate,
      ],
    );

  useEffect(() => {
    if (droppedOrphanEdges > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[experiment-graph] dropped ${droppedOrphanEdges} orphan edge(s) ` +
          `(references to nodes not in the rendered set)`,
      );
    }
  }, [droppedOrphanEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setHasUserAdjustedExpansion(true);
            setExpanded(new Set(expandAllKeys));
          }}
          className="inline-flex items-center rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => {
            setHasUserAdjustedExpansion(true);
            setExpanded(new Set());
          }}
          className="inline-flex items-center rounded-[5.5px] border border-border-subtle bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          Collapse all
        </button>
      </div>
      <div className="h-full w-full min-h-0 rounded-[8px] border border-border bg-bg">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onlyRenderVisibleElements
          nodesDraggable
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
          minZoom={0.05}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: colors.border, strokeWidth: 1 },
          }}
        >
          <Background color={colors.surfaceHover} gap={24} size={1} />
          <Controls
            showInteractive={false}
            className="!rounded-[5.5px] !border-border !bg-surface !shadow-none [&>button]:!rounded-[3px] [&>button]:!border-border [&>button]:!bg-surface-raised [&>button]:!fill-text-tertiary"
          />
          <MiniMap
            nodeColor={(node) => {
              if (node.type === "project") return colors.textTertiary;
              if (node.type === "direction") return colors.accent;
              if (node.type === "ungrouped") return colors.textQuaternary;
              if (node.type === "finding") return colors.textTertiary;
              const exp = node.data as unknown as ExperimentSummary;
              return statusColor[exp.status] ?? colors.textQuaternary;
            }}
            maskColor={colors.minimapMask}
            className="!rounded-[8px] !border-border !bg-surface"
          />
        </ReactFlow>
      </div>
    </div>
  );
});
