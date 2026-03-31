import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 text-[11px] leading-none font-medium",
  {
    variants: {
      variant: {
        default: "text-text-tertiary",
        open: "text-status-open",
        running: "text-status-running",
        complete: "text-status-complete",
        failed: "text-status-failed",
        superseded: "text-text-quaternary",
        high: "text-confidence-high",
        medium: "text-confidence-medium",
        low: "text-confidence-low",
        tag: "rounded-[3px] bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-secondary",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot = true, ...props }: BadgeProps) {
  const showDot =
    dot &&
    variant &&
    ["open", "running", "complete", "failed", "superseded", "high", "medium", "low"].includes(
      variant
    );

  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {showDot && (
        <span className="inline-block h-[6px] w-[6px] rounded-full bg-current" />
      )}
      {props.children}
    </span>
  );
}
