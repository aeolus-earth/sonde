import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  GitFork,
  Square,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { InlineMarkdownText } from "@/components/shared/inline-markdown-text";
import { cn } from "@/lib/utils";
import type { ExperimentSummary } from "@/types/sonde";

import type { StatusColorMap } from "../graph-builder";
import type { NodeAction } from "./types";

export type ExperimentNodeData = ExperimentSummary & {
  statusColors: StatusColorMap;
  hasChildren: boolean;
  childCount: number;
  isExpanded: boolean;
  depth: number;
  manageMode?: boolean;
  muted?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
  onSelect?: NodeAction;
};

export function ExperimentNode({ data }: NodeProps) {
  const d = data as unknown as ExperimentNodeData;
  return (
    <div
      className={cn(
        "w-[220px] rounded-[8px] border bg-surface transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]",
        d.selected
          ? "border-accent shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
          : "border-border",
        d.muted && "opacity-60",
      )}
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
              if (d.manageMode) {
                if (d.selectable === false) return;
                d.onSelect?.();
                return;
              }
              d.onOpen?.();
            }}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center justify-between gap-1">
              <div className="min-w-0 flex items-center gap-1.5">
                {d.manageMode && d.selectable !== false ? (
                  d.selected ? (
                    <CheckSquare2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : (
                    <Square className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  )
                ) : null}
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
              <InlineMarkdownText
                content={d.finding ?? d.hypothesis}
                className="mt-1 line-clamp-2 text-[10px] leading-snug text-text-tertiary"
              />
            )}
            {!d.isExpanded && d.childCount > 0 && (
              <p className="mt-1 text-[9px] text-text-quaternary">
                {d.childCount} child{d.childCount !== 1 ? "ren" : ""}
              </p>
            )}
          </button>
          {d.manageMode ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                d.onOpen?.();
              }}
              className="rounded-[4px] px-1.5 py-1 text-[10px] text-text-tertiary transition-colors hover:bg-surface-raised hover:text-text-secondary"
            >
              Open
            </button>
          ) : null}
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
