# Rendering Skill — No Wasted Renders

The single biggest perf killer in React dashboards is over-rendering.
This guide covers why components re-render and how to stop it.

---

## Why components re-render

A component re-renders when:
1. **Its parent re-renders** (default React behavior)
2. **A hook it calls returns a new reference** (state, context, query data)
3. **A Zustand selector returns a new value**

That's it. Every fix maps to one of these three causes.

---

## Rule 1: Subscribe to the narrowest slice

### Zustand
```ts
// BAD — re-renders on ANY store field change
const store = useUIStore();
const isOpen = store.sidebarOpen;

// GOOD — re-renders only when sidebarOpen changes
const isOpen = useUIStore((s) => s.sidebarOpen);

// BEST — export a named selector from the store file
export const useSidebarOpen = () => useUIStore((s) => s.sidebarOpen);
```

Zustand uses `Object.is` comparison by default. Primitive selectors (string, number, boolean) are free — they only trigger re-renders when the value actually changes.

**Object selectors need `shallow`** if the object is reconstructed on each store update:
```ts
import { useShallow } from "zustand/shallow";

const { sidebarOpen, commandPaletteOpen } = useUIStore(
  useShallow((s) => ({
    sidebarOpen: s.sidebarOpen,
    commandPaletteOpen: s.commandPaletteOpen,
  }))
);
```

### TanStack Query
```ts
// BAD — component re-renders when any experiment field changes
const { data: experiments } = useExperiments();
const count = experiments?.length ?? 0;

// GOOD — only re-renders when the count changes
const { data: count } = useQuery({
  ...experimentQueryOptions,
  select: (data) => data.length,
});
```

`select` transforms are memoized. If the output is structurally identical, the component doesn't re-render.

---

## Rule 2: Memoize expensive components, not everything

Use `memo()` when a component:
- Is rendered inside a list or map
- Receives stable props but its parent re-renders frequently
- Contains expensive rendering (charts, trees, markdown)

```ts
// YES — ExperimentNode is rendered per-node in a tree with 100+ nodes
export const ExperimentNode = memo(function ExperimentNode({ data }: Props) {
  // ...
});

// NO — Shell renders once, wraps the whole app. memo adds overhead for nothing.
export function Shell({ children }: { children: ReactNode }) {
  // ...
}
```

**Never memo a component that receives `children` as a prop** unless the children are truly stable. `children` is a new JSX object on every render, which breaks memo's shallow comparison.

Exception: layout components like `Sidebar` and `Header` that don't receive children but sit inside frequently-updating parents — those benefit from memo.

---

## Rule 3: Stabilize callbacks and derived data

```ts
// BAD — new function identity every render
<Button onClick={() => navigate({ to: "/experiments/$id", params: { id } })} />

// GOOD — stable reference
const handleClick = useCallback(() => {
  navigate({ to: "/experiments/$id", params: { id } });
}, [navigate, id]);
```

Only use `useCallback` when the function is:
- Passed as a prop to a memoized child
- Used in a dependency array of another hook

For inline event handlers on native elements (`<button onClick={...}>`), don't bother — the DOM element isn't memoized anyway.

`useMemo` for derived data:
```ts
// BAD — filters entire list every render
const filtered = experiments.filter((e) => e.status === "running");

// GOOD — only recalculates when experiments or status changes
const filtered = useMemo(
  () => experiments.filter((e) => e.status === status),
  [experiments, status]
);
```

Use `useMemo` when the computation is O(n) or higher. Don't use it for simple property access or ternaries.

---

## Rule 4: Key lists correctly

```tsx
// BAD — index keys cause full re-mount on reorder
{experiments.map((e, i) => <ExperimentRow key={i} experiment={e} />)}

// GOOD — stable identity
{experiments.map((e) => <ExperimentRow key={e.id} experiment={e} />)}
```

Every sonde entity has a stable `id` field. Always use it.

---

## Rule 5: Virtualize long lists

If a list has 100+ items, use `@tanstack/react-virtual`:
```ts
import { useVirtualizer } from "@tanstack/react-virtual";

const virtualizer = useVirtualizer({
  count: experiments.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 48,
});
```

The experiment table at 200 rows is borderline — measure before virtualizing. React Flow already virtualizes nodes internally, so the tree view is fine.

---

## Rule 6: Never put state in the wrong place

| State type | Where it lives | Why |
|---|---|---|
| Server data (experiments, findings) | TanStack Query | Caching, deduplication, background refetch |
| Global client state (active program, auth) | Zustand | Persists across routes, minimal re-renders with selectors |
| Local UI state (filter input, dropdown open) | `useState` | Scoped to component, unmounts with it |

**Never put server data in Zustand.** You'll lose caching, deduplication, and stale-while-revalidate. If you're tempted, use `select` on the query instead.

**Never put ephemeral UI state in Zustand.** A filter input value or a "is dropdown open" boolean should be `useState` in the component. Zustand is for state that other components need or that should survive navigation.

---

## Debugging re-renders

1. **React DevTools Profiler:** Record an interaction, look for components that re-rendered but shouldn't have. The "Why did this render?" feature tells you if it was props, hooks, or parent.
2. **`useWhyDidYouRender`** (dev only): Add to a suspect component to log what changed.
3. **Quick test:** Add `console.count("ComponentName")` at the top of a component. Navigate around. If the count climbs without user interaction, you have a re-render loop.
