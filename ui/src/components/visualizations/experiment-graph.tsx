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
  type NodeMouseHandler,
  Handle,
  Position,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { ChevronRight, ChevronDown, GitFork } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStatusChartColors, useThemeCssColors } from "@/hooks/use-theme-css-colors";
import type { ExperimentSummary, ExperimentStatus } from "@/types/sonde";

type StatusColorMap = Record<ExperimentStatus, string>;

// ── Node dimensions ────────────────────────────────────────────

const EXP_W = 220;
const EXP_H = 76;
const DIR_W = 260;
const DIR_H = 52;

// ── Custom nodes ───────────────────────────────────────────────

function ExperimentNode({ data }: NodeProps) {
  const d = data as unknown as ExperimentSummary & {
    statusColors: StatusColorMap;
    hasChildren: boolean;
    childCount: number;
    isExpanded: boolean;
    depth: number;
  };
  return (
    <div
      className="w-[220px] rounded-[8px] border border-border bg-surface transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
      style={{ borderLeftWidth: 3, borderLeftColor: d.statusColors[d.status] }}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-border" />
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            {d.hasChildren && (
              <span className="text-text-quaternary">
                {d.isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </span>
            )}
            <span className="font-mono text-[11px] font-medium text-text">{d.id}</span>
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
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-border" />
    </div>
  );
}

function DirectionNode({ data }: NodeProps) {
  const d = data as unknown as {
    label: string;
    dirId: string;
    count: number;
    expanded: boolean;
    statusCounts: Record<string, number>;
    statusColors: StatusColorMap;
  };
  return (
    <div className="flex w-[260px] cursor-pointer items-center gap-2.5 rounded-[8px] border border-accent/20 bg-accent/5 px-3 py-2.5 transition-colors hover:border-accent/40">
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-accent" />
      <div className="flex h-5 w-5 shrink-0 items-center justify-center text-accent">
        {d.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-text">{d.label}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-text-quaternary">{d.dirId}</span>
          {!d.expanded && (
            <div className="flex items-center gap-1.5">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <span key={status} className="flex items-center gap-0.5 text-[10px]" style={{ color: d.statusColors[status as ExperimentStatus] }}>
                  <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                  {count}
                </span>
              ))}
            </div>
          )}
          {d.expanded && (
            <span className="text-[10px] text-text-quaternary">{d.count} exp{d.count !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function UngroupedNode({ data }: NodeProps) {
  const d = data as unknown as {
    count: number;
    expanded: boolean;
    statusCounts: Record<string, number>;
    statusColors: StatusColorMap;
  };
  return (
    <div className="flex w-[260px] cursor-pointer items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 transition-colors hover:border-border">
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-border" />
      <div className="flex h-5 w-5 shrink-0 items-center justify-center text-text-tertiary">
        {d.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-text-secondary">No direction</p>
        <div className="mt-0.5 flex items-center gap-2">
          {!d.expanded && (
            <div className="flex items-center gap-1.5">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <span key={status} className="flex items-center gap-0.5 text-[10px]" style={{ color: d.statusColors[status as ExperimentStatus] }}>
                  <span className="inline-block h-[5px] w-[5px] rounded-full bg-current" />
                  {count}
                </span>
              ))}
            </div>
          )}
          {d.expanded && (
            <span className="text-[10px] text-text-quaternary">{d.count} experiment{d.count !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  experiment: memo(ExperimentNode),
  direction: memo(DirectionNode),
  ungrouped: memo(UngroupedNode),
};

// ── Dagre layout ───────────────────────────────────────────────

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40, marginx: 60, marginy: 60 });

  for (const node of nodes) {
    const w = node.type === "experiment" ? EXP_W : DIR_W;
    const h = node.type === "experiment" ? EXP_H : DIR_H;
    g.setNode(node.id, { width: w + 20, height: h + 16 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      const w = node.type === "experiment" ? EXP_W : DIR_W;
      const h = node.type === "experiment" ? EXP_H : DIR_H;
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

/** Build a map of parent_id → children */
function buildChildMap(exps: ExperimentSummary[]): Map<string, ExperimentSummary[]> {
  const map = new Map<string, ExperimentSummary[]>();
  for (const e of exps) {
    if (e.parent_id) {
      if (!map.has(e.parent_id)) map.set(e.parent_id, []);
      map.get(e.parent_id)!.push(e);
    }
  }
  return map;
}

/** Count all descendants of an experiment */
function countDescendants(id: string, childMap: Map<string, ExperimentSummary[]>): number {
  const children = childMap.get(id) ?? [];
  let count = children.length;
  for (const c of children) count += countDescendants(c.id, childMap);
  return count;
}

/** Recursively add an experiment and its visible children to the graph */
function addExperimentSubtree(
  exp: ExperimentSummary,
  depth: number,
  parentNodeId: string,
  childMap: Map<string, ExperimentSummary[]>,
  expandedNodes: Set<string>,
  statusColor: StatusColorMap,
  borderColor: string,
  nodes: Node[],
  edges: Edge[]
) {
  const children = childMap.get(exp.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedNodes.has(exp.id);

  nodes.push({
    id: exp.id,
    type: "experiment",
    position: { x: 0, y: 0 },
    data: {
      ...exp,
      statusColors: statusColor,
      hasChildren,
      childCount: countDescendants(exp.id, childMap),
      isExpanded,
      depth,
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

  // Recurse into children if expanded
  if (isExpanded) {
    for (const child of children) {
      addExperimentSubtree(
        child, depth + 1, exp.id,
        childMap, expandedNodes, statusColor, borderColor,
        nodes, edges
      );
    }
  }
}

// ── Main component ─────────────────────────────────────────────

interface ExperimentGraphProps {
  experiments: ExperimentSummary[];
  directionNames: Map<string, string>;
  onNodeClick?: (id: string) => void;
}

export const ExperimentGraph = memo(function ExperimentGraph({
  experiments,
  directionNames,
  onNodeClick,
}: ExperimentGraphProps) {
  const colors = useThemeCssColors();
  const statusColor = useStatusChartColors();

  // Track expanded state for both direction groups and experiment nodes
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Build child map for parent→children lookup
  const childMap = useMemo(() => buildChildMap(experiments), [experiments]);

  // Identify root experiments (no parent, or parent not in this dataset)
  const experimentIds = useMemo(() => new Set(experiments.map((e) => e.id)), [experiments]);

  // Group ROOT experiments by direction (children appear under their parent, not under direction)
  const groups = useMemo(() => {
    const map = new Map<string | null, ExperimentSummary[]>();
    for (const exp of experiments) {
      // Only group root-level experiments (no parent or parent outside dataset)
      if (exp.parent_id && experimentIds.has(exp.parent_id)) continue;
      const key = exp.direction_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(exp);
    }
    return map;
  }, [experiments, experimentIds]);

  // Build the full graph
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return (directionNames.get(a) ?? a).localeCompare(directionNames.get(b) ?? b);
    });

    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    for (const dirKey of sortedKeys) {
      const rootExps = groups.get(dirKey)!;
      const headerId = dirKey ? `dir-${dirKey}` : "ungrouped";
      const isDirExpanded = expanded.has(headerId);

      // Count ALL experiments under this direction (including nested children)
      const allInDirection = experiments.filter((e) => e.direction_id === dirKey);

      if (dirKey) {
        rawNodes.push({
          id: headerId,
          type: "direction",
          position: { x: 0, y: 0 },
          data: {
            label: directionNames.get(dirKey) ?? dirKey,
            dirId: dirKey,
            count: allInDirection.length,
            expanded: isDirExpanded,
            statusCounts: countStatuses(allInDirection),
            statusColors: statusColor,
          } as Record<string, unknown>,
          draggable: true,
        });
      } else {
        rawNodes.push({
          id: headerId,
          type: "ungrouped",
          position: { x: 0, y: 0 },
          data: {
            count: allInDirection.length,
            expanded: isDirExpanded,
            statusCounts: countStatuses(allInDirection),
            statusColors: statusColor,
          } as Record<string, unknown>,
          draggable: true,
        });
      }

      // Add root experiments and their subtrees when direction is expanded
      if (isDirExpanded) {
        for (const exp of rootExps) {
          addExperimentSubtree(
            exp, 0, headerId,
            childMap, expanded, statusColor, colors.border,
            rawNodes, rawEdges
          );
        }
      }
    }

    return layoutGraph(rawNodes, rawEdges);
  }, [groups, experiments, directionNames, expanded, childMap, statusColor, colors.border]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "direction" || node.type === "ungrouped") {
        toggle(node.id);
      } else if (node.type === "experiment") {
        const d = node.data as unknown as { hasChildren: boolean };
        if (d.hasChildren) {
          // Toggle expand/collapse for experiments with children
          toggle(node.id);
        } else {
          // Navigate to detail for leaf experiments
          onNodeClick?.(node.id);
        }
      }
    },
    [toggle, onNodeClick]
  );

  // Double-click always navigates to detail
  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "experiment") {
        onNodeClick?.(node.id);
      }
    },
    [onNodeClick]
  );

  return (
    <div className="h-full w-full rounded-[8px] border border-border bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
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
            if (node.type === "direction") return colors.accent;
            if (node.type === "ungrouped") return colors.textQuaternary;
            const exp = node.data as unknown as ExperimentSummary;
            return statusColor[exp.status] ?? colors.textQuaternary;
          }}
          maskColor={colors.minimapMask}
          className="!rounded-[8px] !border-border !bg-surface"
        />
      </ReactFlow>
    </div>
  );
});
