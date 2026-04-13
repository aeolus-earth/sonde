import { cn } from "@/lib/utils";
import { findingImportanceLabel } from "@/lib/finding-importance";
import type { FindingImportance } from "@/types/sonde";

const importanceStyles: Record<FindingImportance, string> = {
  high:
    "border-importance-high/30 bg-importance-high/14 text-importance-high shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
  medium:
    "border-importance-medium/30 bg-importance-medium/14 text-importance-medium shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
  low:
    "border-importance-low/30 bg-importance-low/14 text-importance-low shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
};

export function FindingImportanceBadge({
  importance,
  className,
  labelStyle = "full",
}: {
  importance: FindingImportance;
  className?: string;
  labelStyle?: "full" | "short" | "none";
}) {
  const prefix =
    labelStyle === "short"
      ? "imp"
      : labelStyle === "none"
        ? null
        : "importance";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-medium leading-none tracking-[0.01em]",
        importanceStyles[importance],
        className,
      )}
    >
      <span className="h-[6px] w-[6px] rounded-full bg-current/75" />
      {prefix ? <span className="opacity-80">{prefix}</span> : null}
      <span>{findingImportanceLabel(importance)}</span>
    </span>
  );
}
