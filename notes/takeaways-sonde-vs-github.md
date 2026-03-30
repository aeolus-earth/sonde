# Takeaways: Why Sonde Exists (and When to Just Use GitHub)

Sonde and GitHub overlap significantly for small teams. This doc clarifies when each earns its keep, and why the 500-agent future needs a database, not a repo.

---

## The honest overlap

GitHub already gives you:
- Markdown files as experiment records (commit = logged)
- `git log` / `git blame` as activity history
- Issues as research inbox / experiment proposals
- PRs as experiment review
- Code search / grep across files
- Permissions at the repo level
- Native support in every agent (Claude Code, Codex, Cursor)

For a 5-person team with 30 experiments, a git repo with markdown conventions genuinely works. No database, no CLI, no extra infrastructure.

## Where GitHub breaks down

### At scale: 500 autonomous agents

When hundreds of agents are each working on different parts of the research graph concurrently:

**Concurrent writes.** 50 agents pushing experiments at the same time. Git merge conflicts on shared files (the experiment index, findings docs, tag files). Constant rebases, conflict resolution, failed pushes. Postgres handles concurrent inserts natively — 500 agents writing simultaneously is a non-event.

**Structured queries.** "Show me all experiments in weather-intervention where CCN > 1000 and status is complete, sorted by date." GitHub's answer: grep + manual filtering. Sonde's answer: one indexed query, sub-millisecond. At 500 experiments this is annoying. At 5,000 it's unusable.

**Program scoping / RBAC.** Agent working on energy trading should not see atmospheric intervention experiments. GitHub repos are all-or-nothing — separate repos fracture the knowledge base, same repo exposes everything. Sonde's row-level security scopes access at the record level. An agent token sees exactly the programs it's authorized for.

**Activity across types.** "What happened in weather-intervention this week?" means querying across experiments, findings, notes, tags, status changes. In git: `git log --since=7.days` shows commits, but not structured activity. In sonde: one query across the activity_log table, filtered by program.

**Brief / computed summaries.** `sonde brief` generates a live summary — findings, gaps, open work, recent activity — computed from the database. In GitHub: this would be a manually maintained README that drifts from reality within a day when agents are writing autonomously.

**Agent tokens with scoped access.** Each autonomous agent gets a JWT scoped to specific programs with an expiry date. Revocable. Auditable. GitHub PATs give repo-level access — no experiment-level scoping.

**Large binary artifacts.** GitHub has a 100MB file limit. Simulation output (NetCDF, Zarr) is routinely hundreds of MB to GB. Sonde routes to Supabase Storage or S3 natively.

### The tipping point

| Scale | Use | Why |
|-------|-----|-----|
| 1-5 people, <50 experiments | GitHub + markdown conventions | Grep is fast enough. Merge conflicts are rare. Manual README works. |
| 5-20 people, 50-500 experiments | Sonde + GitHub for code | Structured queries matter. Brief saves time. Activity log needed. |
| 20+ people or 100+ autonomous agents | Sonde is essential | Concurrent writes, RBAC, agent tokens, computed summaries. Git can't handle this. |

## How to integrate cleanly with GitHub

Sonde doesn't replace GitHub. GitHub manages code. Sonde manages knowledge. They reference each other.

### Git provenance on every experiment

Every `sonde log` and `sonde push` auto-captures:
- `git_commit`: the exact SHA
- `git_repo`: the remote URL
- `git_branch`: the current branch

Two weeks later, someone can trace any experiment back to the exact code that produced it. This is already built.

### The PRD vision (from `prd/cli/github-integration.md`):

- **`--git-commit` flag**: log experiment AND create a git commit in one command. The experiment ID goes in the commit message. The commit SHA goes in the experiment record. Linked at birth.
- **`.aeolus.yaml` in repos**: sets default program and direction. `sonde` commands in that repo are automatically scoped.
- **GitHub Actions**: push a branch with experiment results → Action syncs to sonde. PRs auto-generate experiment summary tables.
- **GitHub Issues ↔ Questions**: issue labeled `aeolus/question` auto-creates a Question in sonde. Open experiments can create GitHub Issues.

### The principle

> **GitHub is where code lives. Sonde is where knowledge lives.** They reference each other with stable links (commit SHAs, experiment IDs, PR URLs). Neither tries to be the other.

An agent working on an experiment:
1. Writes code in a git branch
2. Runs the simulation
3. Logs the experiment in sonde (`sonde push` — captures git context automatically)
4. The experiment record points to the commit. The commit message contains the experiment ID.

Bidirectional. Permanent. No manual cross-referencing.

## When to NOT use sonde

- You're a solo researcher running a few experiments manually → git repo
- All your data fits in git (no large binaries) → git repo
- You don't need program-level access control → git repo
- You don't have autonomous agents → git repo
- You're prototyping and schema will change weekly → git repo (less migration overhead)

## When sonde is the right call

- Multiple autonomous agents writing concurrently
- Need to query across experiments by parameters, tags, metadata, text
- Need program-level RBAC (energy trading ≠ atmospheric research)
- Need computed summaries (brief, gaps, recent activity)
- Large binary artifacts (simulation output, datasets)
- Need an audit trail of who changed what (not just who committed)
- Want agents to `pull` a local workspace, `grep` it, and `push` results back

## The 500-agent scenario

This is where the architecture pays off:

```
500 agents, each with a scoped SONDE_TOKEN
  │
  ├── Agent-001 (weather-intervention, CCN sensitivity)
  │   → sonde log, sonde push, sonde note
  │   → writes to Postgres (no merge conflicts)
  │   → code lives in git branch (linked via git_commit)
  │
  ├── Agent-002 (weather-intervention, domain sensitivity)
  │   → same program, different experiments
  │   → concurrent writes just work
  │
  ├── Agent-003 (energy-trading, demand forecasting)
  │   → different program, can't see weather data (RLS)
  │   → separate token, separate scope
  │
  └── ...Agent-500
      → sonde brief still works (computed from database)
      → sonde recent shows the last 50 actions across all agents
      → sonde search finds anything by text, tags, metadata
      → no git conflicts, no manual merges, no stale READMEs
```

Git can't do this. A repo with 500 agents pushing commits would be a merge conflict nightmare. Sonde's database handles it because that's what databases are for — concurrent structured writes with indexed queries.

**Git is the right tool for code. A database is the right tool for concurrent structured data. Sonde puts a research-friendly CLI in front of the database.**

---

*See also: `aeolus-architecture.md` (system architecture), `takeaways-design-philosophy.md` (invest in nouns, keep verbs thin), `prd/cli/github-integration.md` (git integration plan)*
