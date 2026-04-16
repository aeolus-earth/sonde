import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Briefcase, ChevronDown, ChevronRight } from "lucide-react";

import type { NodeAction } from "./types";

export type ProjectNodeData = {
  label: string;
  projectId: string | null;
  count: number;
  expanded: boolean;
  directionCount: number;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

export function ProjectNode({ data }: NodeProps) {
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
