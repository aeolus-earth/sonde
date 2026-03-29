# Aeolus CLI — Product Requirements

The research platform layer. Data, experiments, knowledge. The nouns.

---

## The separation

There are three distinct things. They must not be conflated.

```
┌──────────────────────────────────────────────────────────────┐
│  AEOLUS CLI                                                  │
│  The research platform. Tracks experiments, catalogs data,   │
│  stores knowledge. Doesn't know or care who's calling it.    │
│                                                              │
│  Users: humans in terminal, Claude Code, Codex, sondes,      │
│         trading pipeline, web dashboard, future products.     │
├──────────────────────────────────────────────────────────────┤
│  AEOLUS SKILLS + MCP SERVER                                  │
│  Claude Code / Codex skills that know how to use the CLI.    │
│  MCP server exposes the same capabilities with typed         │
│  schemas so any Claude instance can discover them.           │
│                                                              │
│  Users: any Claude instance (IDE, terminal, headless).       │
├──────────────────────────────────────────────────────────────┤
│  SONDE                                                       │
│  The agent runtime. Launches and manages autonomous,         │
│  long-running headless agents. A verb, not a noun.           │
│                                                              │
│  Users: team members who need autonomous agents.             │
│  Depends on: aeolus CLI (for data, experiments, knowledge).  │
└──────────────────────────────────────────────────────────────┘
```

### Why this separation matters

**A human scientist using Claude Code in their IDE and a sonde running overnight should produce experiment records that are indistinguishable.** The experiment schema is the universal format. The institutional memory doesn't care who produced it.

If the CLI has agent logic baked in, humans can't use it naturally. If sonde has experiment tracking baked in, humans can't log their own work the same way. The clean cut:

- **aeolus** = knows about research (experiments, data, knowledge). Knows nothing about agents.
- **sonde** = knows about agents (launch, monitor, lifecycle). Uses aeolus for everything research-related.
- **skills** = knows how to make Claude instances fluent in aeolus. Knows nothing about sonde.

---

## The experience we're designing for

### Scenario 1: Human scientist in IDE (Claude Code + skills)

```
Human: I just ran a cloud seeding sim manually with CCN=1200,
       got a 6.3% precip delta. Log this.

Claude Code (using aeolus skill):
  → calls: aeolus experiment log \
      --use-case weather-intervention \
      --hypothesis "hygroscopic seeding increases maritime Cu precip" \
      --params '{"ccn": 1200, "microphysics": "bulk_2moment"}' \
      --result '{"precip_delta_pct": 6.3}' \
      --finding "Consistent with SONDE-047 results at similar CCN"
  → writes experiment.yaml to current branch
  → indexes it

Claude Code: Logged as EXP-0073. This is consistent with SONDE-047's
  finding that precip enhancement plateaus above CCN ~1500. Want me
  to pull up the comparison?
```

### Scenario 2: Human scientist exploring data (Claude Code + skills)

```
Human: What ERA5 data do we have for the North Atlantic? I want
       to set up boundary conditions for a new sim.

Claude Code (using aeolus skill):
  → calls: aeolus data check era5 --region north_atlantic
  → returns structured coverage info

Claude Code: We have ERA5 pressure-level data for 30°N-70°N,
  60°W-10°E, 2020-2025, 6-hourly. Surface fields available too.
  Want me to fetch March 2025 for your sim setup?
```

### Scenario 3: Human scientist querying experiment history

```
Human: What do we know about boundary layer heating interventions?

Claude Code (using aeolus skill):
  → calls: aeolus experiments search --use-case weather-intervention \
      --keyword "boundary layer heating"
  → calls: aeolus knowledge findings --topic "boundary layer heating"

Claude Code: We've run 8 experiments on BL heating (EXP-0031 through
  EXP-0068). Key findings: heating rates above 200 W/m² destabilize
  the boundary layer within 2 hours but...
```

### Scenario 4: Sonde agent (autonomous, calls same CLI)

```
# Inside the sonde's execution loop, stage 4:
$ aeolus experiments search --param domain=north_atlantic --param ccn_range
# → learns what's been tried
$ aeolus data fetch era5 --region north_atlantic --date 2025-03-15
# → gets initial conditions
# ... runs simulation ...
$ aeolus experiment log --use-case weather-intervention \
    --source sonde/049 --params '...' --result '...'
# → logs result exactly like a human would
```

### Scenario 5: Team lead checking the dashboard

The dashboard reads the same experiment index the CLI queries. It doesn't have its own data store. It calls `aeolus experiments list --format json` or reads the same underlying files.

**One source of truth. Multiple interfaces. Same data regardless of who produced it.**

---

## Aeolus CLI — Command surface

### `aeolus experiment` — the core noun

This is the most important subcommand group. It's the experiment ledger.

