import { useState, useMemo, useCallback, memo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
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
import { sortFindingsByImportanceAndRecency } from "@/lib/finding-importance";
import type {
  DirectionSummary,
  ExperimentSummary,
  ExperimentStatus,
  Finding,
  FindingConfidence,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";

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

const EXP_W = 220;
const EXP_H = 76;
const PROJ_W = 280;
const PROJ_H = 56;
const DIR_W = 260;
const DIR_H = 52;
const QUESTION_W = 240;
const QUESTION_H = 56;
const FIND_W = 220;
const FIND_H = 70;

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

// ── Dagre layout ───────────────────────────────────────────────

function nodeBox(type: string | undefined): { w: number; h: number } {
  if (type === "experiment") return { w: EXP_W, h: EXP_H };
  if (type === "project") return { w: PROJ_W, h: PROJ_H };
  if (type === "question") return { w: QUESTION_W, h: QUESTION_H };
  if (type === "finding") return { w: FIND_W, h: FIND_H };
  return { w: DIR_W, h: DIR_H };
}

function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    ranksep: 88,
    nodesep: 44,
    marginx: 60,
    marginy: 60,
  });

  for (const node of nodes) {
    const { w, h } = nodeBox(node.type);
    g.setNode(node.id, { width: w + 20, height: h + 16 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      const { w, h } = nodeBox(node.type);
      return { ...node, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
    }),
    edges,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function countStatuses(exps: ExperimentSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of exps) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return counts;
}

function buildFindingsByExperiment(
  findings: Finding[],
): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    for (const experimentId of finding.evidence) {
      const list = map.get(experimentId) ?? [];
      list.push(finding);
      map.set(experimentId, list);
    }
  }
  for (const [experimentId, linkedFindings] of map.entries()) {
    map.set(experimentId, sortFindingsByImportanceAndRecency(linkedFindings));
  }
  return map;
}

function buildChildMap(
  exps: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const e of exps) {
    if (e.parent_id) {
      if (!map.has(e.parent_id)) map.set(e.parent_id, []);
      map.get(e.parent_id)!.push(e);
    }
  }
  return map;
}

