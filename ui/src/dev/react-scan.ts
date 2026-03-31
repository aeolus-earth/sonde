/**
 * [React Scan](https://github.com/aidenybai/react-scan) — optional dev profiler (adds main-thread work; skews FPS).
 *
 * Off by default. Enable when profiling: `VITE_REACT_SCAN=1 npm run dev`
 * Optional verbose logs: `VITE_REACT_SCAN_LOG=1`
 *
 * Dynamic import keeps `react-scan` out of production bundles.
 */
export function initReactScan(): void {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_REACT_SCAN !== "1") return;

  void import("react-scan").then(({ scan }) => {
    const windowStats = new Map<string, { renderWeight: number; unnecessaryHints: number }>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
      flushTimer = null;
      const rows = [...windowStats.entries()]
        .map(([component, v]) => ({
          component,
          renderWeight: v.renderWeight,
          unnecessaryHints: v.unnecessaryHints,
        }))
        .sort((a, b) => b.renderWeight - a.renderWeight)
        .slice(0, 30);
      windowStats.clear();
      if (rows.length === 0) return;

      console.info("[react-scan] Hottest components in the last ~3s (instrumented onRender):");
      console.table(rows);
      console.info("[react-scan] JSON:", JSON.stringify(rows, null, 2));
    };

    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(flush, 3000);
    };

    scan({
      enabled: true,
      showToolbar: true,
      log: import.meta.env.VITE_REACT_SCAN_LOG === "1",
      onRender: (_fiber, renders) => {
        for (const r of renders) {
          const name = r.componentName ?? "(unknown)";
          const prev = windowStats.get(name) ?? { renderWeight: 0, unnecessaryHints: 0 };
          prev.renderWeight += r.count;
          if (r.unnecessary === true) prev.unnecessaryHints += 1;
          windowStats.set(name, prev);
        }
        scheduleFlush();
      },
    });
  });
}
