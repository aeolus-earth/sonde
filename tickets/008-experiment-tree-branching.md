# TICKET-008: Experiment Tree — Parent-Child Branching for Research Exploration

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-30
**Priority:** High
**Phase:** Core data model
**Related:** TICKET-001 (knowledge graph), TICKET-007 (living knowledge base)
**Inspired by:** AI-Scientist-v2 tree search architecture

---

## The idea

Real research branches. You form a hypothesis, test it, it partially works, so you fork three variants. Two fail. One succeeds, so you refine it twice. Meanwhile the failures suggest an alternative approach, so you branch from the original and try something different. This is a tree, not a list.

Today Sonde stores experiments as a flat list. The `fork` command creates child experiments but buries the parent reference in the untyped `related[]` array — indistinguishable from a "see also" cross-reference. There's no way to ask "show me the exploration tree for this research direction" or "what branched from EXP-0012 and what worked?"

One column — `parent_id` — turns a flat experiment list into a navigable research tree. Add `branch_type` and you can see *why* each branch exists.

---

## What we learned from AI-Scientist-v2

AI-Scientist-v2 models automated ML research as a best-first tree search. Each experiment node has `parent` and `children` references, a stage type (draft, debug, improve, ablation), execution results, and metrics. Experiments branch automatically: failed nodes spawn debug children, successful nodes spawn improvement children. A 4-stage pipeline (initial → tuning → creative → ablation) advances the best node from each stage to the next.

### What to adopt

| Concept | Their version | Our version |
|---------|--------------|-------------|
| Tree structure | `parent`/`children` on Node class | `parent_id` FK on experiments table |
| Branch semantics | draft, debug, improve, ablation | exploratory, refinement, alternative, debug |
| Tree visualization | Interactive HTML with igraph | Rich Tree widget in terminal |
| Subtree queries | In-memory traversal | Recursive CTE in Postgres |
| Branch-on-failure | Auto-spawn debug nodes | Suggest `sonde fork --type debug` on close |

### What to skip

| Concept | Why skip |
|---------|---------|
| Automated stage progression | Sonde is human-driven; stages should be implicit from tree shape |
| Best-first search scoring | Agent concern, not data model — agents can score on top of tree queries |
| Fixed 4-stage pipeline | Too rigid for varied research; tree structure provides the flexibility |
| Multi-seed evaluation | ML-specific statistical robustness concept |
| HTML visualization | CLI tool; Rich Tree is sufficient, HTML can be added later |

### The insight worth remembering

In their system, the *shape* of the tree tells you where you are in the research process. Lots of shallow exploratory branches = early exploration. Deep refinement chains = converging on a solution. Dead-end leaves with debug children = fighting with a brittle approach. We don't need to add a "stage" field to directions — the tree shape is the stage.

---

## Data model changes

### Schema: `parent_id` and `branch_type` on experiments

```sql
ALTER TABLE experiments ADD COLUMN parent_id TEXT REFERENCES experiments(id);
ALTER TABLE experiments ADD COLUMN branch_type TEXT
    CHECK (branch_type IN ('exploratory', 'refinement', 'alternative', 'debug'));
CREATE INDEX idx_experiments_parent ON experiments (parent_id);
```

Pure additive. Nullable columns. No existing data modified. Backward-compatible.

**Branch types:**

| Type | When to use |
|------|------------|
| `exploratory` | New approach to an open question, branching to try something different |
| `refinement` | Improving a successful experiment — better parameters, tighter method |
| `alternative` | Different approach to the same problem, often after a failure |
| `debug` | Fixing or diagnosing a broken/unclear experiment |

Branch type is optional. Existing experiments have NULL parent_id and NULL branch_type. Even new experiments can omit both.

### Tree query functions (Postgres RPCs)

PostgREST can't express recursive queries, so we need server-side functions:

**`get_experiment_subtree(root_id TEXT)`** — recursive CTE walking children downward. Returns rows with `id, parent_id, depth, status, branch_type, content, created_at`.

**`get_experiment_ancestors(exp_id TEXT)`** — walks parent_id upward to root. Returns the ancestry chain in root-to-leaf order.

### Relationship to `related[]`

`related` stays for non-hierarchical cross-references ("see also"). `parent_id` is the tree edge. During transition, `fork` writes to both. The `related` field is *not* migrated — there's no reliable way to distinguish "forked from" vs "see also" entries in existing data. (A future migration *could* backfill `parent_id` from activity log entries with `{"forked_from": "EXP-NNNN"}` — that's the reliable signal.)

### How findings connect

No schema change needed. Findings already have `evidence: TEXT[]` linking to experiment IDs. A finding that emerges from a branch is naturally linked to experiments in that branch. The tree visualization can annotate nodes that have findings pointing to them.

---

## CLI changes

### Enhanced `fork` command

```bash
sonde fork EXP-0001                              # parent_id set, no branch_type
sonde fork EXP-0001 --type refinement             # parent_id + branch_type
sonde fork EXP-0001 -t alternative --tag new-approach
```

The fork command already copies program, tags, parameters, direction, and data_sources. The only changes:
- Add `--type / -t` option for branch_type
- Set `parent_id=source_exp.id` on the new experiment
- Continue populating `related=[source_exp.id]` for backward compat
- Update success message: `Forked EXP-0001 → EXP-0005 (refinement)`

### New `sonde tree` command

