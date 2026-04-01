# Unified Views: Collapse sidebar into view toggles

## Motivation

The sidebar has 10+ nav items that all query the same database. Experiments, Tree, Timeline, Directions, Findings, Projects, Brief, Activity — these aren't different features, they're different *lenses* on the same knowledge graph. Each top-level page increases cognitive load ("where do I find X?") and fragments navigation. Users shouldn't have to decide between `/experiments`, `/tree`, `/timeline`, `/directions`, `/findings`, and `/projects` when they're all answering the same question: "what's happening in my research?"

**Current sidebar (too many items):**
```
Assistant
Dashboard
Brief
Experiments
Tree
Timeline
Projects
Directions
Findings
Inbox
Activity
```

**Goal:** A low-entropy UI where the primary workspace is one page with toggleable views, not 10 separate pages that each show a slice of the same data.

## Proposed structure

### One research workspace with view modes

Replace Experiments, Tree, Timeline, Directions, Findings, Projects, Brief with a single **Research** (or **Lab** or **Work**) page that has a view toggle bar at the top:

```
┌─────────────────────────────────────────────────────┐
│  Research                                           │
│  [Table] [Tree] [Timeline] [Brief]    program: nwp  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  (content changes based on selected view)           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**View modes:**

| View | What it shows | Current page |
|------|--------------|-------------|
| **Table** | All primitives in a filterable table — experiments, directions, findings, projects, questions. Entity type is a filter, not a page. | `/experiments`, `/directions`, `/findings`, `/projects`, `/questions` |
| **Tree** | Hierarchical graph: Program → Project → Direction → Experiment with collapsible depth | `/tree` |
| **Timeline** | Git commit history with experiment markers per repo | `/timeline` |
| **Brief** | Program summary — stats, active context, coverage gaps, findings, stale work | `/brief` |

### Table view has entity type tabs

Inside the Table view, tabs or a dropdown filter which entity type you're looking at:

```
[All] [Experiments] [Directions] [Findings] [Projects] [Questions]

┌──────────┬────────┬─────────┬──────────────────────────────┐
│ ID       │ Type   │ Status  │ Summary                      │
├──────────┼────────┼─────────┼──────────────────────────────┤
│ EXP-0183 │ exp    │ running │ CCN sweep at 1500...         │
│ DIR-005  │ dir    │ active  │ Warm rain initiation         │
│ FIND-017 │ find   │ high    │ CCN saturates at ~1500       │
│ PROJ-001 │ proj   │ active  │ SuperDroplets GPU Port       │
└──────────┴────────┴─────────┴──────────────────────────────┘
```

When filtered to "Experiments" it looks exactly like the current experiment list. When filtered to "Findings" it looks like the current findings page. Same data, same rendering — just now it's a filter state, not a route.

### Shared filter state across views

All views share:
- Program selector (already global via Zustand)
- Status filter
- Tag filter
- Text search
- Artifact type filter

When you filter to "running experiments tagged gpu" and switch from Table to Tree, the tree shows only those experiments. When you switch to Brief, it summarizes only the filtered set.

### URL structure

```
/research                    → default (Table, All entities)
/research?view=table&type=experiments&status=running
/research?view=tree
/research?view=timeline
/research?view=brief
```

One route, query params for view state. Bookmarkable, shareable.

### What stays in the sidebar

```
Assistant        (chat)
Research         (the unified workspace — Table/Tree/Timeline/Brief)
Activity         (audit log — different enough to be separate)
```

That's it. Three sidebar items. Dashboard might merge into Brief view. Inbox (questions) becomes a filter in the Table view.

## What this eliminates

- `/experiments` → Table view filtered to experiments
- `/tree` → Tree view
- `/timeline` → Timeline view
- `/brief` → Brief view
- `/directions` → Table view filtered to directions
- `/findings` → Table view filtered to findings
- `/projects` → Table view filtered to projects
- `/questions` → Table view filtered to questions

Detail pages (`/experiments/EXP-0183`, `/findings/FIND-017`, etc.) stay as separate routes — you need a dedicated page for a single record's full context. But the list/browse experience is unified.

## Design considerations

1. **View toggle must be prominent** — not hidden in a dropdown. Icon buttons (list icon, tree icon, git icon, chart icon) in the page header, always visible.

2. **Entity type filter in Table view should feel like tabs, not a dropdown** — quick to switch, visible count per type.

3. **Tree view should respect filters** — if I filter to "running" experiments, the tree only shows those branches. Collapsed nodes that contain no matching experiments should be hidden.

4. **Brief view is read-only** — no editing from Brief. But each item in Brief links to the record detail page.

5. **Keyboard shortcuts** — `1` for Table, `2` for Tree, `3` for Timeline, `4` for Brief. Or use the existing `j`/`k` for row nav within Table view.

6. **Mobile** — On narrow viewports, the view toggle becomes a dropdown or swipeable tabs.

## Implementation sketch

- One new route: `/research` (or keep `/experiments` as the canonical URL for backward compat)
- One page component with a view state (from URL search param)
- Four lazy-loaded view components (reuse existing page code, extract from route files)
- Remove 7 sidebar nav items, add 1
- Shared filter bar component at the top, passed to all views

## Not in scope

- Merging Activity into the unified view (it's fundamentally different — an audit log, not a research lens)
- Merging the chat/assistant into Research (they're different interaction modes)
- Detail pages (keep as separate routes)

## Priority

Medium — this is a UX cleanup, not a feature. The current multi-page approach works, it's just noisy. Ship when the core research workflow stabilizes.
