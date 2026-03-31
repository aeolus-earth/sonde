import { memo } from "react";
import { cn } from "@/lib/utils";

const PALETTES = [
  "border-accent/35 bg-accent/12 text-accent",
  "border-status-running/35 bg-status-running/12 text-status-running",
  "border-status-complete/35 bg-status-complete/12 text-status-complete",
  "border-status-open/40 bg-status-open/12 text-status-open",
  "border-confidence-high/35 bg-confidence-high/10 text-confidence-high",
  "border-confidence-medium/40 bg-confidence-medium/12 text-confidence-medium",
] as const;

function paletteIndex(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h + tag.charCodeAt(i) * (i + 1)) % 1009;
  }
  return h % PALETTES.length;
}

interface TagChipProps {
  tag: string;
  className?: string;
  children?: React.ReactNode;
}

export const TagChip = memo(function TagChip({
  tag,
  className,
  children,
}: TagChipProps) {
  const idx = paletteIndex(tag);
  return (
    <span
      className={cn(
        "group inline-flex max-w-full items-center gap-0.5 rounded-[5px] border px-2 py-0.5 text-[11px] font-medium tracking-tight",
        PALETTES[idx],
        className
      )}
    >
      <span className="min-w-0 truncate">{tag}</span>
      {children}
    </span>
  );
});
