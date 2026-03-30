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

## Mental model: git for research

The tree should feel like reading `git log --graph --all`. Git's power isn't the DAG itself — it's the *views* on top of it (`log`, `branch`, `status`, `diff`). The same principle applies here.

| Git concept | Sonde equivalent | Why it matters |
|------------|-----------------|----------------|
| Branch | Fork chain (parent → child → grandchild) | A line of investigation |
| Branch name | First line of `content` (set at fork time) | Intent signal — "what is this branch trying to do?" |
| Commit status | Experiment status (open → running → complete/failed) | Where work stands |
| `git log --graph` | `sonde tree` | The full picture |
| `git branch` | `sonde tree --active` | What's being worked on right now |
| `git log --author` | `sonde tree --mine` | What *I'm* working on |
| `git status` | `sonde brief --json` | Quick summary of current state |
| `git checkout -b` | `sonde fork` | Start a new line of work |
| Merge commit | Finding (synthesizes results from multiple experiments) | What was learned |
| Tag | Direction (groups related trees) | The research question being answered |

The tree shape tells you where you are in the research process without needing an explicit "stage" field:
- **Wide and shallow** (many exploratory children of root) = early exploration, casting a wide net
- **Deep and narrow** (long refinement chain) = converging on a solution
- **Dead-end leaves with debug children** = fighting with a brittle approach — consider branching from higher up
- **Completed subtree with findings** = this branch produced results, move on

This is the insight from AI-Scientist-v2 — the *shape* is the stage.

---

## Design principle: the CLI guides the agent

An agent should never need to "learn about" the tree. It should discover tree context through the commands it already runs. The tree isn't a feature you opt into — it's ambient context that shows up everywhere.

**Why this matters:** An agent's workflow is `brief → list → show → fork → do work → close`. If the tree only exists in a new `sonde tree` command, agents need to be taught to use it. If the tree shows up in `brief`, `fork`, `close`, and `show`, agents discover it naturally and make better decisions without any skill updates.

The principle: **every command that touches an experiment should surface the tree context relevant to the decision the agent is making at that moment.**

| Agent's moment | What they're deciding | Tree context that helps |
|---|---|---|
| Starting a session (`brief`) | "What should I work on?" | Tree summary: active branches, dead ends, unclaimed work |
| Browsing work (`list`) | "Which experiment should I pick?" | Depth and parent — is this a root or deep refinement? |
| Reading an experiment (`show`) | "What's the context?" | Parent, children, ancestry — where does this fit? |
| Branching (`fork`) | "Should I fork this, or has someone already?" | Siblings — what's already being explored from this parent |
| Claiming work (`start`) | "Is someone already on this?" | Claim status — who's working on it and since when |
| Finishing work (`close`) | "What should I do next?" | Suggested next steps — fork, record finding, or move on |

The tree is never something you query separately. It's woven into the fabric of every research action.

---

## Multi-agent coordination

When multiple agents work the same program concurrently, the tree is the coordination primitive. Every agent can answer five questions by reading the tree:

1. **What's already been tried?** → Complete/failed leaves
2. **What's being worked on right now?** → Running nodes (and by whom — `source` field)
3. **What's queued but not started?** → Open nodes
4. **Where are the gaps?** → Branches that should exist but don't (directions with no exploratory children, failed experiments with no debug or alternative follow-up)
5. **What should I do next?** → The planning question — answered by combining 1-4

### The duplicate-work problem

Without tree visibility, two agents polling `sonde brief` independently will both see "EXP-0001 is complete, no follow-up exists" and both fork it. This is the equivalent of two developers creating the same feature branch.

**Mitigations (all implemented in this ticket):**

1. **Fork shows siblings first.** Before creating a new child, the fork command fetches and displays existing children of the parent. For `--json` output, siblings are included in the response. Agents can programmatically check "is someone already exploring this direction?" before proceeding.

2. **Content-at-fork as intent signal.** The `fork` command accepts a one-line description as a positional argument. This serves as a lightweight branch name — agents scan siblings' content to see what's being explored. An agent seeing `EXP-0003: "CCN=1200 spectral bin"` knows not to create another CCN=1200 variant.

3. **Source attribution on every tree node.** The subtree RPC returns `source` so agents can see who owns each branch without extra queries. An agent can filter for "branches not owned by me" to see what others are doing.

4. **Active-frontier filters.** `sonde tree --active` prunes completed subtrees, showing only branches with open/running leaves. This is the "what's happening right now" view — the equivalent of `git branch`.

5. **Recency signals.** Tree output includes relative age (`2m`, `3h`, `1d`). An experiment marked `[open]` but last updated 3 days ago is stale — probably abandoned or blocked. An agent should fork from its parent rather than waiting for it.

### The remaining gap: claiming work