function buildDirectionsByParent(
  directions: DirectionSummary[],
): Map<string, DirectionSummary[]> {
  const map = new Map<string, DirectionSummary[]>();
  for (const direction of directions) {
    if (!direction.parent_direction_id) continue;
    const list = map.get(direction.parent_direction_id) ?? [];
    list.push(direction);
    map.set(direction.parent_direction_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return map;
}

function buildDirectionsBySpawnExperiment(
  directions: DirectionSummary[],
): Map<string, DirectionSummary[]> {
  const map = new Map<string, DirectionSummary[]>();
  for (const direction of directions) {
    if (!direction.spawned_from_experiment_id) continue;
    const list = map.get(direction.spawned_from_experiment_id) ?? [];
    list.push(direction);
    map.set(direction.spawned_from_experiment_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return map;
}

function buildExperimentsByDirection(
  experiments: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const experiment of experiments) {
    if (!experiment.direction_id) continue;
    const list = map.get(experiment.direction_id) ?? [];
    list.push(experiment);
    map.set(experiment.direction_id, list);
  }
  return map;
}

function buildQuestionsByDirection(
  questions: QuestionSummary[],
): Map<string, QuestionSummary[]> {
  const map = new Map<string, QuestionSummary[]>();
  for (const question of questions) {
    if (!question.direction_id) continue;
    const list = map.get(question.direction_id) ?? [];
    list.push(question);
    map.set(question.direction_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return map;
}

function buildExperimentsByPrimaryQuestion(
  experiments: ExperimentSummary[],
): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const experiment of experiments) {
    if (!experiment.primary_question_id) continue;
    const list = map.get(experiment.primary_question_id) ?? [];
    list.push(experiment);
    map.set(experiment.primary_question_id, list);
  }
  return map;
}

function rootExperimentsForGroup(
  experiments: ExperimentSummary[],
): ExperimentSummary[] {
  const ids = new Set(experiments.map((experiment) => experiment.id));
  return experiments.filter(
    (experiment) => !experiment.parent_id || !ids.has(experiment.parent_id),
  );
}

function countDescendants(
  id: string,
  childMap: Map<string, ExperimentSummary[]>,
): number {
  const children = childMap.get(id) ?? [];
  let count = children.length;
  for (const c of children) count += countDescendants(c.id, childMap);
  return count;
}

function addExperimentSubtree(
  exp: ExperimentSummary,
  depth: number,
  parentNodeId: string,
  childMap: Map<string, ExperimentSummary[]>,
  expandedNodes: Set<string>,
  toggleNode: (key: string) => void,
  statusColor: StatusColorMap,
  borderColor: string,
  directionsByParent: Map<string, DirectionSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
  experimentsByDirection: Map<string, ExperimentSummary[]>,
  questionsByDirection: Map<string, QuestionSummary[]>,
  experimentsByQuestion: Map<string, ExperimentSummary[]>,
  findingsByExperiment: Map<string, Finding[]>,
  nodes: Node[],
  edges: Edge[],
  onQuestionOpen?: (id: string) => void,
  onExperimentOpen?: (id: string) => void,
  onDirectionOpen?: (id: string) => void,
  onFindingOpen?: (id: string) => void,
) {
  const children = childMap.get(exp.id) ?? [];
  const spawnedDirections = directionsBySpawnExperiment.get(exp.id) ?? [];
  const findings = findingsByExperiment.get(exp.id) ?? [];
  const hasChildren =
    children.length > 0 || spawnedDirections.length > 0 || findings.length > 0;
  const isExpanded = expandedNodes.has(exp.id);

  nodes.push({
    id: exp.id,
    type: "experiment",
    position: { x: 0, y: 0 },
    data: {
      ...exp,
      statusColors: statusColor,
      hasChildren,
      childCount:
        countDescendants(exp.id, childMap) +
        spawnedDirections.length +
        findings.length,
      isExpanded,
      depth,
      onToggle: hasChildren ? () => toggleNode(exp.id) : undefined,
      onOpen: () => onExperimentOpen?.(exp.id),
    } as Record<string, unknown>,
    draggable: true,
  });

  edges.push({
    id: `${parentNodeId}->${exp.id}`,
    source: parentNodeId,
    target: exp.id,
    type: "smoothstep",
    style: { stroke: borderColor, strokeWidth: 1 },
    animated: exp.status === "running",
  });

  if (isExpanded) {
    for (const finding of findings) {
      const findingNodeId = `finding-${finding.id}-for-${exp.id}`;
      nodes.push({
        id: findingNodeId,
        type: "finding",
        position: { x: 0, y: 0 },
        data: {
          ...finding,
          onOpen: () => onFindingOpen?.(finding.id),
        } as Record<string, unknown>,
        draggable: true,
      });

      edges.push({
        id: `${exp.id}->${findingNodeId}`,
        source: exp.id,
        target: findingNodeId,
        type: "smoothstep",
        style: { stroke: borderColor, strokeWidth: 1, strokeDasharray: "3 3" },
      });
    }

    for (const direction of spawnedDirections) {
      addDirectionSubtree(
        direction,
        exp.id,
        childMap,
        expandedNodes,
        toggleNode,
        statusColor,
        borderColor,
        directionsByParent,
        directionsBySpawnExperiment,
        experimentsByDirection,
        questionsByDirection,
        experimentsByQuestion,
        findingsByExperiment,
        nodes,
        edges,
        onQuestionOpen,
        onExperimentOpen,
        onDirectionOpen,
        onFindingOpen,
      );
    }

    for (const child of children) {
      addExperimentSubtree(
        child,
        depth + 1,
        exp.id,
        childMap,
        expandedNodes,
        toggleNode,
        statusColor,
        borderColor,
        directionsByParent,
        directionsBySpawnExperiment,
        experimentsByDirection,
        questionsByDirection,
        experimentsByQuestion,
        findingsByExperiment,
        nodes,
        edges,
        onQuestionOpen,
        onExperimentOpen,
        onDirectionOpen,
        onFindingOpen,
      );
    }
  }
}

function addQuestionSubtree(
  question: QuestionSummary,
  parentNodeId: string,
  childMap: Map<string, ExperimentSummary[]>,
  expandedNodes: Set<string>,
  toggleNode: (key: string) => void,
  statusColor: StatusColorMap,
  borderColor: string,
  directionsByParent: Map<string, DirectionSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
  experimentsByDirection: Map<string, ExperimentSummary[]>,
  questionsByDirection: Map<string, QuestionSummary[]>,
  experimentsByQuestion: Map<string, ExperimentSummary[]>,
  findingsByExperiment: Map<string, Finding[]>,
  nodes: Node[],
  edges: Edge[],
  onExperimentOpen?: (id: string) => void,
  onQuestionOpen?: (id: string) => void,
  onDirectionOpen?: (id: string) => void,
  onFindingOpen?: (id: string) => void,
) {
  const headerId = `question-${question.id}`;
  const isExpanded = expandedNodes.has(headerId);
  const questionExperiments = experimentsByQuestion.get(question.id) ?? [];
  const questionRoots = rootExperimentsForGroup(questionExperiments);
  const findingCount = question.linked_finding_count ?? 0;

  nodes.push({
    id: headerId,
    type: "question",
    position: { x: 0, y: 0 },
    data: {
      question: question.question,
      questionId: question.id,
      count: questionExperiments.length,
      findingCount,
      expanded: isExpanded,
      onToggle: () => toggleNode(headerId),
      onOpen: () => onQuestionOpen?.(question.id),
    } as Record<string, unknown>,
    draggable: true,
  });

  edges.push({
    id: `${parentNodeId}->${headerId}`,
    source: parentNodeId,
    target: headerId,
    type: "smoothstep",
    style: { stroke: borderColor, strokeWidth: 1 },
  });

  if (!isExpanded) return;

  for (const experiment of questionRoots) {
    addExperimentSubtree(
      experiment,
      0,
      headerId,
      childMap,
      expandedNodes,
      toggleNode,
      statusColor,
      borderColor,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      findingsByExperiment,
      nodes,
      edges,
      onQuestionOpen,
      onExperimentOpen,
      onDirectionOpen,
      onFindingOpen,
    );
  }
}

function addDirectionSubtree(
  direction: DirectionSummary,
  parentNodeId: string,
  childMap: Map<string, ExperimentSummary[]>,
  expandedNodes: Set<string>,
  toggleNode: (key: string) => void,
  statusColor: StatusColorMap,
  borderColor: string,
  directionsByParent: Map<string, DirectionSummary[]>,
  directionsBySpawnExperiment: Map<string, DirectionSummary[]>,
  experimentsByDirection: Map<string, ExperimentSummary[]>,
  questionsByDirection: Map<string, QuestionSummary[]>,
  experimentsByQuestion: Map<string, ExperimentSummary[]>,
  findingsByExperiment: Map<string, Finding[]>,
  nodes: Node[],
  edges: Edge[],
  onQuestionOpen?: (id: string) => void,
  onExperimentOpen?: (id: string) => void,
  onDirectionOpen?: (id: string) => void,
  onFindingOpen?: (id: string) => void,
) {
  const headerId = `dir-${direction.id}`;
  const isExpanded = expandedNodes.has(headerId);
  const directionExperiments = experimentsByDirection.get(direction.id) ?? [];
  const directionQuestions = questionsByDirection.get(direction.id) ?? [];
  const directionRoots = rootExperimentsForGroup(
    directionExperiments.filter(
      (experiment) => !experiment.primary_question_id,
    ),
  );

  nodes.push({
    id: headerId,
    type: "direction",
    position: { x: 0, y: 0 },
    data: {
      label: direction.title,
      dirId: direction.id,
      count: directionExperiments.length,
      expanded: isExpanded,
      statusCounts: countStatuses(directionExperiments),
      statusColors: statusColor,
      onToggle: () => toggleNode(headerId),
      onOpen: () => onDirectionOpen?.(direction.id),
    } as Record<string, unknown>,
    draggable: true,
  });

  edges.push({
    id: `${parentNodeId}->${headerId}`,
    source: parentNodeId,
    target: headerId,
    type: "smoothstep",
    style: { stroke: borderColor, strokeWidth: 1 },
  });

  if (!isExpanded) return;

  for (const question of directionQuestions) {
    addQuestionSubtree(
      question,
      headerId,
      childMap,
      expandedNodes,
      toggleNode,
      statusColor,
      borderColor,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      findingsByExperiment,
      nodes,
      edges,
      onExperimentOpen,
      onQuestionOpen,
      onDirectionOpen,
      onFindingOpen,
    );
  }

  for (const experiment of directionRoots) {
    addExperimentSubtree(
      experiment,
      0,
      headerId,
      childMap,
      expandedNodes,
      toggleNode,
      statusColor,
      borderColor,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      findingsByExperiment,
      nodes,
      edges,
      onQuestionOpen,
      onExperimentOpen,
      onDirectionOpen,
      onFindingOpen,
    );
  }

  const childDirections = directionsByParent.get(direction.id) ?? [];
  for (const childDirection of childDirections) {
    addDirectionSubtree(
      childDirection,
      headerId,
      childMap,
      expandedNodes,
      toggleNode,
      statusColor,
      borderColor,
      directionsByParent,
      directionsBySpawnExperiment,
      experimentsByDirection,
      questionsByDirection,
      experimentsByQuestion,
      findingsByExperiment,
      nodes,
      edges,
      onQuestionOpen,
      onExperimentOpen,
      onDirectionOpen,
      onFindingOpen,
    );
  }
}

function projectNodeId(raw: string | null): string {
  return raw === null ? "proj-unassigned" : `proj-${raw}`;
}

/** Resolve FK to a known project row; orphan ids bucket with unassigned. */
function bucketProjectId(
  projectId: string | null | undefined,
  knownIds: Set<string>,
): string | null {
  if (projectId == null) return null;
  return knownIds.has(projectId) ? projectId : null;
}

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

  const childMap = useMemo(() => buildChildMap(experiments), [experiments]);
  const directionsByParent = useMemo(
    () => buildDirectionsByParent(directions),
    [directions],
  );
  const directionsBySpawnExperiment = useMemo(
    () => buildDirectionsBySpawnExperiment(directions),
    [directions],
  );
  const questionsByDirection = useMemo(
    () => buildQuestionsByDirection(questions),
    [questions],
  );
  const experimentsByDirection = useMemo(
    () => buildExperimentsByDirection(experiments),
    [experiments],
  );
  const experimentsByQuestion = useMemo(
    () => buildExperimentsByPrimaryQuestion(experiments),
    [experiments],
  );
  const experimentIds = useMemo(
    () => new Set(experiments.map((e) => e.id)),
    [experiments],
  );

  const isRoot = useCallback(
    (e: ExperimentSummary) => !e.parent_id || !experimentIds.has(e.parent_id),
    [experimentIds],
  );

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    const projEdgeStyle = { stroke: colors.textTertiary, strokeWidth: 2 };

    const sortedProjects = [...projects].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const needsUnassigned =
      directions.some(
        (d) => bucketProjectId(d.project_id, knownProjectIds) === null,
      ) ||
      experiments.some(
        (e) =>
          bucketProjectId(e.project_id, knownProjectIds) === null && isRoot(e),
      );

    type PEntry = { id: string | null; label: string };
    const entries: PEntry[] = sortedProjects.map((p) => ({
      id: p.id,
      label: p.name,
    }));
    if (needsUnassigned) {
      entries.push({ id: null, label: "Unassigned" });
    }

    for (const p of entries) {
      const projectId = p.id;
      const bucketId = bucketProjectId(p.id, knownProjectIds);
      const pid = projectNodeId(bucketId);
      const isProjExpanded = expanded.has(pid);

      const allInProject = experiments.filter(
        (e) => bucketProjectId(e.project_id, knownProjectIds) === bucketId,
      );

      const dirsInProj = directions
        .filter(
          (d) =>
            bucketProjectId(d.project_id, knownProjectIds) === bucketId &&
            !d.parent_direction_id &&
            (!d.spawned_from_experiment_id ||
              !experimentIds.has(d.spawned_from_experiment_id)),
        )
        .sort((a, b) => a.title.localeCompare(b.title));

      rawNodes.push({
        id: pid,
        type: "project",
        position: { x: 0, y: 0 },
        data: {
          label: p.label,
          projectId: p.id,
          count: allInProject.length,
          directionCount: dirsInProj.length,
          expanded: isProjExpanded,
          onToggle: () => toggle(pid),
          onOpen:
            projectId === null
              ? undefined
              : () => onProjectNavigate?.(projectId),
        } as Record<string, unknown>,
        draggable: true,
      });

      if (!isProjExpanded) continue;

      for (const dir of dirsInProj) {
        addDirectionSubtree(
          dir,
          pid,
          childMap,
          expanded,
          toggle,
          statusColor,
          colors.border,
          directionsByParent,
          directionsBySpawnExperiment,
          experimentsByDirection,
          questionsByDirection,
          experimentsByQuestion,
          findingsByExperiment,
          rawNodes,
          rawEdges,
          onQuestionNavigate,
          onNodeClick,
          onDirectionNavigate,
          onFindingNavigate,
        );
      }

      const noDirExps = experiments.filter(
        (e) =>
          isRoot(e) &&
          e.direction_id === null &&
          bucketProjectId(e.project_id, knownProjectIds) === bucketId,
      );

      if (noDirExps.length > 0) {
        const nodirId = `nodir-${pid}`;
        const isNodirExpanded = expanded.has(nodirId);

        rawNodes.push({
          id: nodirId,
          type: "ungrouped",
          position: { x: 0, y: 0 },
          data: {
            count: noDirExps.length,
            expanded: isNodirExpanded,
            statusCounts: countStatuses(noDirExps),
            statusColors: statusColor,
            onToggle: () => toggle(nodirId),
          } as Record<string, unknown>,
          draggable: true,
        });

        rawEdges.push({
          id: `${pid}->${nodirId}`,
          source: pid,
          target: nodirId,
          type: "smoothstep",
          style: projEdgeStyle,
        });

        if (isNodirExpanded) {
          for (const exp of noDirExps) {
            addExperimentSubtree(
              exp,
              0,
              nodirId,
              childMap,
              expanded,
              toggle,
              statusColor,
              colors.border,
              directionsByParent,
              directionsBySpawnExperiment,
              experimentsByDirection,
              questionsByDirection,
              experimentsByQuestion,
              findingsByExperiment,
              rawNodes,
              rawEdges,
              onQuestionNavigate,
              onNodeClick,
              onDirectionNavigate,
              onFindingNavigate,
            );
          }
        }
      }
    }

    return layoutGraph(rawNodes, rawEdges);
  }, [
    projects,
    directions,
    experiments,
    expanded,
    childMap,
    directionsByParent,
    directionsBySpawnExperiment,
    experimentsByDirection,
    questionsByDirection,
    experimentsByQuestion,
    findingsByExperiment,
    experimentIds,
    statusColor,
    colors.border,
    colors.textTertiary,
    knownProjectIds,
    isRoot,
    onQuestionNavigate,
    onDirectionNavigate,
    onFindingNavigate,
    onNodeClick,
    onProjectNavigate,
    toggle,
  ]);

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
