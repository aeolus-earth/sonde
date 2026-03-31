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
import { ChevronRight, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStatusChartColors, useThemeCssColors } from "@/hooks/use-theme-css-colors";
import type { ExperimentSummary, ExperimentStatus } from "@/types/sonde";

// ── Node dimensions for dagre ──────────────────────────────────

const EXP_W = 220;
const EXP_H = 72;
const DIR_W = 260;
const DIR_H = 52;

// ── Custom nodes ───────────────────────────────────────────────

function ExperimentNode({ data }: NodeProps) {
  const exp = data as unknown as ExperimentSummary;
  const statusColor = useStatusChartColors();
  return (
    <div
      className="w-[220px] rounded-[8px] border border-border bg-surface transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
      style={{ borderLeftWidth: 3, borderLeftColor: statusColor[exp.status] }}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-border" />
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-medium text-text">{exp.id}</span>
          <Badge variant={exp.status}>{exp.status}</Badge>
        </div>
        {(exp.finding || exp.hypothesis) && (
          <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-text-tertiary">
            {exp.finding ?? exp.hypothesis}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-border" />
    </div>
  );
}

function DirectionNode({ data }: NodeProps) {
  const statusColor = useStatusChartColors();
  const d = data as unknown as {
    label: string;
    dirId: string;
    count: number;
    expanded: boolean;
    statusCounts: Record<string, number>;
  };
  return (
    <div className="flex w-[260px] cursor-pointer items-center gap-2.5 rounded-[8px] border border-accent/20 bg-accent/5 px-3 py-2.5 transition-colors hover:border-accent/40">
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-accent" />
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-accent">
        {d.expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-text">{d.label}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-text-quaternary">{d.dirId}</span>
          {!d.expanded && (
            <div className="flex items-center gap-1.5">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <span
                  key={status}
                  className="flex items-center gap-0.5 text-[10px]"
                  style={{ color: statusColor[status as ExperimentStatus] }}
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
      </div>
    </div>
  );
}

function UngroupedNode({ data }: NodeProps) {
  const statusColor = useStatusChartColors();
  const d = data as unknown as {
    count: number;
    expanded: boolean;
    statusCounts: Record<string, number>;
  };
  return (
    <div className="flex w-[260px] cursor-pointer items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 transition-colors hover:border-border">
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-border" />
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-text-tertiary">
        {d.expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-text-secondary">No direction</p>
        <div className="mt-0.5 flex items-center gap-2">
          {!d.expanded && (
            <div className="flex items-center gap-1.5">
              {Object.entries(d.statusCounts).map(([status, count]) => (
                <span
                  key={status}
                  className="flex items-center gap-0.5 text-[10px]"
                  style={{ color: statusColor[status as ExperimentStatus] }}
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

const nodeTypes = {
  experiment: memo(ExperimentNode),
  direction: memo(DirectionNode),
  ungrouped: memo(UngroupedNode),
};

// ── Dagre layout — generous spacing, no overlap ────────────────

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    ranksep: 80,
    nodesep: 40,
    marginx: 60,
    marginy: 60,
  });

  for (const node of nodes) {
    const w = node.type === "experiment" ? EXP_W : DIR_W;
    const h = node.type === "experiment" ? EXP_H : DIR_H;
    g.setNode(node.id, { width: w + 20, height: h + 16 }); // padding buffer
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positioned = nodes.map((node) => {
    const pos = g.node(node.id);
    const w = node.type === "experiment" ? EXP_W : DIR_W;
    const h = node.type === "experiment" ? EXP_H : DIR_H;
    return {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });

  return { nodes: positioned, edges };
}

// ── Status count helper ────────────────────────────────────────

function countStatuses(exps: ExperimentSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of exps) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
  }
  return counts;
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

  // Track which direction groups are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((dirKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      return next;
    });
  }, []);

  // Group experiments by direction
  const groups = useMemo(() => {
    const map = new Map<string | null, ExperimentSummary[]>();
    for (const exp of experiments) {
      const key = exp.direction_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(exp);
    }
    return map;
  }, [experiments]);

  // Build nodes and edges based on expanded state
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return (directionNames.get(a) ?? a).localeCompare(
        directionNames.get(b) ?? b
      );
    });

    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    for (const dirKey of sortedKeys) {
      const exps = groups.get(dirKey)!;
      const headerId = dirKey ? `dir-${dirKey}` : "ungrouped";
      const isExpanded = expanded.has(headerId);

      // Direction/group header node
      if (dirKey) {
        rawNodes.push({
          id: headerId,
          type: "direction",
          position: { x: 0, y: 0 },
          data: {
            label: directionNames.get(dirKey) ?? dirKey,
            dirId: dirKey,
            count: exps.length,
            expanded: isExpanded,
            statusCounts: countStatuses(exps),
          } as Record<string, unknown>,
          draggable: true,
        });
      } else {
        rawNodes.push({
          id: headerId,
          type: "ungrouped",
          position: { x: 0, y: 0 },
          data: {
            count: exps.length,
            expanded: isExpanded,
            statusCounts: countStatuses(exps),
          } as Record<string, unknown>,
          draggable: true,
        });
      }

      // Only show experiment children when expanded
      if (isExpanded) {
        for (const exp of exps) {
          rawNodes.push({
            id: exp.id,
            type: "experiment",
            position: { x: 0, y: 0 },
            data: { ...exp } as Record<string, unknown>,
            draggable: true,
          });

          rawEdges.push({
            id: `${headerId}->${exp.id}`,
            source: headerId,
            target: exp.id,
            type: "smoothstep",
            style: { stroke: colors.border, strokeWidth: 1 },
            animated: exp.status === "running",
          });
        }
      }
    }

    return layoutGraph(rawNodes, rawEdges);
  }, [groups, directionNames, expanded, colors.border]);

  // React Flow controlled state — enables drag
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-layout when expanded state changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Handle clicks — toggle groups, navigate experiments
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "direction" || node.type === "ungrouped") {
        toggle(node.id);
      } else if (node.type === "experiment") {
        onNodeClick?.(node.id);
      }
    },
    [toggle, onNodeClick]
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
