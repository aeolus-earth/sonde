import { useMemo } from "react";
import { useUIStore } from "@/stores/ui";
import type { ExperimentStatus } from "@/types/sonde";

function readVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || "#000000";
}

/** Recharts / React Flow need raw colors; recompute when theme changes. */
export function useThemeCssColors() {
  const theme = useUIStore((s) => s.theme);

  return useMemo(() => {
    void theme;
    return {
      border: readVar("--color-border"),
      surfaceRaised: readVar("--color-surface-raised"),
      surfaceHover: readVar("--color-surface-hover"),
      text: readVar("--color-text"),
      textTertiary: readVar("--color-text-tertiary"),
      accent: readVar("--color-accent"),
      textQuaternary: readVar("--color-text-quaternary"),
      minimapMask: readVar("--color-minimap-mask"),
      statusOpen: readVar("--color-status-open"),
      statusRunning: readVar("--color-status-running"),
      statusComplete: readVar("--color-status-complete"),
      statusFailed: readVar("--color-status-failed"),
      statusSuperseded: readVar("--color-status-superseded"),
    };
  }, [theme]);
}

export function useStatusChartColors(): Record<ExperimentStatus, string> {
  const c = useThemeCssColors();
  return useMemo(
    () => ({
      open: c.statusOpen,
      running: c.statusRunning,
      complete: c.statusComplete,
      failed: c.statusFailed,
      superseded: c.statusSuperseded,
    }),
    [c]
  );
}
