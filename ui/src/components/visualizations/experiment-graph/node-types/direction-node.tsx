import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ExperimentStatus } from "@/types/sonde";

import type { StatusColorMap } from "../graph-builder";
import type { NodeAction } from "./types";

export type DirectionNodeData = {
  label: string;
  dirId: string;
  count: number;
  expanded: boolean;
  statusCounts: Record<string, number>;
  statusColors: StatusColorMap;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

export function DirectionNode({ data }: NodeProps) {
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