The tree + siblings + filters solve *visibility*. But visibility isn't coordination. Two agents can see the same empty branch and both fork it in the same 5-second window. An agent 3 levels deep in a refinement chain doesn't know another agent just produced a finding that invalidates its premise.

Full solutions (agent sessions, heartbeats, pub-sub) belong in TICKET-003. But there's a minimal addition that fits in this ticket: **make `sonde start` a lightweight claim.**

Today, `sonde start EXP-0005` just flips status to `running`. It doesn't record *who* started it or *when*. The fix is two fields:

```sql
ALTER TABLE experiments ADD COLUMN claimed_by TEXT;
ALTER TABLE experiments ADD COLUMN claimed_at TIMESTAMPTZ;
```

When `sonde start EXP-0005` runs:
1. Set `status = 'running'`, `claimed_by = resolve_source()`, `claimed_at = now()`
2. If already `running` by a *different* worker, warn:
   ```
   ⚠ EXP-0005 is already running (claimed by agent/codex-1, 12m ago)
   Continue anyway? [y/N]
   ```
   For `--json`, include `{"conflict": {"claimed_by": "agent/codex-1", "claimed_at": "..."}}` so agents can decide programmatically.
3. When status leaves `running` (close/open/fail), clear `claimed_by` and `claimed_at`.

This is *not* a hard lock — it's a **strong signal**, like git warning "this branch has uncommitted changes by someone else." Agents that see the warning can back off and work on something else. Agents that proceed knowingly (e.g., taking over from a stalled agent) can use `--force`.

---

## Data model changes

### Schema: `parent_id` and `branch_type` on experiments

```sql
-- Tree structure
ALTER TABLE experiments ADD COLUMN parent_id TEXT REFERENCES experiments(id);
ALTER TABLE experiments ADD COLUMN branch_type TEXT
    CHECK (branch_type IN ('exploratory', 'refinement', 'alternative', 'debug', 'replication'));
CREATE INDEX idx_experiments_parent ON experiments (parent_id);

-- Lightweight claim mechanism
ALTER TABLE experiments ADD COLUMN claimed_by TEXT;
ALTER TABLE experiments ADD COLUMN claimed_at TIMESTAMPTZ;
```

Pure additive. Nullable columns. No existing data modified. Backward-compatible.

**Branch types:**

| Type | When to use |
|------|------------|
| `exploratory` | New approach to an open question, branching to try something different |
| `refinement` | Improving a successful experiment — better parameters, tighter method |
| `alternative` | Different approach to the same problem, often after a failure |
| `debug` | Fixing or diagnosing a broken/unclear experiment |
| `replication` | Re-running the same experiment to verify reproducibility |

Branch type is optional. Existing experiments have NULL parent_id and NULL branch_type. Even new experiments can omit both.

### Tree query functions (Postgres RPCs)

PostgREST can't express recursive queries, so we need server-side functions:

**`get_experiment_subtree(root_id TEXT)`** — recursive CTE walking children downward. Returns rows with `id, parent_id, depth, status, branch_type, source, content, finding, created_at, updated_at, claimed_by, claimed_at`. Including `source` and `updated_at` avoids N+1 lookups when rendering "who's working on what" and "how recently."

**`get_experiment_ancestors(exp_id TEXT)`** — walks parent_id upward to root. Returns the ancestry chain in leaf-to-root order (child first, root last — matches the natural "where did I come from?" query direction). Display code reverses this when rendering top-down trees.

**`get_experiment_siblings(exp_id TEXT)`** — returns all experiments with the same parent_id, excluding the given experiment. Used by `fork` to show existing siblings before creating a new branch, and by agents to check for duplicate exploration.

### Relationship to `related[]`

`related` stays for non-hierarchical cross-references ("see also"). `parent_id` is the tree edge. During transition, `fork` writes to both. The `related` field is *not* migrated — there's no reliable way to distinguish "forked from" vs "see also" entries in existing data. (A future migration *could* backfill `parent_id` from activity log entries with `{"forked_from": "EXP-NNNN"}` — that's the reliable signal.)

### How findings connect

No schema change needed. Findings already have `evidence: TEXT[]` linking to experiment IDs. A finding that emerges from a branch is naturally linked to experiments in that branch. The tree visualization can annotate nodes that have findings pointing to them.

---

## CLI changes

### Tree-aware brief (`sonde brief`)

The brief is the agent's entry point. Today it reports flat counts. With the tree, it should surface the exploration shape so agents know what to do without running a second command.

**Human output** — add a "Research tree" section to the brief:

```
Research Tree
  Active branches:  3 (2 refinement chains, 1 exploratory)
  Dead ends:        2 (failed, no follow-up)
  Unclaimed work:   1 open experiment (EXP-0009)
  Stale claims:     1 running >2h with no activity (EXP-0006)
```

