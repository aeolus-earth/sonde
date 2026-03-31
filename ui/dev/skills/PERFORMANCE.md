# Performance Skill — Writing Fast Sonde UI

This guide codifies the patterns that keep the sonde dashboard fast.
Follow these rules. Deviate only with a measured reason.

---

## 1. Data fetching: TanStack Query is the cache layer

- **Every Supabase call goes through a query hook.** Never call `supabase` directly in a component — always wrap in a `useQuery`/`useMutation` with a key from `query-keys.ts`.
- **`staleTime` is your first knob.** Default is 30s. Static data (programs) gets 5min. Hot data (activity) gets polling via `refetchInterval`. Choose per-query, not globally.
- **`enabled` gates prevent waterfalls.** If a query depends on another query's result, set `enabled: !!dependentValue`. This stops React from firing a request that will immediately fail or return nothing.
- **Invalidate surgically.** After a mutation, invalidate only the affected keys:
  ```ts
  queryClient.invalidateQueries({ queryKey: queryKeys.experiments.all(program) });
  ```
  Never do `queryClient.invalidateQueries()` (no args) — it blows the entire cache.
- **Prefer `select` for derived data.** If a component only needs experiment IDs from a full experiment list, use the `select` option on `useQuery` to derive it. TanStack Query memoizes `select` results — the component won't re-render if the derived value hasn't changed:
  ```ts
  const { data: ids } = useExperiments({
    select: (exps) => exps.map(e => e.id),
  });
  ```

## 2. Code splitting: load what's visible

- **Lazy-load route-level visualizations.** React Flow and Recharts are heavy. The tree page lazy-loads `ExperimentTreeView`:
  ```ts
  const ExperimentTreeView = lazy(() =>
    import("@/components/visualizations/experiment-tree").then(m => ({
      default: m.ExperimentTreeView,
    }))
  );
  ```
- **Vite's `manualChunks` in `vite.config.ts` splits vendor bundles.** React, Supabase, TanStack Query, Recharts, and React Flow each get their own chunk. This means navigating to the tree page only downloads the React Flow chunk the first time.
- **Never import a visualization component at the top of a route file.** Always use `lazy()` + `<Suspense>`.

## 3. Bundle size discipline

- **Import icons individually** from `lucide-react`:
  ```ts
  // GOOD — tree-shaken
  import { FlaskConical } from "lucide-react";

  // BAD — pulls entire icon set
  import * as Icons from "lucide-react";
  ```
- **No barrel exports.** Don't create `components/index.ts` that re-exports everything. Import directly from the component file. Barrel files defeat tree-shaking in development and cause Vite HMR to be slower.
- **Check bundle impact before adding deps.** Run `npx vite-bundle-visualizer` before merging a new dependency.

## 4. Images and assets

- **Supabase Storage artifacts use signed URLs** with short expiry. Cache the URL in TanStack Query, not the blob.
- **Use `loading="lazy"` on `<img>` tags** below the fold.
- **Prefer SVG for icons and diagrams.** Lucide icons are already SVG. For custom diagrams, inline SVG beats raster.

## 5. Network

- **Supabase realtime** replaces polling for high-frequency tables. Use `useRealtimeInvalidation` to subscribe and auto-invalidate the cache. Don't use `refetchInterval` AND realtime on the same query — pick one.
- **Paginate server-side.** The experiment list limits to 200 rows. If you need more, add `.range(from, to)` pagination — never fetch all rows and paginate client-side.
- **PostgREST `select` projection:** Only request columns you render:
  ```ts
  .select("id, status, hypothesis, finding, created_at")
  ```
  Not `.select("*")` unless the component actually uses every field.

## 6. Measuring

- Use React DevTools Profiler to find components that re-render on data changes they don't consume.
- Use the Network tab to check query deduplication — you should never see duplicate Supabase requests for the same table in a single navigation.
- Lighthouse CI on the `/` route should stay above 90 performance score.
