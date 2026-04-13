import { cn } from "@/lib/utils";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import type { FindingConfidence } from "@/types/sonde";

const confidenceStyles: Record<FindingConfidence, string> = {
  very_low:
    "border-confidence-very-low/30 bg-confidence-very-low/12 text-confidence-very-low shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
  low:
    "border-confidence-low/30 bg-confidence-low/12 text-confidence-low shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
  medium:
    "border-confidence-medium/30 bg-confidence-medium/12 text-confidence-medium shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
  high:
    "border-confidence-high/30 bg-confidence-high/12 text-confidence-high shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
  very_high:
    "border-confidence-very-high/30 bg-confidence-very-high/12 text-confidence-very-high shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-bg)_60%,transparent)]",
};

export function FindingConfidenceBadge({
  confidence,
  className,
  labelStyle = "full",
}: {
  confidence: FindingConfidence;
  className?: string;
  labelStyle?: "full" | "short";
}) {
  const prefix = labelStyle === "short" ? "conf" : "confidence";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-medium leading-none tracking-[0.01em]",
        confidenceStyles[confidence],
        className,
      )}
    >
      <span className="h-[6px] w-[6px] rounded-full bg-current/75" />
      <span className="opacity-80">{prefix}</span>
      <span>{findingConfidenceLabel(confidence)}</span>
    </span>
  );
}