```bash
# Log a new experiment (human or agent)
aeolus experiment log \
  --use-case weather-intervention \
  --hypothesis "..." \
  --params '{"ccn": 1200, ...}' \
  --result '{"precip_delta_pct": 6.3}' \
  --finding "..." \
  --source human/mlee          # or sonde/049, trading/daily-2026-03-29
  --data-sources era5,hrrr     # which data was used
  --artifacts results/run-012/ # path to output files

# Query experiments
aeolus experiment list                                  # all
aeolus experiment list --use-case weather-intervention   # filtered
aeolus experiment search --param ccn_range --param domain=north_atlantic
aeolus experiment show EXP-0073                         # full detail
aeolus experiment compare EXP-0047 EXP-0073             # side-by-side
aeolus experiment gaps --use-case weather-intervention   # what hasn't been tried

# The experiment.yaml it writes:
# id: EXP-0073
# timestamp: 2026-03-29T14:22:00Z
# source: human/mlee
# use_case: weather-intervention
# hypothesis: ...
# parameters: {ccn: 1200, microphysics: bulk_2moment, ...}
# data_sources: [era5, hrrr]
# results: {precip_delta_pct: 6.3, ...}
# finding: ...
# artifacts: [results/run-012/precipitation_delta.nc, ...]
# related: [EXP-0047, SONDE-047]
```

Key design decisions:
- **`--source` is required.** Every experiment is attributed: `human/<username>`, `sonde/<id>`, `trading/<run-date>`. This is how you know who produced what.
- **Schema is enforced but extensible.** Required fields: use_case, source, parameters, results. Optional: hypothesis, finding, related, artifacts. Custom fields allowed under `metadata:`.
- **Storage is git.** `experiment.yaml` is written to the current branch (for human/IDE work) or the sonde's branch (for autonomous work). The index scans all branches.

### `aeolus data` — the catalog

```bash
aeolus data list                           # all configured sources
aeolus data sources --use-case weather     # relevant to weather research
aeolus data check era5 --region north_atlantic --date 2025-03
aeolus data fetch era5 --region north_atlantic --date 2025-03-15 --output ./ic/
aeolus data describe era5                  # full coverage, variables, format
```

Each data source is a connector module with a standard interface:
- `describe()` → what it provides, coverage, format
- `check(query)` → is this data available?
- `fetch(query, output_path)` → download it

### `aeolus knowledge` — accumulated learning

```bash
aeolus knowledge findings --use-case weather-intervention
aeolus knowledge findings --topic "cloud seeding"
aeolus knowledge findings add --topic "..." --finding "..." --evidence EXP-0047,EXP-0073
aeolus knowledge skills list               # available reusable procedures
aeolus knowledge weights                   # trading agent Darwinian weights
aeolus knowledge prompts --agent financials # prompt evolution history
```

Findings are curated — either a human adds them explicitly or a sonde proposes them and a human approves. Not every experiment result is a finding. Findings are the distilled knowledge.

---

## Aeolus Skills — making Claude instances fluent

