import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, CircleHelp } from "lucide-react";

import type { NodeAction } from "./types";

export type QuestionNodeData = {
  question: string;
  questionId: string;
  count: number;
  findingCount: number;
  expanded: boolean;
  onToggle?: NodeAction;
  onOpen?: NodeAction;
};

export function QuestionNode({ data }: NodeProps) {
  const d = data as unknown as QuestionNodeData;
  return (
    <div className="flex w-[240px] items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-raised px-3 py-2.5 transition-colors hover:border-border">
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
          d.expanded ? `Collapse ${d.questionId}` : `Expand ${d.questionId}`
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
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          d.onOpen?.();
        }}
        className="min-w-0 flex-1 text-left"
      >
        <p className="line-clamp-2 text-[11px] font-medium text-text">
          {d.question}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-quaternary">
            {d.questionId}
          </span>
          <span className="text-[10px] text-text-quaternary">
            {d.count} exp · {d.findingCount} findings
          </span>
        </div>
      </button>
      <CircleHelp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
    </div>
  );
}
