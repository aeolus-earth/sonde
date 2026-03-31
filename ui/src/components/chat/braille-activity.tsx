import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Classic braille spinner (10 frames). */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Short “alive” wave patterns — multi-cell Braille that shifts for a subtle pulse. */
const LIVE_PATTERNS = [
  "⠂⠐⠠",
  "⠄⠈⠁",
  "⠆⠊⠉",
  "⠖⠒⠢",
  "⠢⠒⠖",
  "⠠⠐⠂",
] as const;

interface BrailleSpinnerProps {
  className?: string;
  intervalMs?: number;
}

export const BrailleSpinner = memo(function BrailleSpinner({
  className,
  intervalMs = 90,
}: BrailleSpinnerProps) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      () => setI((n) => (n + 1) % SPINNER.length),
      intervalMs
    );
    return () => window.clearInterval(t);
  }, [intervalMs]);

  return (
    <span
      className={cn(
        "inline-flex min-w-[1.1em] select-none items-center justify-center font-mono text-[13px] leading-none text-text-tertiary",
        className
      )}
      aria-hidden
    >
      {SPINNER[i]}
    </span>
  );
});

interface BrailleLiveProps {
  className?: string;
  intervalMs?: number;
}

/** Three-cell braille that cycles for a “live” / thinking feel. */
export const BrailleLive = memo(function BrailleLive({
  className,
  intervalMs = 220,
}: BrailleLiveProps) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      () => setI((n) => (n + 1) % LIVE_PATTERNS.length),
      intervalMs
    );
    return () => window.clearInterval(t);
  }, [intervalMs]);

  return (
    <span
      className={cn(
        "inline-flex select-none items-center font-mono text-[12px] leading-none tracking-[0.15em] text-text-tertiary",
        className
      )}
      aria-hidden
    >
      {LIVE_PATTERNS[i]}
    </span>
  );
});
