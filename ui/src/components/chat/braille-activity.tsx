import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Subset of braille block (U+2800+) — low to higher dot density for soft waves. */
const ATMOSPHERE_CHARS =
  "⠀⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟" as const;

/** Landscape grid: wide field (many columns). Phase tuned for ~60ms frames. */
const ATMOSPHERE_ROWS = 7;
const ATMOSPHERE_COLS = 40;

const N_BRAILLE = ATMOSPHERE_CHARS.length;

/** Incommensurate time bases — combined evolution has no short repeat (not 256 frames). */
const PHI = 1.618033988749895;
const SQRT2 = Math.SQRT2;
const PI_H = Math.PI * 0.313;

/**
 * Each layer uses a different irrational-scaled time so phases don’t realign quickly.
 */
function fluidSample(r: number, c: number, t: number): number {
  const u = c / Math.max(ATMOSPHERE_COLS - 1, 1);
  const v = r / Math.max(ATMOSPHERE_ROWS - 1, 1);

  const t0 = t;
  const t1 = t * PHI;
  const t2 = t * SQRT2;
  const t3 = t * PI_H;

  const w1 = Math.sin(c * 0.26 + t0 * 0.051);
  const w2 = Math.sin(r * 0.41 - t1 * 0.043);
  const w3 = Math.sin((c * 0.17 + r * 0.23) + t2 * 0.047);
  const w4 = Math.sin((c * 0.61 - r * 0.54) + t3 * 0.039);
  const w5 = Math.cos(c * 0.11 - r * 0.19 + t0 * 0.028 + t1 * 0.007);
  const w6 = Math.sin((u + v * 0.7) * 4.2 + t1 * 0.033);
  const w7 = Math.sin(Math.hypot(c * 0.08, r * 0.14) + t2 * 0.036 + t3 * 0.004);

  const mix =
    0.26 * w1 +
    0.22 * w2 +
    0.18 * w3 +
    0.16 * w4 +
    0.1 * w5 +
    0.05 * w6 +
    0.03 * w7;

  return Math.sin(
    mix * 1.85 + t0 * 0.014 + t2 * 0.009 + t3 * 0.011 + c * 0.031 + r * 0.027
  );
}

function buildAtmosphereFrame(frameIndex: number): string {
  const lines: string[] = [];
  for (let r = 0; r < ATMOSPHERE_ROWS; r++) {
    let line = "";
    for (let c = 0; c < ATMOSPHERE_COLS; c++) {
      const s = fluidSample(r, c, frameIndex);
      const norm = (s * 0.5 + 0.5) * (N_BRAILLE - 1);
      const idx = Math.round(norm);
      line += ATMOSPHERE_CHARS[Math.min(idx, N_BRAILLE - 1)];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

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

interface BrailleAtmosphereProps {
  className?: string;
  /** Milliseconds between frames — lower = smoother / higher effective frame rate. */
  intervalMs?: number;
}

/** Multi-line braille field that drifts slowly like atmospheric layers. */
export const BrailleAtmosphere = memo(function BrailleAtmosphere({
  className,
  intervalMs = 60,
}: BrailleAtmosphereProps) {
  const [frame, setFrame] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const t = window.setInterval(() => setFrame((n) => n + 1), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs, reduceMotion]);

  const text = buildAtmosphereFrame(reduceMotion ? 0 : frame);

  return (
    <pre
      className={cn(
        "mx-auto w-full max-w-[52rem] select-none whitespace-pre text-center font-mono text-[10px] leading-[1.5] tracking-[0.03em] text-text-quaternary/55 sm:text-[11px] sm:leading-[1.55] sm:tracking-[0.04em]",
        className
      )}
      aria-hidden
    >
      {text}
    </pre>
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
