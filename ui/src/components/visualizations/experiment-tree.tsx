import { useMemo, useCallback, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@/components/ui/badge";
import { useThemeCssColors } from "@/hooks/use-theme-css-colors";
import type { ExperimentTreeNode, ExperimentStatus } from "@/types/sonde";

const statusColor: Record<ExperimentStatus, string> = {
  open: "border-status-open",
  running: "border-status-running",
  complete: "border-status-complete",
  failed: "border-status-failed",
  superseded: "border-border",
};

// Custom node — rendered once, memoized by React Flow internally
function ExperimentNode({ data }: NodeProps) {
  const node = data as unknown as ExperimentTreeNode;
  return (
    <div
      className={`rounded-lg border-2 bg-surface p-3 shadow-md ${statusColor[node.status]} min-w-[180px]`}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-text">
          {node.id}
        </span>
        <Badge variant={node.status}>{node.status}</Badge>
      </div>
      {node.branch_type && (
        <span className="mt-1 block text-[10px] text-text-tertiary">
          {node.branch_type}
        </span>
      )}
      {node.finding && (
        <p className="mt-2 line-clamp-2 text-xs text-text-secondary">
          {node.finding}
        </p>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-border"
      />
    </div>
  );
}

const nodeTypes = { experiment: memo(ExperimentNode) };

interface ExperimentTreeProps {
  nodes: ExperimentTreeNode[];
  onNodeClick?: (id: string) => void;
}

export const ExperimentTreeView = memo(function ExperimentTreeView({
  nodes: treeNodes,
  onNodeClick,
}: ExperimentTreeProps) {
  const colors = useThemeCssColors();

  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = treeNodes.map((n, i) => ({
      id: n.id,
      type: "experiment",
      position: { x: n.depth * 60, y: i * 120 },
      data: { ...n } as Record<string, unknown>,
    }));

    const rfEdges: Edge[] = treeNodes
      .filter((n) => n.parent_id)
      .map((n) => ({
        id: `${n.parent_id}-${n.id}`,
        source: n.parent_id!,
        target: n.id,
        style: { stroke: colors.border },
        animated: n.status === "running",
      }));

    return { nodes: rfNodes, edges: rfEdges };
  }, [treeNodes, colors.border]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onNodeClick?.(node.id),
    [onNodeClick]
  );

  return (
    <div className="h-full w-full rounded-lg border border-border bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={colors.surfaceHover} gap={20} />
        <Controls className="!bg-surface !border-border !shadow-none [&>button]:!bg-surface-raised [&>button]:!border-border [&>button]:!fill-text-tertiary" />
      </ReactFlow>
    </div>
  );
});