**JSON output** — add a `tree_summary` object:

```json
{
  "program": "weather-intervention",
  "tree_summary": {
    "total_roots": 4,
    "active_branches": 3,
    "dead_ends": 2,
    "max_depth": 4,
    "unclaimed": [
      {"id": "EXP-0009", "parent_id": "EXP-0007", "branch_type": "debug",
       "content_summary": "Debug domain size issue", "age_hours": 2}
    ],
    "stale_claims": [
      {"id": "EXP-0006", "claimed_by": "agent/codex-2", "claimed_hours_ago": 3.2}
    ],
    "dead_end_roots": [
      {"id": "EXP-0002", "status": "failed", "children_count": 0,
       "content_summary": "CCN=2000 saturated"}
    ]
  }
}
```

An agent reading this immediately knows: "there's unclaimed debug work on EXP-0009, a stale claim on EXP-0006 I could take over, and EXP-0002 failed with no follow-up — I should fork an alternative." No skill file needed. The data guides the decision.

**Implementation note:** `tree_summary` is computed from the same data the brief already queries (experiments table), just with an extra GROUP BY on `parent_id`. It adds one query, not a new RPC. `dead_ends` = experiments where `status = 'failed'` AND `id NOT IN (SELECT parent_id FROM experiments WHERE parent_id IS NOT NULL)`. `active_branches` = count of distinct root ancestors of open/running experiments. `unclaimed` = open experiments with `claimed_by IS NULL`.

### Enhanced `fork` command

```bash
sonde fork EXP-0001 "Try Morrison microphysics"            # parent_id set, intent captured
sonde fork EXP-0001 -t refinement "Tighten CCN to 1200"    # parent_id + branch_type + intent
sonde fork EXP-0001 -t alternative --tag new-approach "Bulk scheme instead of spectral"
```

The fork command already copies program, tags, parameters, direction, and data_sources. Changes:
- Add `--type / -t` option for branch_type
- Accept optional positional argument as the first line of `content` — a one-line intent description that serves as a lightweight "branch name." Agents and humans scan siblings to see what's already being explored before creating another fork.
- Set `parent_id=source_exp.id` on the new experiment
- Continue populating `related=[source_exp.id]` for backward compat
- **Show existing siblings before creating** — the fork command fetches and displays children of the parent so the user/agent can see what's already being explored:
  ```
  EXP-0001 already has 2 children:
    EXP-0003 [running] (refinement) — CCN=1200 spectral bin  (agent/codex-1, 5m ago)
    EXP-0004 [complete] (alternative) — Morrison scheme  (human/mason, 1h ago)
  Creating EXP-0005 (alternative) — Bulk scheme instead of spectral
  ```
- **`--json` response** includes everything the agent needs to evaluate what just happened:
  ```json
  {
    "created": {
      "id": "EXP-0005",
      "parent_id": "EXP-0001",
      "branch_type": "alternative",
      "content_summary": "Bulk scheme instead of spectral",
      "status": "open"
    },
    "siblings": [
      {"id": "EXP-0003", "status": "running", "branch_type": "refinement",
       "source": "agent/codex-1", "content_summary": "CCN=1200 spectral bin",
       "age_hours": 0.08},
      {"id": "EXP-0004", "status": "complete", "branch_type": "alternative",
       "source": "human/mason", "content_summary": "Morrison scheme",
       "age_hours": 1.0}
    ],
    "parent": {
      "id": "EXP-0001", "status": "complete",
      "content_summary": "Baseline CCN=800 simulation",
      "children_count": 3
    }
  }
  ```
  The agent sees: "I just created EXP-0005. My parent already has 2 other children — one running refinement by codex-1 and one completed alternative. I'm not duplicating work." No extra query needed.
- Update success message to show lineage: `Forked EXP-0001 → EXP-0005 (alternative)`

### Enhanced lifecycle (`sonde close`, `sonde start`)

**`sonde close` — structured next steps:**

Human output:
```bash
sonde close EXP-0007
# ✓ Closed EXP-0007 as failed.
#
# Next steps:
#   sonde fork EXP-0007 --type debug        # diagnose what went wrong
#   sonde fork EXP-0007 --type alternative   # try a different approach
#   sonde fork EXP-0001 --type refinement    # go back and refine the parent
```

**`--json` output** — agents get structured suggestions, not strings to parse:
```json
{
  "closed": {"id": "EXP-0007", "status": "failed", "parent_id": "EXP-0003"},
  "suggested_next": [
    {"command": "sonde fork EXP-0007 --type debug",
     "reason": "Experiment failed — diagnose what went wrong"},
    {"command": "sonde fork EXP-0007 --type alternative",
     "reason": "Try a different approach to the same problem"},
    {"command": "sonde fork EXP-0001 --type refinement",
     "reason": "Go back to the grandparent and try a different refinement"}
  ],
  "tree_context": {
    "depth": 3,
    "root_id": "EXP-0001",
    "sibling_count": 0,
    "has_findings": false
  }
}
```

