import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Lightbulb } from "lucide-react";

import { FindingImportanceBadge } from "@/components/shared/finding-importance-badge";
import { Badge } from "@/components/ui/badge";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import type { Finding, FindingConfidence } from "@/types/sonde";

import type { NodeAction } from "./types";

export type FindingNodeData = Finding & {
  onOpen?: NodeAction;
};

/**
 * Pass-through today; kept as a named helper so a future change
 * (mapping confidence → badge variant) has one place to live.
 */
function confidenceVariant(confidence: FindingConfidence): FindingConfidence {
  return confidence;
}

export function FindingNode({ data }: NodeProps) {
  const d = data as unknown as FindingNodeData;
  return (
    <div className="w-[220px] rounded-[8px] border border-border-subtle bg-surface-raised transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !bg-border"
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          d.onOpen?.();
        }}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-border-subtle bg-bg text-text-tertiary">
          <Lightbulb className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[11px] font-medium text-text">
              {d.id}
            </span>
            <div className="flex items-center gap-1.5">
              <FindingImportanceBadge
                importance={d.importance}
                className="px-1.5 py-0.5"
              />
              <Badge variant={confidenceVariant(d.confidence)}>
                {findingConfidenceLabel(d.confidence)}
              </Badge>
            </div>
          </div>
          <p className="mt-0.5 truncate text-[10px] font-medium text-text-secondary">
            {d.topic}
          </p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-text-tertiary">
            {d.finding}
          </p>
        </div>
      </button>
    </div>
  );
}
