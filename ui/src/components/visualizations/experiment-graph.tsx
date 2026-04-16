import { useState, useMemo, useCallback, memo, useEffect } from "react";
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
import {
  bucketProjectId,
  buildExperimentGraph,
  buildFindingsByExperiment,
  projectNodeId,
} from "./experiment-graph/graph-builder";
import { nodeTypes } from "./experiment-graph/node-types";

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