```bash
sonde close EXP-0005 --finding "CCN threshold is ~1500"
```
```json
{
  "closed": {"id": "EXP-0005", "status": "complete", "finding": "CCN threshold is ~1500"},
  "suggested_next": [
    {"command": "sonde fork EXP-0005 --type refinement",
     "reason": "Refine this result — tighten the threshold range"},
    {"command": "sonde fork EXP-0005 --type replication",
     "reason": "Replicate to verify reproducibility"},
    {"command": "sonde finding log -p weather-intervention",
     "reason": "Record a formal finding with evidence chain"}
  ],
  "tree_context": {
    "depth": 2,
    "root_id": "EXP-0001",
    "sibling_count": 1,
    "has_findings": false
  }
}
```

The `suggested_next` array is computed, not templated. Rules:
- If failed and is a leaf: suggest debug and alternative forks from self, plus refinement from parent
- If complete with finding and is a leaf: suggest refinement, replication, and formal finding
- If complete without finding: suggest `sonde update --finding "..."` first
- If parent exists and parent has other successful children: suggest comparing with siblings
- Suggestions omit commands that don't make sense (e.g., don't suggest "fork from parent" if parent doesn't exist)

Only shown when the experiment is a leaf node (no existing children). If it already has children, the agent is presumably already working the tree — no hints needed.

**`sonde start` — claim mechanism:**

```bash
sonde start EXP-0009
# ✓ Started EXP-0009 (claimed by human/mason)
```

```bash
sonde start EXP-0009  # by a different agent
# ⚠ EXP-0009 is already running (claimed by agent/codex-1, 12m ago)
# Continue anyway? [y/N]
```

`--json`:
```json
{
  "started": {"id": "EXP-0009", "claimed_by": "agent/codex-2", "claimed_at": "2026-03-30T14:15:00Z"},
  "conflict": null
}
```
or with conflict:
```json
{
  "started": null,
  "conflict": {"claimed_by": "agent/codex-1", "claimed_at": "2026-03-30T14:03:00Z", "age_minutes": 12}
}
```

When an agent sees `conflict`, it backs off and picks different work. No skill needed — the response tells it what happened.

### New `sonde tree` command (top-level, polymorphic)

`tree` is a cross-cutting view like `show`, `brief`, and `status` — it works across entity types. It lives at the top level, not under `experiment`.

```bash
sonde tree EXP-0001                   # subtree rooted at an experiment
sonde tree DIR-001                    # experiment forest under a direction
sonde tree -p weather-intervention    # all root experiments in a program
sonde tree                            # all roots in default program (from .aeolus.yaml)
sonde tree DIR-001 --depth 3          # limit depth
sonde tree DIR-001 --active           # only branches with open/running leaves
sonde tree DIR-001 --mine             # only branches where source matches current actor
sonde tree DIR-001 --leaves           # just the frontier — leaf experiments only
sonde tree DIR-001 --json             # structured output
```

Output (Rich Tree widget):

```
DIR-001  Does CCN concentration affect precipitation enhancement?
├── EXP-0001  [complete]  Baseline CCN=800 simulation  mason, 5d
│   ├── EXP-0003  [complete]  CCN=1200, spectral bin  (refinement)  mason, 2d
│   │   └── EXP-0007  [failed]  CCN=1200 with doubled domain  (refinement)  mason, 1d
│   │       └── EXP-0009  [open]  Debug domain size issue  (debug)  codex-1, 2m ←
│   └── EXP-0004  [complete]  CCN=800, Morrison scheme  (alternative)  codex-2, 3h
│       └── FIND-0002  CCN sensitivity depends on microphysics scheme  [high]
├── EXP-0002  [failed]  CCN=2000 saturated, no enhancement  mason, 4d
│   ├── EXP-0005  [complete]  CCN=1500 threshold test  (alternative)  codex-2, 6h
│   └── EXP-0006  [running]  Debug aerosol activation  (debug)  codex-1 ← working  15m
```

Each node shows: ID, status (color-coded), first line of content, branch_type in parens, short source (just the name after `/`), relative age. The `←` marker highlights the active frontier. Findings are annotated on the experiments they cite as evidence. Running experiments show `claimed_by`.

**Filters for multi-agent use:**