Skills are markdown files that teach Claude Code / Codex how to use the aeolus CLI naturally. They live in a repo that gets cloned to `.claude/skills/` (same pattern as agentic-data-scientist's claude-scientific-skills).

### Skill: Log Experiment

```markdown
# Log Experiment

When the user has run an experiment (simulation, analysis, manual test)
and wants to record it, use the aeolus CLI to log it.

## When to use
- User says "log this", "record this experiment", "save these results"
- User has just completed a simulation run and has results
- You've helped the user run code that produced measurable outcomes

## How to use
1. Gather from context: what was tested, what parameters, what results
2. Ask the user to confirm if anything is ambiguous
3. Run: aeolus experiment log --use-case <X> --params '<JSON>' --result '<JSON>' ...
4. Confirm the experiment ID to the user
5. Suggest related experiments if relevant

## Important
- Always include --source human/<username> for interactive work
- Always link artifacts if output files exist
- Use --related to connect to prior experiments on the same topic
```

### Skill: Search Experiments

```markdown
# Search Experiments

When the user wants to know what's been tried, what worked, or what
gaps exist in the experiment history.

## When to use
- User asks "what have we tried", "what do we know about X"
- User is planning a new experiment and should know what's been done
- Before designing any new simulation, ALWAYS check experiment history first

## How to use
1. Run: aeolus experiment search --use-case <X> --param <key>=<value>
2. Summarize results — highlight key findings and parameter ranges covered
3. If the user is planning new work, run: aeolus experiment gaps --use-case <X>
4. Suggest unexplored parameter ranges or hypotheses
```

### Skill: Data Discovery

```markdown
# Data Discovery

When the user needs to know what data is available or wants to fetch
data for an experiment.

## When to use
- User asks about available data
- User is setting up simulation initial/boundary conditions
- Before any simulation setup, check what data covers the target domain

## How to use
1. Run: aeolus data check <source> --region <X> --date <Y>
2. Report coverage, resolution, available variables
3. If user wants to proceed: aeolus data fetch <source> --output <path>
4. Suggest complementary data sources if relevant
```

### MCP server: same skills, typed interface

The skills above are markdown (for Claude Code / Codex). The same capabilities are also exposed as an MCP server with typed schemas:

```
MCP Server: aeolus-research
Tools:
  experiment_log(use_case, params, result, source, ...) → experiment_id
  experiment_search(use_case?, param_filter?, keyword?) → [experiment]
  experiment_gaps(use_case) → [gap_description]
  experiment_compare(id_a, id_b) → comparison
  data_check(source, region?, date_range?) → coverage
  data_fetch(source, region, date_range, output_path) → file_paths
  knowledge_findings(use_case?, topic?) → [finding]
  knowledge_findings_add(topic, finding, evidence) → finding_id
```

The MCP server calls the same CLI underneath. It's a typed wrapper, not a separate implementation.

**Any Claude instance — IDE, terminal, headless sonde, future product — can discover these tools and use them.** The human scientist's Claude Code and the autonomous sonde call the same `experiment_log` with the same schema. The only difference is `source: human/mlee` vs `source: sonde/049`.

---

## What the aeolus CLI is NOT

1. **Not an agent runtime.** It doesn't launch agents, manage processes, or orchestrate pipelines. That's sonde.
2. **Not an LLM wrapper.** It doesn't call models. It's a plain CLI that stores and queries structured data. Claude instances use it through skills/MCP — the CLI itself has no AI in it.
3. **Not a framework.** It doesn't impose a workflow. A human can log experiments in whatever order they want. A sonde can call it at any stage. It's a ledger, not a pipeline.
4. **Not a database.** It reads and writes YAML files in git. The "database" is the filesystem + git history. This may change later (SQLite for indexing), but the source of truth is always the files.

---

## Dependency graph

```
┌─────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  Claude Code │     │  Sonde Agent        │     │  Dashboard   │
│  (IDE)       │     │  (headless)         │     │  (web, r/o)  │
└──────┬───┬──┘     └──────┬───┬──────────┘     └──────┬───────┘
       │   │               │   │                        │
  skills  MCP          skills  MCP                   reads
       │   │               │   │                        │
       ▼   ▼               ▼   ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│                      AEOLUS CLI                              │
│  experiment log/search/compare/gaps                          │
│  data list/check/fetch/describe                              │
│  knowledge findings/skills/weights                           │
├──────────────────────────────────────────────────────────────┤
│                    STORAGE (git + files)                      │
│  experiment.yaml (per branch)                                │
│  connectors/ (data source modules)                           │
│  knowledge/ (findings.yaml, weights.json, prompts/)          │
└──────────────────────────────────────────────────────────────┘

┌──────────────┐
│  SONDE       │  (separate concern — agent lifecycle only)
│  launch      │  depends on aeolus CLI for data/experiments
│  status      │
│  logs        │
│  pause       │
│  message     │
└──────────────┘
```

---

## Build order

1. **`aeolus experiment log` + `experiment list`** — the minimum viable ledger. A human can log and query experiments from day one.
2. **Log Experiment skill** — so Claude Code can do it conversationally. This is the moment it clicks for the team: "oh, I can just tell Claude to log this and it does."
3. **`aeolus experiment search` + `experiment compare`** — querying across experiments. Search Experiments skill.
4. **`aeolus data list` + `data check`** — catalog what data sources exist. Data Discovery skill.
5. **MCP server** — typed wrappers over the CLI. Now sondes can call the same tools.
6. **`aeolus data fetch`** — actually pull data (start with ERA5, add connectors incrementally).
7. **`aeolus experiment gaps`** — the "what hasn't been tried" query. This is where the compounding kicks in.
8. **`aeolus knowledge`** — deferred until there are enough experiments to distill findings from.
9. **sonde** (separate package) — agent lifecycle, depends on aeolus CLI.
10. **Dashboard** — read-only web view over experiment index. Last priority.

---

## Tech choices

| Choice | Rationale |
|--------|-----------|
| **Click** (not Typer) | More explicit, better subcommand groups, team reads CLI code as documentation |
| **Rich** | Terminal formatting — tables, colored status, progress bars |
| **YAML** (not JSON) for experiment schema | Human-readable, human-editable, comments allowed |
| **Git branches as storage** | Versioned, diffable, survives every stack rewrite |
| **Python package** (`pip install aeolus-cli`) | Standard distribution, importable as library too |
| **MCP server as separate entry point** | `aeolus-mcp serve` starts the typed wrapper server |

---

*Aeolus CLI PRD. See also: `aeolus-architecture.md` (full system architecture), `takeaways-design-philosophy.md` (invest in nouns, keep verbs thin).*
