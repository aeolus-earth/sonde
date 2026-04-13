import { cn } from "@/lib/utils";
import { findingImportanceLabel } from "@/lib/finding-importance";
import type { FindingImportance } from "@/types/sonde";

const importanceStyles: Record<FindingImportance, string> = {
  high: "border-importance-high/30 bg-importance-high/14 text-importance-high",
  medium:
    "border-importance-medium/30 bg-importance-medium/14 text-importance-medium",
  low: "border-importance-low/30 bg-importance-low/14 text-importance-low",
};

export function FindingImportanceBadge({
  importance,
  className,
}: {
  importance: FindingImportance;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[72px] items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-medium leading-none tracking-[0.01em]",
        importanceStyles[importance],
        className,
      )}
    >
      {findingImportanceLabel(importance)}
    </span>
  );
}
