import { useState, useMemo, useCallback, memo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useStatusChartColors,
  useThemeCssColors,
} from "@/hooks/use-theme-css-colors";
import type {
  DirectionSummary,
  ExperimentSummary,
  Finding,
  ProjectSummary,
  QuestionSummary,
} from "@/types/sonde";
import type { Node } from "@xyflow/react";
import {
  bucketProjectId,
  buildExperimentGraph,
  buildFindingsByExperiment,
  projectNodeId,
  stabilizeNodes,
  type HandlerFactories,
} from "./experiment-graph/graph-builder";
import { nodeTypes } from "./experiment-graph/node-types";

/**
 * MiniMap iterates every node on every viewport change and renders a
 * thumbnail too small to navigate on. Past ~500 nodes the cost
 * outweighs the usefulness, so we hide it for large graphs. Users who
 * need an overview can zoom out; a dedicated "show overview" toggle
 * is a follow-up if it comes up.
 */
const MINIMAP_NODE_THRESHOLD = 500;

/**
 * Build a factory that returns a stable-per-id callback. Backed by a
 * persistent `Map` (via `useRef`) so the same id returns the same
 * closure across builds — see the `HandlerFactories` docstring for
 * why that matters for performance.
 *
 * `inner` should be a stable reference (memoized via `useCallback` in
 * the caller). If it changes, existing cached closures stay valid —
 * they close over the *call site*, not the identity of `inner` at
 * cache time; refreshing is a deliberate no-op to avoid invalidating
 * the whole cache on unrelated parent re-renders.
 */
function useIdKeyedCallback<Arg = string>(
  inner: ((arg: Arg) => void) | undefined,
): (arg: Arg) => () => void {
  const innerRef = useRef(inner);
  innerRef.current = inner;
  const cacheRef = useRef(new Map<Arg, () => void>());
  return useCallback((arg: Arg) => {
    const cached = cacheRef.current.get(arg);
    if (cached) return cached;
    const fn = () => {
      innerRef.current?.(arg);
    };
    cacheRef.current.set(arg, fn);
    return fn;
  }, []);
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

  // Stable-per-id handler factories. Each call for a given id returns
  // the same closure across builds, so node `data` objects keep the
  // same `onToggle` / `onOpen` references and React Flow's
  // `memo(NodeComponent)` shallow compare can skip the render.
  // See `HandlerFactories` in graph-builder.ts for the rationale.
  const toggleFor = useIdKeyedCallback(toggle);
  const openExperimentFor = useIdKeyedCallback(onNodeClick);
  const openQuestionFor = useIdKeyedCallback(onQuestionNavigate);
  const openDirectionFor = useIdKeyedCallback(onDirectionNavigate);
  const openFindingFor = useIdKeyedCallback(onFindingNavigate);
  const openProjectFor = useIdKeyedCallback(onProjectNavigate);

  const handlers = useMemo<HandlerFactories>(
    () => ({
      toggleFor,
      openExperimentFor,
      openQuestionFor,
      openDirectionFor,
      openFindingFor,
      openProjectFor,
    }),
    [
      toggleFor,
      openExperimentFor,
      openQuestionFor,
      openDirectionFor,
      openFindingFor,
      openProjectFor,
    ],
  );

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
          handlers,
          statusColor,
          borderColor: colors.border,
          projectEdgeColor: colors.textTertiary,
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
        handlers,
      ],
    );

  useEffect(() => {
    if (droppedOrphanEdges > 0) {
      console.warn(
        `[experiment-graph] dropped ${droppedOrphanEdges} orphan edge(s) ` +
          `(references to nodes not in the rendered set)`,
      );
    }
  }, [droppedOrphanEdges]);

  // Stabilize node object references across builds. When a node's
  // data is logically unchanged, reuse the previous `Node` wrapper so
  // React Flow can fast-path through its internal diff. Combined with
  // the handler-identity factories (Commit 2) this means that a
  // single-subtree expansion touches only the nodes in that subtree
  // — the other 999 in a 1000-node graph skip reconciliation
  // entirely.
  const previousNodesRef = useRef<Map<string, Node> | null>(null);
  const stabilizedNodes = useMemo(() => {
    const stable = stabilizeNodes(previousNodesRef.current, initialNodes);
    previousNodesRef.current = new Map(stable.map((n) => [n.id, n]));
    return stable;
  }, [initialNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(stabilizedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(stabilizedNodes);
    setEdges(initialEdges);
  }, [stabilizedNodes, initialEdges, setNodes, setEdges]);

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
          {nodes.length < MINIMAP_NODE_THRESHOLD ? (
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
          ) : null}
        </ReactFlow>
      </div>
    </div>
  );
});
