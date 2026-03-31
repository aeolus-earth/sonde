/**
 * [React Scan](https://github.com/aidenybai/react-scan) — runtime render profiling (dev only).
 *
 * We use the library’s **instrumentation**, not static guessing:
 * - `scan({ onRender })` receives every profiled commit with component names + render weights.
 * - A throttled `console.table` surfaces the hottest components in DevTools (and in automated browser runs).
 *
 * Note: `trackUnnecessaryRenders` appears in upstream `.d.ts` but is **not** accepted by `validateOptions`
 * in react-scan **0.5.3** (latest on npm); gray-outline “unnecessary” mode isn’t available via API until that ships.
 *
 * Dynamic import keeps `react-scan` out of production bundles.
 */
export function initReactScan(): void {
  if (!import.meta.env.DEV) return;

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
      /**
       * Built-in per-render logs — very noisy; enable when you need raw traces.
       * @see https://github.com/aidenybai/react-scan
       */
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
