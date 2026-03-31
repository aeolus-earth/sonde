# Zustand Skill — State Management That Doesn't Fight You

Zustand is the state layer for client-only global state. This guide covers
how to use it well in sonde, and the traps to avoid.

---

## Architecture: what goes in Zustand

```
┌─────────────────────────────────────────────────┐
│  TanStack Query         │  Zustand              │
│  ─────────────          │  ───────              │
│  experiments             │  activeProgram        │
│  findings                │  auth session/user    │
│  directions              │  sidebar open/closed  │
│  questions               │  command palette open │
│  activity log            │                       │
│  artifacts               │                       │
│                          │                       │
│  = server state          │  = client state       │
└─────────────────────────────────────────────────┘
```

If the data comes from Supabase, it belongs in TanStack Query.
If it's client-only state that multiple components need, it belongs in Zustand.
If only one component needs it, use `useState`.

---

## Store design principles

### 1. One store per domain, not one mega-store

```ts
// GOOD — small, focused stores
export const useAuthStore = create<AuthState>(...);
export const useProgramStore = create<ProgramState>(...);
export const useUIStore = create<UIState>(...);

// BAD — god store
export const useStore = create<{
  auth: AuthState;
  program: ProgramState;
  ui: UIState;
  experiments: Experiment[];  // server state doesn't belong here
}>(...);
```

Small stores mean fewer re-renders. A change to `sidebarOpen` never touches `useAuthStore` subscribers.

### 2. Export granular selectors

```ts
// In stores/ui.ts
export const useSidebarOpen = () => useUIStore((s) => s.sidebarOpen);
export const useToggleSidebar = () => useUIStore((s) => s.toggleSidebar);
```

Benefits:
- Components are decoupled from store shape
- Selector is written once, not duplicated in every consumer
- TypeScript infers the return type automatically

### 3. Actions live in the store, not in components

```ts
// GOOD — action is in the store
const toggleSidebar = useToggleSidebar();
<Button onClick={toggleSidebar} />;

// BAD — logic leaks into the component
const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
const sidebarOpen = useUIStore((s) => s.sidebarOpen);
<Button onClick={() => setSidebarOpen(!sidebarOpen)} />;
```

The second version reads two fields (both subscribe) and has business logic in JSX.

---

## Middleware

### `persist` — for state that survives page reload

```ts
export const useProgramStore = create<ProgramState>()(
  persist(
    (set) => ({
      activeProgram: "weather-intervention",
      setActiveProgram: (program) => set({ activeProgram: program }),
    }),
    { name: "sonde-active-program" }  // localStorage key
  )
);
```

Use `persist` for:
- Active program selection
- UI preferences (theme, sidebar state)

Don't use `persist` for:
- Auth tokens (Supabase handles this)
- Server data (TanStack Query handles this)
- Ephemeral UI state (dropdown open, filter text)

### `devtools` — for debugging

```ts
import { devtools } from "zustand/middleware";

export const useUIStore = create<UIState>()(
  devtools(
    (set) => ({ ... }),
    { name: "ui-store" }
  )
);
```

Enable in dev. Shows state changes in Redux DevTools extension.

---

## Common traps

### Trap 1: Subscribing to the whole store

```ts
// Renders on EVERY store change
const { sidebarOpen } = useUIStore();

// Renders only when sidebarOpen changes
const sidebarOpen = useUIStore((s) => s.sidebarOpen);
```

This is the #1 Zustand mistake. Always pass a selector.

### Trap 2: Creating new objects in selectors

```ts
// BAD — new object every call, triggers re-render every time
const state = useUIStore((s) => ({
  sidebar: s.sidebarOpen,
  palette: s.commandPaletteOpen,
}));
```

Zustand compares selector results with `Object.is`. A new object `!==` the previous one. Fix with `useShallow`:

```ts
import { useShallow } from "zustand/shallow";

const state = useUIStore(
  useShallow((s) => ({
    sidebar: s.sidebarOpen,
    palette: s.commandPaletteOpen,
  }))
);
```

Or better — use two separate selectors:
```ts
const sidebar = useUIStore((s) => s.sidebarOpen);
const palette = useUIStore((s) => s.commandPaletteOpen);
```

### Trap 3: Deriving server state in Zustand

```ts
// BAD — duplicates query cache, goes stale
const useExperimentStore = create((set) => ({
  experiments: [],
  fetchExperiments: async () => {
    const { data } = await supabase.from("experiments").select("*");
    set({ experiments: data });
  },
}));
```

Use TanStack Query for this. It handles caching, deduplication, background refresh, and error/loading states.

### Trap 4: Putting ephemeral state in Zustand

```ts
// BAD — filter text doesn't need to survive navigation or be shared
const useFilterStore = create((set) => ({
  filterText: "",
  setFilterText: (text: string) => set({ filterText: text }),
}));

// GOOD — just use useState in the component
const [filter, setFilter] = useState("");
```

---

## Testing stores

```ts
import { useAuthStore } from "@/stores/auth";

// Reset between tests
beforeEach(() => {
  useAuthStore.setState({ user: null, session: null, loading: false });
});

test("signOut clears user", async () => {
  useAuthStore.setState({ user: mockUser, session: mockSession });
  await useAuthStore.getState().signOut();
  expect(useAuthStore.getState().user).toBeNull();
});
```

`getState()` and `setState()` let you test stores without rendering components.