| Filter | What it shows | Equivalent to |
|--------|--------------|---------------|
| `--active` | Prune completed subtrees — only show branches with open/running leaves | `git branch` (what's being worked on) |
| `--mine` | Only branches where `source` matches current actor | `git log --author` |
| `--leaves` | Just leaf experiments (no children) — the current frontier | Checking what's at the tip of each branch |
| `--stale` | Open/running experiments not updated in >48h | Finding abandoned work |

These filters compose: `sonde tree DIR-001 --active --mine` shows "my active branches."

**`--json` tree output:**

```json
{
  "root": "DIR-001",
  "nodes": [
    {
      "id": "EXP-0001",
      "parent_id": null,
      "depth": 0,
      "status": "complete",
      "branch_type": null,
      "source": "human/mason",
      "content_summary": "Baseline CCN=800 simulation",
      "finding": "Baseline shows 12% enhancement",
      "updated_at": "2026-03-28T10:00:00Z",
      "children_count": 2,
      "findings": ["FIND-001"],
      "claimed_by": null,
      "claimed_at": null
    },
    {
      "id": "EXP-0003",
      "parent_id": "EXP-0001",
      "depth": 1,
      "status": "running",
      "branch_type": "refinement",
      "source": "agent/codex-1",
      "content_summary": "CCN=1200 with spectral bin microphysics",
      "finding": null,
      "updated_at": "2026-03-30T14:02:00Z",
      "children_count": 0,
      "findings": [],
      "claimed_by": "agent/codex-1",
      "claimed_at": "2026-03-30T14:00:00Z"
    }
  ]
}
```

### Enhanced `sonde show`

When showing an experiment with tree relationships:

```
Parent:   EXP-0001  Baseline CCN=800 simulation  [complete]
Children: 2 experiments (1 complete, 1 failed)
          → sonde tree EXP-0003
```

`--json` includes `parent_id`, `branch_type`, and a `children` array with IDs and statuses.

### Enhanced `sonde list`

Add `parent_id` and `branch_type` to `--json` output (they're just columns — no extra query). Add a `--roots` filter to show only root experiments (parent_id IS NULL) — useful for seeing the starting points of research. Add a `--children-of EXP-NNNN` filter to list direct children.

Human output: when an experiment has a parent, show a subtle `↳` prefix:

```
ID        STATUS    PROGRAM              FINDING
EXP-0001  complete  weather-intervention Enhancement saturates ~1500
  ↳ EXP-0003  complete  weather-intervention 8% less than bulk at same CCN  (refinement)
  ↳ EXP-0004  complete  weather-intervention Morrison scheme shows different curve  (alternative)
EXP-0002  failed    weather-intervention —
```

This happens automatically when listing experiments under a direction (`sonde list -d DIR-001`). For program-wide lists, the default stays flat — use `sonde tree` for the full picture.

---

## The agentic scientist workflow

Here's what an agent's session looks like with tree-aware sonde. No special training needed — the CLI output guides every decision:

### 1. Start: read the brief

```bash
sonde brief -p weather-intervention --json
```

The agent sees the existing stats AND the new `tree_summary`:
```json
{
  "tree_summary": {
    "active_branches": 3,
    "dead_ends": 2,
    "unclaimed": [{"id": "EXP-0009", "branch_type": "debug", "content_summary": "Debug domain size issue"}],
    "stale_claims": []
  }
}
```

Decision: "There's unclaimed debug work on EXP-0009. I'll take that."

### 2. Investigate: show the experiment

```bash
sonde show EXP-0009 --json
```

The response includes tree context:
```json
{
  "id": "EXP-0009",
  "parent_id": "EXP-0007",
  "branch_type": "debug",
  "parent": {"id": "EXP-0007", "status": "failed", "content_summary": "CCN=1200 with doubled domain"},
  "children": []
}
```

Decision: "This is a debug fork of EXP-0007 which failed. Let me read EXP-0007 to understand what went wrong."

### 3. Claim: start working

```bash
sonde start EXP-0009 --json
```

Response: `{"started": {"id": "EXP-0009", "claimed_by": "agent/scientist-1"}, "conflict": null}`

No conflict — proceed.

### 4. Do the work

The agent investigates, runs analysis, figures out the domain size issue.

### 5. Finish: close with finding

```bash
sonde close EXP-0009 --finding "Domain doubling causes CFL violation at spectral bin resolution — need 2x time step" --json
```

Response:
```json
{
  "closed": {"id": "EXP-0009", "status": "complete"},
  "suggested_next": [
    {"command": "sonde fork EXP-0009 --type refinement \"Apply 2x time step fix\"",
     "reason": "Refine — implement the fix you found"},
    {"command": "sonde fork EXP-0007 --type alternative \"Try smaller domain increase\"",
     "reason": "Alternative — try a less aggressive domain change"}
  ]
}
```

Decision: "I'll fork a refinement to apply the fix."

### 6. Branch: fork and continue

```bash
sonde fork EXP-0009 -t refinement "Apply 2x time step with doubled domain" --json
```

Response includes siblings (none — first fork of EXP-0009) and parent context. The agent starts the new experiment and the cycle continues.

### The key insight

At no point did the agent need to run `sonde tree`, read a skill file, or be taught about branching. Every command it already runs — `brief`, `show`, `start`, `close`, `fork` — now includes the tree context needed for the next decision. The tree is invisible infrastructure. The agent just follows the data.

`sonde tree` exists for when a human or agent wants the full picture — the `git log --graph` moment. But it's not required for the workflow to work.

---

## Skill updates

Skills are the fallback — for agents that proactively read documentation before starting work, or for teaching the full pattern. The CLI output is the primary mechanism; skills reinforce it.

### `sonde-research.md` changes

Add a **"Branching"** section after "Lifecycle":

```markdown
## Branching

Fork experiments to explore alternatives, refine results, debug failures, or replicate findings:

\`\`\`bash
sonde fork EXP-0001 -t refinement "Tighten CCN to 1200"
sonde fork EXP-0001 -t alternative "Try Morrison scheme"
sonde fork EXP-0007 -t debug "Investigate CFL violation"
sonde fork EXP-0005 -t replication "Verify on different domain"
\`\`\`

The fork command shows siblings — check what's already being explored before branching.
When you close an experiment, the CLI suggests next steps (fork, record finding, etc.).

To see the full research tree:

\`\`\`bash
sonde tree DIR-001                    # full picture for a direction
sonde tree DIR-001 --active           # what's being worked on now
sonde tree DIR-001 --active --mine    # what I'm working on
\`\`\`
```

Update **"Discovery workflow"** — add tree as step 2.5:

```markdown
# 2.5 See the exploration tree
sonde tree DIR-001                    # full research tree for a direction
sonde tree DIR-001 --active           # what's being actively explored
```

Update **"Lifecycle"** — mention claim and hints:

```markdown
sonde start EXP-0001                  # claim and mark as running
sonde close EXP-0001                  # mark as complete (shows next-step hints)
sonde close EXP-0001 --finding "..."  # complete with finding (shows next-step hints)
```

### `sonde-formatter.md` changes

Update the **"Link to related records"** section:

```markdown
### 5. Link to related records

Tree relationships are automatic — `sonde fork` sets `parent_id`. Use `--related` only for
non-hierarchical "see also" references between experiments that aren't in a parent-child relationship:

\`\`\`bash
# "See also" cross-references (NOT parent-child — that's handled by fork)
sonde update EXP-XXXX --related EXP-0039,EXP-0041
\`\`\`
```

### Cursor rules (`.cursor/rules/`)

Mirror changes: `sonde-research.mdc` and `sonde-formatter.mdc` get the same updates as their `.claude/skills/` counterparts.

---

## Implementation phases

| Phase | What | Files touched | Depends on |
|-------|------|---------------|-----------|
| 1 | Schema migration (parent_id, branch_type, claimed_by/at, 3 RPCs) | `supabase/migrations/…_experiment_tree.sql` (new) | — |
| 2 | Model update (4 nullable fields + validator) | `models/experiment.py` | — |
| 3 | DB layer (subtree, ancestors, siblings wrappers + tree_summary query) | `db/experiments.py` | 1, 2 |
| 4 | Fork enhancement (--type, content arg, sibling display, JSON contract) | `commands/experiment.py` | 2, 3 |
| 5 | Lifecycle enhancement (claim on start, conflict warning, close hints with JSON) | `commands/lifecycle.py` | 2, 3 |
| 6 | Brief enhancement (tree_summary section in human + JSON output) | `commands/brief.py` | 3 |
| 7 | Tree command (tree view, filters, --json) | `commands/tree.py` (new), `cli.py` | 3 |
| 8 | Show enhancement (parent/children/claim panel, JSON fields) | `commands/show.py` | 3 |
| 9 | List enhancement (parent_id/branch_type in JSON, --roots, --children-of, ↳ prefix) | `commands/experiment.py` list fn | 3 |
| 10 | Skill updates | `.claude/skills/sonde-research.md`, `.claude/skills/sonde-formatter.md`, `.cursor/rules/sonde-research.mdc`, `.cursor/rules/sonde-formatter.mdc` | 4-9 |

**Atomic minimum:** Phases 1-6. After that, `fork` builds a tree with sibling awareness, `start` claims work, `close` suggests next steps, and `brief` surfaces the tree summary. An agent that only reads the brief and follows the CLI output will navigate the tree correctly.

**Full experience:** Phases 7-10 add the explicit tree view, show/list enhancements, and skill documentation.

---

## How this connects to TICKET-007

The tree structure feeds directly into the living knowledge base:

- **Health checks** can detect dead-end branches (failed leaves with no follow-up), orphaned trees (no findings emerged from a completed tree), and stagnant branches (open experiments that haven't been touched). The `tree_summary` in the brief is the lightweight version of this.
- **Brief generation** summarizes tree shape: "3 active branches, 2 dead ends, 1 unclaimed." This is implemented in this ticket as part of the brief enhancement.
- **Direction status** becomes derivable from tree shape: a direction with only failed leaf nodes needs attention; a direction with a deep refinement chain and findings is converging.
- **The planner agent** can look at the tree and suggest what to explore next based on which branches were productive and which weren't.

---

## Design principles for implementation

These are specific to this ticket. General coding standards (type signatures, Pydantic patterns, output conventions, noun-verb grammar) are in `AGENTS.md`. This section covers the patterns that make tree code correct and maintainable on the first pass.

### 1. The DB layer is the only place that talks to Supabase

Every tree query goes through `db/experiments.py`. Commands never call `client.rpc(...)` directly. This is the existing pattern (`db.create()`, `db.get()`, `db.update()`), extended to tree operations:

```python
# db/experiments.py
def get_subtree(root_id: str) -> list[dict[str, Any]]: ...
def get_ancestors(exp_id: str) -> list[dict[str, Any]]: ...
def get_siblings(exp_id: str) -> list[dict[str, Any]]: ...

# commands/tree.py calls db functions, never raw RPC
from sonde.db import experiments as db
nodes = db.get_subtree(root_id)
```

This was violated in the existing codebase (commands calling `client.table(...)` directly in several places). Don't repeat it here.

### 2. New fields are nullable with no migration of existing data

`parent_id`, `branch_type`, `claimed_by`, `claimed_at` are all nullable. Existing experiments get NULL for all four. No backfill migration. No code path should assume these fields are populated — always handle None:

```python
# Good
if exp.parent_id:
    parent = db.get(exp.parent_id)

# Bad — crashes on existing experiments
parent = db.get(exp.parent_id)  # parent_id is None for legacy records
```

### 3. Validate IDs before using them in paths or queries

We added `db/validate.py` with `validate_id()` and `contained_path()` in the security review. Use them. Every ID from user input or database records gets `validate_id()` before it's used in file paths or passed to RPCs:

```python
from sonde.db.validate import validate_id

def get_subtree(root_id: str) -> list[dict[str, Any]]:
    validate_id(root_id)
    return to_rows(client.rpc("get_experiment_subtree", {"root_id": root_id}).execute().data)
```

### 4. Tree rendering is separate from tree data

`commands/tree.py` has two layers: data fetching and rendering. Don't mix them. The data layer returns plain dicts/lists. The rendering layer turns them into Rich Tree widgets or JSON:

```python
def _fetch_tree(root_id: str, ...) -> list[dict]:
    """Pure data — returns flat node list from RPC."""

def _filter_nodes(nodes: list[dict], *, active: bool, mine: bool, ...) -> list[dict]:
    """Pure filtering — prunes node list before rendering."""

def _build_rich_tree(nodes: list[dict], ...) -> Tree:
    """Pure rendering — builds Rich Tree from flat nodes."""
```

This means `--json` and human output share the same data fetch and filter logic. Only the final rendering step differs. If a filter is wrong, you fix it in one place.

### 5. RPCs return flat rows, not nested trees

The Postgres RPCs (`get_experiment_subtree`, `get_experiment_ancestors`, `get_experiment_siblings`) return flat row lists with a `depth` column, not nested JSON. Tree assembly happens in Python:

```sql
-- RPC returns flat rows
id       | parent_id | depth | status   | branch_type | source
EXP-0001 | NULL      | 0     | complete | NULL        | human/mason
EXP-0003 | EXP-0001  | 1     | running  | refinement  | agent/codex
EXP-0007 | EXP-0003  | 2     | failed   | refinement  | human/mason
```

Flat rows are easier to filter, sort, and paginate server-side. The Python rendering layer assembles them into a tree by grouping on `parent_id`. Don't push tree assembly into SQL.

### 6. Every write path logs activity

Every command that mutates data calls `log_activity()`. The tree adds three new write paths — all must log:

| Action | Activity entry |
|--------|---------------|
| Fork with parent_id | `action: "created", details: {"forked_from": parent_id, "branch_type": type}` |
| Start with claim | `action: "status_changed", details: {"from": old, "to": "running", "claimed_by": source}` |
| Close/open clears claim | `action: "status_changed", details: {"from": old, "to": new}` |

### 7. `--json` output is the agent contract

The JSON schema in the "Multi-agent coordination" section is the contract. If agents parse `sonde tree --json` and the shape changes, agents break. Treat `--json` output like a public API:

- Every node has: `id`, `parent_id`, `depth`, `status`, `branch_type`, `source`, `content_summary`, `finding`, `updated_at`, `children_count`, `findings`
- `fork --json` response includes `siblings` array
- `start --json` response includes `conflict` object when another worker has the claim
- Don't add fields without reason. Don't remove or rename fields. If a field is null, emit `null`, don't omit the key.

### 8. Escape user input in ILIKE filters, validate IDs in path operations

We added `escape_like()` in `db/validate.py` during the security review. Any new filter that uses ILIKE (e.g., filtering tree nodes by content text) must escape wildcards. Any path operation involving record IDs must use `validate_id()` and `contained_path()`.

### 9. Tests mock at the DB layer, not the HTTP layer

Follow the existing `conftest.py` pattern — mock `get_client()`, not HTTP responses. For tree tests:

- Test data assembly and filtering with plain dicts — these are pure functions, no mocks needed
- Test the Click command with `runner.invoke` + mocked RPC responses
- Test the claim conflict path (start when already running by different worker)
- Test that `--json` output matches the documented schema
- Test with `parent_id=None` experiments (backward compatibility with existing data)

### 10. Keep `commands/tree.py` under 200 lines

The tree command has a lot of surface area (multiple input types, filters, two output modes). Split if it grows:

- `commands/tree.py` — Click command, argument parsing, dispatch
- Tree query functions go in `db/experiments.py` (not a new db module — they're experiment queries)
- If Rich Tree rendering exceeds ~80 lines, extract a helper to `output.py`

---

## Acceptance criteria

### Schema
1. `parent_id` column exists on experiments, nullable FK to experiments(id)
2. `branch_type` column exists with CHECK constraint for valid values (exploratory, refinement, alternative, debug, replication)
3. Index on `parent_id` for tree query performance
4. `get_experiment_subtree()` RPC returns correct subtree with depth, source, updated_at, claimed_by
5. `get_experiment_ancestors()` RPC returns correct ancestry chain in leaf-to-root order
6. `get_experiment_siblings()` RPC returns all children of the same parent

### Brief (tree-aware)
7. `sonde brief` human output includes "Research Tree" section with active branches, dead ends, unclaimed count
8. `sonde brief --json` includes `tree_summary` object with `active_branches`, `dead_ends`, `unclaimed`, `stale_claims`
9. `tree_summary.unclaimed` includes experiment ID, branch_type, content_summary, and age
10. An agent reading only the brief can identify what tree work needs doing

### Fork command
11. `sonde fork EXP-NNNN` sets `parent_id` on the new experiment
12. `sonde fork EXP-NNNN --type refinement` sets both `parent_id` and `branch_type`
13. `sonde fork EXP-NNNN "intent description"` sets first line of content at fork time
14. Fork displays existing siblings of the parent before creating (human output)
15. `sonde fork --json` includes `created`, `siblings`, and `parent` objects
16. `related` field continues to be populated for backward compat

### Lifecycle (close + start)
17. `sonde close --json` includes `suggested_next` array with command and reason
18. Suggestions are context-aware: different for failed vs complete, leaf vs has-children
19. `sonde start EXP-NNNN` sets `claimed_by` and `claimed_at`
20. If already running by a different worker, warn with conflict details
21. `sonde start --json` includes `conflict` object (or null) for programmatic decision-making
22. `sonde close` / `sonde open` clears `claimed_by` and `claimed_at`

### Tree command
23. `sonde tree DIR-NNNN` renders experiment forest with Rich Tree
24. `sonde tree EXP-NNNN` renders subtree from that root
25. Status is color-coded, branch_type shown in parens, source and relative age shown
26. `--json` outputs structured tree with all fields agents need
27. `--depth N` limits rendering depth
28. Findings annotated on evidence experiments
29. `--active` prunes completed subtrees
30. `--mine` filters to current actor's branches
31. `--leaves` shows only leaf experiments
32. Filters compose

### Show command
33. `sonde show EXP-NNNN` displays parent and children when present
34. `sonde show --json` includes `parent_id`, `branch_type`, parent summary, children array

### List command
35. `sonde list --json` includes `parent_id` and `branch_type` fields
36. `sonde list -d DIR-001` shows `↳` prefix for child experiments
37. `sonde list --roots` filters to root experiments only
38. `sonde list --children-of EXP-NNNN` lists direct children

### Skills
39. `sonde-research.md` includes branching section with fork/tree/close workflow
40. `sonde-research.md` discovery workflow includes tree as step 2.5
41. `sonde-formatter.md` clarifies parent_id (automatic from fork) vs related (manual "see also")
42. `.cursor/rules/` mirrors are updated

### End-to-end: the agentic scientist
43. An agent that runs only `brief → show → start → close → fork` (no `tree`, no skill) can navigate the research tree and avoid duplicate work, using only the JSON output from each command

---

*Related:*
- *tickets/001-knowledge-graph-layer.md — entity/edge model for knowledge graph*
- *tickets/007-living-knowledge-base.md — provenance, sync health, multi-layer curation*
- *repos/AI-Scientist-v2 — source of tree search architecture*
