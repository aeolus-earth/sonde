import { useEffect, useRef, useState } from "react";

const TYPE_MS = 42;
const DELETE_MS = 30;
const PAUSE_AT_FULL_MS = 2600;
const GAP_BEFORE_NEXT_MS = 520;

/**
 * Cycles through prompts: types forward, pauses, deletes, then next prompt.
 * When `enabled` is false, clears output and cancels timers.
 */
export function useRotatingTypewriter(
  prompts: readonly string[],
  enabled: boolean
): string {
  const [text, setText] = useState("");
  const indexRef = useRef(0);
  const lenRef = useRef(0);
  const phaseRef = useRef<"type" | "pause" | "del">("type");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || prompts.length === 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      indexRef.current = 0;
      lenRef.current = 0;
      phaseRef.current = "type";
      setText("");
      return;
    }

    let cancelled = false;

    const schedule = (fn: () => void, ms: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!cancelled) fn();
      }, ms);
    };

    const tick = () => {
      if (cancelled) return;
      const cur = prompts[indexRef.current % prompts.length]!;

      if (phaseRef.current === "type") {
        if (lenRef.current < cur.length) {
          lenRef.current += 1;
          setText(cur.slice(0, lenRef.current));
          schedule(tick, TYPE_MS);
        } else {
          phaseRef.current = "pause";
          schedule(() => {
            if (cancelled) return;
            phaseRef.current = "del";
            tick();
          }, PAUSE_AT_FULL_MS);
        }
        return;
      }

      if (phaseRef.current === "del") {
        if (lenRef.current > 0) {
          lenRef.current -= 1;
          setText(cur.slice(0, lenRef.current));
          schedule(tick, DELETE_MS);
        } else {
          indexRef.current = (indexRef.current + 1) % prompts.length;
          phaseRef.current = "type";
          schedule(tick, GAP_BEFORE_NEXT_MS);
        }
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, prompts]);

  return text;
}