```bash
sonde tree DIR-001                    # experiment forest under a direction
sonde tree EXP-0001                   # subtree rooted at an experiment
sonde tree -p weather-intervention    # all root experiments in a program
sonde tree DIR-001 --depth 3          # limit depth
sonde tree DIR-001 --json             # structured output
```

Output (Rich Tree widget):

```
DIR-001  Does CCN concentration affect precipitation enhancement?
├── EXP-0001  [complete]  Baseline CCN=800 simulation
│   ├── EXP-0003  [complete]  CCN=1200, spectral bin  (refinement)
│   │   └── EXP-0007  [failed]  CCN=1200 with doubled domain  (refinement)
│   │       └── EXP-0009  [open]  Debug domain size issue  (debug)
│   └── EXP-0004  [complete]  CCN=800, Morrison scheme  (alternative)
│       └── FIND-0002  CCN sensitivity depends on microphysics scheme  [high]
├── EXP-0002  [failed]  CCN=2000 saturated, no enhancement
│   ├── EXP-0005  [complete]  CCN=1500 threshold test  (alternative)
│   └── EXP-0006  [open]  Debug aerosol activation  (debug)
```

Each node: ID, status (color-coded), first line of content or hypothesis, branch_type in parens. Findings annotated on the experiments they cite as evidence.

### Enhanced `sonde show`

When showing an experiment with tree relationships:

```
Parent:   EXP-0001  Baseline CCN=800 simulation  [complete]
Children: 2 experiments (1 complete, 1 failed)
          → sonde tree EXP-0003
```

### Lifecycle hints

When closing an experiment:

```bash
sonde close EXP-0007
# Closed EXP-0007 as failed.
#
# Next steps:
#   sonde fork EXP-0007 --type debug        # diagnose what went wrong
#   sonde fork EXP-0007 --type alternative   # try a different approach
#   sonde fork EXP-0001 --type refinement    # go back and refine the parent
```

```bash
sonde close EXP-0005 --finding "CCN threshold is ~1500"
# Closed EXP-0005 as complete. Finding extracted.
#
# Next steps:
#   sonde fork EXP-0005 --type refinement   # refine this result
#   sonde finding log                       # record a formal finding
```

Only shown when the experiment is a leaf node (no existing children). Just a helpful prompt — no data model change.

---

## Implementation phases

| Phase | What | Files | Depends on |
|-------|------|-------|-----------|
| 1 | Schema migration | `supabase/migrations/20260330000003_experiment_tree.sql` | — |
| 2 | Model update | `cli/src/sonde/models/experiment.py` | — |
| 3 | DB layer | `cli/src/sonde/db/experiments.py` | 1, 2 |
| 4 | Fork enhancement | `cli/src/sonde/commands/experiment.py` | 2, 3 |
| 5 | Tree command | `cli/src/sonde/commands/tree.py` (new), `cli/src/sonde/cli.py` | 3 |
| 6 | Show enhancement | `cli/src/sonde/commands/show.py` | 3 |
| 7 | Lifecycle hints | `cli/src/sonde/commands/lifecycle.py` | 3 |

Phases 1-4 are the atomic minimum. After that, every `sonde fork` builds a real tree. Phases 5-7 are UX payoff.

---

## How this connects to TICKET-007

The tree structure feeds directly into the living knowledge base:

- **Health checks** can detect dead-end branches (failed leaves with no follow-up), orphaned trees (no findings emerged from a completed tree), and stagnant branches (open experiments that haven't been touched).
- **Brief generation** can summarize the tree shape: "3 active branches exploring CCN sensitivity, 2 dead ends, 1 promising refinement chain."
- **Direction status** becomes derivable from tree shape: a direction with only failed leaf nodes needs attention; a direction with a deep refinement chain and findings is converging.
- **The planner agent** can look at the tree and suggest what to explore next based on which branches were productive and which weren't.

---

## Acceptance criteria

### Schema
1. `parent_id` column exists on experiments, nullable FK to experiments(id)
2. `branch_type` column exists with CHECK constraint for valid values
3. Index on `parent_id` for tree query performance
4. `get_experiment_subtree()` RPC returns correct subtree with depth
5. `get_experiment_ancestors()` RPC returns correct ancestry chain

### Fork command
6. `sonde fork EXP-NNNN` sets `parent_id` on the new experiment
7. `sonde fork EXP-NNNN --type refinement` sets both `parent_id` and `branch_type`
8. `related` field continues to be populated for backward compat
9. Success message shows lineage

### Tree command
10. `sonde tree DIR-NNNN` renders experiment forest with Rich Tree
11. `sonde tree EXP-NNNN` renders subtree from that root
12. Status is color-coded, branch_type shown in parens
13. `--json` outputs nested tree structure
14. `--depth N` limits rendering depth
15. Findings annotated on evidence experiments

### Show command
16. `sonde show EXP-NNNN` displays parent and children when present
17. Breadcrumb to `sonde tree` when tree relationships exist

### Lifecycle
18. Closing a leaf experiment as failed shows fork suggestions
19. Closing a leaf experiment as complete shows next-step suggestions

---

*Related:*
- *tickets/001-knowledge-graph-layer.md — entity/edge model for knowledge graph*
- *tickets/007-living-knowledge-base.md — provenance, sync health, multi-layer curation*
- *repos/AI-Scientist-v2 — source of tree search architecture*
