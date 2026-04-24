import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ExperimentStatus } from "@/types/sonde";

import type { StatusColorMap } from "../graph-builder";
import type { NodeAction } from "./types";

export type UngroupedNodeData = {
  count: number;
  expanded: boolean;
  statusCounts: Record<string, number>;
  statusColors: StatusColorMap;
  muted?: boolean;
  onToggle?: NodeAction;
};

export function UngroupedNode({ data }: NodeProps) {
  const d = data as unknown as UngroupedNodeData;
  return (
    <div
      className={
        d.muted
          ? "flex w-[260px] items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 opacity-60 transition-colors hover:border-border"
          : "flex w-[260px] items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 transition-colors hover:border-border"
      }
    >
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
