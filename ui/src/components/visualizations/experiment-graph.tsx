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
import { Briefcase, ChevronRight, ChevronDown, GitFork } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useStatusChartColors, useThemeCssColors } from "@/hooks/use-theme-css-colors";
import type {
  DirectionSummary,
  ExperimentSummary,
  ExperimentStatus,
  ProjectSummary,
} from "@/types/sonde";

type StatusColorMap = Record<ExperimentStatus, string>;

// ── Node dimensions ────────────────────────────────────────────

const EXP_W = 220;
const EXP_H = 76;
const PROJ_W = 280;
const PROJ_H = 56;
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

function ProjectNode({ data }: NodeProps) {
  const d = data as unknown as {
    label: string;
    projectId: string | null;
    count: number;
    expanded: boolean;
    directionCount: number;
  };
  return (
    <div className="relative w-[280px] rounded-[8px] border-2 border-border bg-bg px-3 py-2.5 shadow-sm transition-colors hover:border-border-subtle">
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-border" />
      <div className="flex cursor-pointer items-center gap-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-surface-raised text-text-secondary">
          <Briefcase className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-text">{d.label}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {d.projectId && (
              <span className="font-mono text-[10px] text-text-quaternary">{d.projectId}</span>
            )}
            {!d.expanded && (
              <span className="text-[10px] text-text-quaternary">
                {d.directionCount} dir · {d.count} exp
              </span>
            )}
            {d.expanded && (
              <span className="text-[10px] text-text-quaternary">{d.count} experiment{d.count !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-text-quaternary">
          {d.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
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
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-accent" />
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
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-border" />
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
  project: memo(ProjectNode),
  direction: memo(DirectionNode),
  ungrouped: memo(UngroupedNode),
};

// ── Dagre layout ───────────────────────────────────────────────

function nodeBox(type: string | undefined): { w: number; h: number } {
  if (type === "experiment") return { w: EXP_W, h: EXP_H };
  if (type === "project") return { w: PROJ_W, h: PROJ_H };
  return { w: DIR_W, h: DIR_H };
}

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 88, nodesep: 44, marginx: 60, marginy: 60 });

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

function countDescendants(id: string, childMap: Map<string, ExperimentSummary[]>): number {
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

  if (isExpanded) {
    for (const child of children) {
      addExperimentSubtree(
        child,
        depth + 1,
        exp.id,
        childMap,
        expandedNodes,
        statusColor,
        borderColor,
        nodes,
        edges
      );
    }
  }
}

function projectNodeId(raw: string | null): string {
  return raw === null ? "proj-unassigned" : `proj-${raw}`;
}

/** Resolve FK to a known project row; orphan ids bucket with unassigned. */
function bucketProjectId(
  projectId: string | null | undefined,
  knownIds: Set<string>
): string | null {
  if (projectId == null) return null;
  return knownIds.has(projectId) ? projectId : null;
}

// ── Main component ─────────────────────────────────────────────

interface ExperimentGraphProps {
  experiments: ExperimentSummary[];
  directions: DirectionSummary[];
  projects: ProjectSummary[];
  onNodeClick?: (id: string) => void;
  onProjectNavigate?: (projectId: string) => void;
}

export const ExperimentGraph = memo(function ExperimentGraph({
  experiments,
  directions,
  projects,
  onNodeClick,
  onProjectNavigate,
}: ExperimentGraphProps) {
  const colors = useThemeCssColors();
  const statusColor = useStatusChartColors();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const childMap = useMemo(() => buildChildMap(experiments), [experiments]);
  const experimentIds = useMemo(() => new Set(experiments.map((e) => e.id)), [experiments]);
  const knownProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);

  const isRoot = useCallback(
    (e: ExperimentSummary) => !e.parent_id || !experimentIds.has(e.parent_id),
    [experimentIds]
  );

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    const projEdgeStyle = { stroke: colors.textTertiary, strokeWidth: 2 };

    const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));

    const needsUnassigned =
      directions.some((d) => bucketProjectId(d.project_id, knownProjectIds) === null) ||
      experiments.some(
        (e) => bucketProjectId(e.project_id, knownProjectIds) === null && isRoot(e)
      );

    type PEntry = { id: string | null; label: string };
    const entries: PEntry[] = sortedProjects.map((p) => ({ id: p.id, label: p.name }));
    if (needsUnassigned) {
      entries.push({ id: null, label: "Unassigned" });
    }

    for (const p of entries) {
      const bucketId = bucketProjectId(p.id, knownProjectIds);
      const pid = projectNodeId(bucketId);
      const isProjExpanded = expanded.has(pid);

      const allInProject = experiments.filter(
        (e) => bucketProjectId(e.project_id, knownProjectIds) === bucketId
      );

      const dirsInProj = directions
        .filter((d) => bucketProjectId(d.project_id, knownProjectIds) === bucketId && !d.parent_direction_id)
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
        } as Record<string, unknown>,
        draggable: true,
      });

      if (!isProjExpanded) continue;

      for (const dir of dirsInProj) {
        const headerId = `dir-${dir.id}`;
        const isDirExpanded = expanded.has(headerId);
        const rootExps = experiments.filter((e) => isRoot(e) && e.direction_id === dir.id);
        const allInDirection = experiments.filter((e) => e.direction_id === dir.id);

        rawNodes.push({
          id: headerId,
          type: "direction",
          position: { x: 0, y: 0 },
          data: {
            label: dir.title,
            dirId: dir.id,
            count: allInDirection.length,
            expanded: isDirExpanded,
            statusCounts: countStatuses(allInDirection),
            statusColors: statusColor,
          } as Record<string, unknown>,
          draggable: true,
        });

        rawEdges.push({
          id: `${pid}->${headerId}`,
          source: pid,
          target: headerId,
          type: "smoothstep",
          style: projEdgeStyle,
        });

        if (isDirExpanded) {
          for (const exp of rootExps) {
            addExperimentSubtree(
              exp,
              0,
              headerId,
              childMap,
              expanded,
              statusColor,
              colors.border,
              rawNodes,
              rawEdges
            );
          }

          // Add child (sub) directions under this parent direction
          const childDirs = directions.filter((d) => d.parent_direction_id === dir.id);
          for (const childDir of childDirs) {
            const subHeaderId = `dir-${childDir.id}`;
            const isSubDirExpanded = expanded.has(subHeaderId);
            const subDirExps = experiments.filter((e) => e.direction_id === childDir.id);
            const subDirRootExps = subDirExps.filter((e) => isRoot(e));

            rawNodes.push({
              id: subHeaderId,
              type: "direction",
              position: { x: 0, y: 0 },
              data: {
                label: childDir.title,
                dirId: childDir.id,
                count: subDirExps.length,
                expanded: isSubDirExpanded,
                statusCounts: countStatuses(subDirExps),
                statusColors: statusColor,
              } as Record<string, unknown>,
              draggable: true,
            });

            rawEdges.push({
              id: `${headerId}->${subHeaderId}`,
              source: headerId,
              target: subHeaderId,
              type: "smoothstep",
              style: projEdgeStyle,
            });

            if (isSubDirExpanded) {
              for (const exp of subDirRootExps) {
                addExperimentSubtree(
                  exp,
                  0,
                  subHeaderId,
                  childMap,
                  expanded,
                  statusColor,
                  colors.border,
                  rawNodes,
                  rawEdges
                );
              }
            }
          }
        }
      }

      const noDirExps = experiments.filter(
        (e) =>
          isRoot(e) &&
          e.direction_id === null &&
          bucketProjectId(e.project_id, knownProjectIds) === bucketId
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
              statusColor,
              colors.border,
              rawNodes,
              rawEdges
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
    statusColor,
    colors.border,
    colors.textTertiary,
    knownProjectIds,
    isRoot,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "project") {
        toggle(node.id);
      } else if (node.type === "direction" || node.type === "ungrouped") {
        toggle(node.id);
      } else if (node.type === "experiment") {
        const d = node.data as unknown as { hasChildren: boolean };
        if (d.hasChildren) {
          toggle(node.id);
        } else {
          onNodeClick?.(node.id);
        }
      }
    },
    [toggle, onNodeClick]
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "experiment") {
        onNodeClick?.(node.id);
      } else if (node.type === "project") {
        const d = node.data as unknown as { projectId: string | null };
        if (d.projectId && onProjectNavigate) {
          onProjectNavigate(d.projectId);
        }
      }
    },
    [onNodeClick, onProjectNavigate]
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
            if (node.type === "project") return colors.textTertiary;
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
