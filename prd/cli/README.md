# Aeolus CLI — Product Requirements Document

A living knowledge base for scientific research. Built for humans working with agents.

---

## What this is

Aeolus CLI is the research memory of the company. Every experiment, finding, hypothesis, figure, paper, and open question lives here. It's the place a scientist goes to understand what we know, what we've tried, and what to do next.

It's not a notebook. It's not a wiki. It's a structured, queryable, agent-accessible knowledge base that grows every time someone — human or agent — does research.

---

## Who uses it

**Aeolus scientists.** Atmospheric researchers running NWP simulations on HPC clusters. They use Claude Code in their terminal. They want to log experiments with one command and move on. They don't want to fill out forms.

**Quantitative researchers.** Building weather-informed energy trading signals. They need to see trading-relevant data without wading through atmospheric intervention work.

**Agents.** Claude Code sessions, Codex tasks, Cursor agents, Slack bots. They query the knowledge base, propose experiments, update findings, open questions. They write the same records humans do.

**Team leads.** They need to see what's in flight, what we've learned, where the gaps are. They'll consume this through dashboards, Notion syncs, or reports — not the CLI directly.

---

## Design principles

### 1. One command to log, zero friction to query

A scientist just finished a simulation run on the HPC cluster. They're in a terminal with Claude Code. The interaction should be:

```
Human: log this experiment — CCN 1200, spectral bin microphysics,
       got 5.8% precip delta, lower than bulk scheme at same CCN

Claude Code: [calls aeolus experiment log with structured fields,
             attaches the output files, links to the git commit]

Done. Back to work.
```

If logging takes more than 30 seconds, people won't do it. If it requires switching tools, opening a browser, or filling out a form, people won't do it. The CLI must be fast enough that logging is a side effect of working, not a separate task.

### 2. Human and agent records are indistinguishable

The schema doesn't know who wrote it. A `source` field says `human/mlee` or `codex/task-abc` or `slack-bot/channel-research`, but the experiment record itself is identical. This is how institutional memory compounds — every contributor feeds the same graph.

### 3. Provenance is permanent

Every experiment record links to:
- The **git commit** that contains the code/config that produced it
- The **data sources** (STAC references) used as inputs
- The **artifacts** (figures, output files, papers) it produced
- The **agent session or human** who logged it
- The **timestamp** of when it was logged and when the experiment was run

Years from now, someone should be able to trace any finding back to the exact code, data, and reasoning that produced it. This is non-negotiable for science.

### 4. Scoped access, not one big bucket

An energy trading agent doesn't need to see atmospheric intervention work. A research scientist doesn't need trading signal history cluttering their queries. The knowledge base supports **namespaces** (called "programs") that partition data cleanly:

- `weather-intervention` — NWP simulations, cloud seeding, boundary layer experiments
- `energy-trading` — market signals, weather-to-energy translation, agent performance
- `shared` — cross-cutting knowledge (data source documentation, methods, tools)

Every query is scoped to one or more programs. Agents are granted access to specific programs via their mission config. This is not an afterthought — it's built into every command.

### 5. The knowledge base is alive

This is not an archive. It's a living graph that agents and humans update continuously. Experiments get logged. Findings get added, revised, superseded. Open questions get posted, picked up, answered. Research directions evolve as evidence accumulates.

Staleness is the enemy. If the knowledge base doesn't reflect what we learned yesterday, people stop trusting it. The design must make updates so easy that they happen naturally during work, not as a separate "documentation" task.

---

## Core concepts

### Experiment

The atomic unit of research. Someone tested something, observed a result, and (optionally) drew a conclusion.

```
┌──────────────────────────────────────────────────────┐
│ EXPERIMENT                                           │
│                                                      │
│ id: EXP-0073                                         │
│ program: weather-intervention                        │
│ status: complete                                     │
│ source: human/mlee                                   │
│                                                      │
│ hypothesis: Hygroscopic seeding increases precip     │
│             in maritime Cu at CCN > 1000 cm⁻³        │
│                                                      │
│ parameters:                                          │
│   ccn: 1200                                          │
│   microphysics: bulk_2moment                         │
│   domain: north_atlantic_25km                        │
│   duration_hours: 48                                 │
│                                                      │
│ results:                                             │
│   precip_delta_pct: 6.3                              │
│   convergence: true                                  │
│   wall_time_minutes: 34                              │
│                                                      │
│ finding: Enhancement consistent with EXP-0047.       │
│          Flattening suggests saturation ~CCN 1500.   │
│                                                      │
│ provenance:                                          │
│   git_commit: abc123def                              │
│   git_repo: aeolus/breeze-experiments                │
│   data_sources:                                      │
│     - stac://era5/2025-03-15/plevels/north-atlantic  │
│   artifacts:                                         │
│     - s3://aeolus/exp-0073/precipitation_delta.nc    │
│     - s3://aeolus/exp-0073/figures/precip_compare.png│
│                                                      │
│ related: [EXP-0047, EXP-0068]                        │
│ direction: DIR-003                                   │
│ tags: [cloud-seeding, maritime-cumulus, hygroscopic]  │
│ created_at: 2026-03-29T14:22:00Z                     │
└──────────────────────────────────────────────────────┘
```

**Statuses:** `open` (hypothesis stated, not yet run), `running`, `complete`, `failed`, `superseded` (a later experiment replaced this one's conclusions).

**Open experiments** are first-class. They represent "someone thinks we should test this." They can be created by a human ("I wonder if spectral bin gives different results"), by an agent running gap analysis, or by a Slack bot capturing a team discussion. They sit in the backlog until someone — human or agent — picks them up.

### Finding

Distilled knowledge derived from one or more experiments. Findings are the conclusions — they're what you'd tell someone who asks "what do we know about X?"

```
┌──────────────────────────────────────────────────────┐
│ FINDING                                              │
│                                                      │
│ id: FIND-012                                         │
│ program: weather-intervention                        │
│ topic: CCN saturation threshold                      │
│ confidence: high                                     │
│                                                      │
│ finding: Precipitation enhancement from hygroscopic  │
│          seeding saturates above CCN ~1500 cm⁻³ in   │
│          maritime cumulus. Diminishing returns above  │
│          this threshold regardless of microphysics   │
│          scheme.                                     │
│                                                      │
│ evidence: [EXP-0047, EXP-0073, EXP-0082]            │
│ supersedes: FIND-008                                 │
│ valid_from: 2026-03-29                               │
│ valid_until: null  (still current)                   │
│                                                      │
│ source: human/mlee                                   │
│ created_at: 2026-03-29T15:00:00Z                     │
└──────────────────────────────────────────────────────┘
```

Findings have **temporal validity**. When new evidence changes our understanding, the old finding is superseded (not deleted). You can always ask "what did we believe on March 15?" and get the answer as of that date.

### Direction

A research question that requires multiple experiments to answer. Directions organize experiments into coherent threads.

```
┌──────────────────────────────────────────────────────┐
│ DIRECTION                                            │
│                                                      │
│ id: DIR-003                                          │
│ program: weather-intervention                        │
│ status: active                                       │
│                                                      │
│ question: What CCN concentration maximizes precip    │
│           enhancement without triggering excessive   │
│           evaporation in maritime environments?       │
│                                                      │
│ experiments: [EXP-0031, EXP-0032, EXP-0047,         │
│              EXP-0073, EXP-0082]                     │
│ findings: [FIND-008, FIND-012]                       │
│ open_experiments: [EXP-0090, EXP-0091]               │
│                                                      │
│ created_at: 2026-03-10                               │
│ last_activity: 2026-03-29                            │
└──────────────────────────────────────────────────────┘
```

### Question

An open question — something we want to investigate but haven't scoped into an experiment yet. Questions are the lightest-weight object. They capture ideas before they're formalized.

```
┌──────────────────────────────────────────────────────┐
│ QUESTION                                             │
│                                                      │
│ id: Q-042                                            │
│ program: weather-intervention                        │
│ status: open                                         │
│                                                      │
│ question: Does boundary layer heating interact with  │
│           seeding? Could combined intervention be     │
│           more effective than either alone?           │
│                                                      │
│ context: Came up in Slack discussion after EXP-0068  │
│          showed fast convective initiation from BL   │
│          heating. Nobody has tested combined.         │
│                                                      │
│ source: slack-bot/channel-research                   │
│ raised_by: mlee                                      │
│ promoted_to: null  (not yet an experiment or dir)    │
│ created_at: 2026-03-29T16:00:00Z                     │
└──────────────────────────────────────────────────────┘
```

Questions can be **promoted** to open experiments or new research directions. They're the inbox of the research program.

### Artifact

A file attached to an experiment, finding, or direction. Figures, papers, datasets, simulation output, analysis notebooks.

```
┌──────────────────────────────────────────────────────┐
│ ARTIFACT                                             │
│                                                      │
│ id: ART-0147                                         │
│ type: figure                                         │
│ filename: precip_comparison_ccn_sweep.png             │
│ storage: s3://aeolus/artifacts/ART-0147.png          │
│ parent: EXP-0073                                     │
│ description: Precipitation delta vs CCN, 5 runs      │
│ mime_type: image/png                                  │
│ size_bytes: 248000                                   │
│ created_at: 2026-03-29T14:30:00Z                     │
└──────────────────────────────────────────────────────┘
```

Artifact types: `figure`, `paper`, `dataset`, `notebook`, `config`, `log`, `report`, `other`.

Artifacts are stored in object storage (S3 or local filesystem), not in the database. The database holds metadata + a pointer. This keeps the database lean and lets us handle large simulation output files.

---

## Command surface

### Logging experiments (the critical path)

```bash
# The one-command experience — Claude Code assembles fields from context
aeolus log
# Interactive: prompts for minimum required fields (program, params, results)
# Claude Code skill fills these from conversation context

# Explicit (for scripts, agents, CI)
aeolus log \
  --program weather-intervention \
  --hypothesis "Spectral bin microphysics changes CCN response curve" \
  --params '{"microphysics": "spectral_bin", "ccn": 1200}' \
  --result '{"precip_delta_pct": 5.8}' \
  --finding "8% less enhancement than bulk at same CCN" \
  --source human/mlee \
  --git-ref HEAD \
  --attach figures/precip_delta.png \
  --attach output/precipitation.nc \
  --related EXP-0047,EXP-0073 \
  --direction DIR-003

→ Created EXP-0082 (weather-intervention)
  Attached 2 artifacts
  Linked to DIR-003, related to EXP-0047, EXP-0073
  Provenance: git@aeolus/breeze-experiments:abc123d

# Quick log — minimum viable record
aeolus log --quick \
  --program weather-intervention \
  --params '{"ccn": 1200, "scheme": "spectral_bin"}' \
  --result '{"precip_delta_pct": 5.8}'

→ Created EXP-0082 (weather-intervention) [quick — no hypothesis/finding]

# Open an experiment (backlog item)
aeolus log --open \
  --program weather-intervention \
  --hypothesis "Combined BL heating + seeding is superlinear" \
  --suggested-params '{"heating_rate": 500, "ccn": 1200}'

→ Created EXP-0090 (weather-intervention) [open — not yet run]

# Update a running/open experiment with results
aeolus update EXP-0090 \
  --status complete \
  --result '{"precip_delta_pct": 9.1}' \
  --finding "Combined effect is superlinear — 9.1% vs 6.3% seeding-only + 0% heating-only" \
  --attach figures/combined_intervention.png
```

**`--git-ref HEAD`** captures the current git commit of the working directory. The CLI resolves this to a full SHA + repo URL and stores it as provenance. If omitted, the CLI auto-detects the git context of the current directory.

**`--attach`** uploads files to artifact storage and links them to the experiment. Figures, papers, datasets, notebooks — anything. The CLI infers the type from the extension.

### Querying (progressive narrowing)

```bash
# Tier 1: Browse (greppable table output)
aeolus list                                         # all programs you have access to
aeolus list --program weather-intervention           # experiments in one program
aeolus list --status open                            # backlog across all programs
aeolus list --source human/mlee                      # my experiments
aeolus list --recent 7d                              # last week's activity

# Tier 2: Search (structured queries → Postgres)
aeolus search --param ccn>1000                       # parameter filter
aeolus search --param microphysics=spectral_bin      # exact match
aeolus search --text "convective initiation"         # full-text across hypothesis+finding
aeolus search --tag cloud-seeding --status complete  # combined filters
aeolus search --direction DIR-003                    # all experiments in a direction

# Tier 3: Deep dive
aeolus show EXP-0073                                 # full record with provenance
aeolus show EXP-0073 --artifacts                     # list attached files
aeolus show EXP-0073 --provenance                    # git commit, data sources, full trace
aeolus diff EXP-0047 EXP-0073                        # side-by-side comparison

# Tier 4: Analysis
aeolus gaps --program weather-intervention            # unexplored parameter ranges
aeolus suggest --direction DIR-003                    # next experiments based on coverage
aeolus timeline --program weather-intervention        # chronological activity
aeolus findings --program weather-intervention        # all current findings
aeolus findings --topic "CCN saturation"              # topic-filtered
aeolus findings --as-of 2026-03-15                    # what we believed on a specific date
```

**Default output is a greppable table.** Agents pipe through `grep`, `head`, `awk`. Humans scan visually. No format flag needed.

**`--format json`** for structured agent consumption. **`--format md`** for pasting into reports. Always available, never required.

### Knowledge & questions

```bash
# Findings
aeolus finding add \
  --program weather-intervention \
  --topic "CCN saturation threshold" \
  --finding "Enhancement saturates above CCN ~1500 in maritime Cu" \
  --evidence EXP-0047,EXP-0073,EXP-0082 \
  --confidence high

aeolus finding supersede FIND-008 \
  --new-finding "..." \
  --new-evidence EXP-0082

# Questions (the research inbox)
aeolus question add \
  --program weather-intervention \
  --question "Does BL heating interact with seeding?" \
  --context "Slack discussion after EXP-0068" \
  --source slack-bot/channel-research

aeolus question list --program weather-intervention
aeolus question promote Q-042 --to experiment --assign codex
aeolus question promote Q-042 --to direction

# Directions
aeolus direction create \
  --program weather-intervention \
  --question "Optimal CCN for maritime seeding?"

aeolus direction status DIR-003    # experiments, findings, gaps, suggested next
```

### Artifacts (figures, papers, data)

```bash
# Attach to existing experiment
aeolus attach EXP-0073 figures/precip_delta.png
aeolus attach EXP-0073 paper_draft.pdf --type paper
aeolus attach EXP-0073 output/precip.nc --type dataset

# Bulk attach (after a simulation run)
aeolus attach EXP-0073 results/ --recursive

# Download artifacts
aeolus artifact get ART-0147                  # download to current dir
aeolus artifact get ART-0147 --open           # download and open

# List artifacts for an experiment
aeolus show EXP-0073 --artifacts

# Search artifacts
aeolus artifacts --type figure --program weather-intervention
aeolus artifacts --experiment EXP-0073
```

### Briefing (context for agents)

```bash
# Generate a briefing document for an agent starting work in a program
aeolus brief --program weather-intervention

→ AEOLUS BRIEF: weather-intervention
  Updated: 2026-03-29

  ACTIVE DIRECTIONS (3):
    DIR-003: Optimal CCN for maritime seeding (8 experiments, 2 findings)
    DIR-005: Boundary layer heating interventions (3 experiments)
    DIR-007: Combined intervention strategies (0 experiments, 1 question)

  CURRENT FINDINGS (5):
    FIND-012: CCN enhancement saturates ~1500 cm⁻³ [HIGH confidence]
    FIND-015: BL heating triggers convection <2h at 500 W/m² [MEDIUM]
    ...

  OPEN EXPERIMENTS (4):
    EXP-0090: Combined BL heating + seeding [assigned: codex]
    EXP-0091: Subtropical domain test [unassigned]
    ...

  OPEN QUESTIONS (7):
    Q-042: Does BL heating interact with seeding?
    Q-045: Sensitivity to initial condition source (ERA5 vs GFS)?
    ...

  KEY GAPS:
    - No experiments with spectral bin microphysics (only bulk tested)
    - No experiments outside North Atlantic domain
    - No experiments combining multiple intervention types

# Scoped brief for a specific direction
aeolus brief --direction DIR-003

# Brief as JSON (for agent system prompts)
aeolus brief --program weather-intervention --format json
```

**This is the killer feature for agent onboarding.** When you hand a task to Codex, prepend `aeolus brief --program weather-intervention`. The agent starts with everything we know, not from zero.

---

## Provenance model

Every record traces back to its origins. This is what makes the knowledge base trustworthy for science.

```
EXPERIMENT
  ├── source: who logged it (human/mlee, codex/task-abc, slack-bot/...)
  ├── git_commit: the exact code version that produced results
  ├── git_repo: which repository
  ├── data_sources: STAC references to input data
  ├── artifacts: pointers to output files (figures, data, papers)
  ├── created_at: when the record was created
  ├── run_at: when the experiment was actually executed (can differ)
  └── related: links to other experiments

FINDING
  ├── evidence: which experiments support this conclusion
  ├── supersedes: which prior finding this replaces
  ├── valid_from / valid_until: temporal validity
  └── source: who synthesized this finding

QUESTION
  ├── source: where this question came from
  ├── raised_by: which person/channel
  └── promoted_to: what it became (experiment, direction, or still open)
```

**Git provenance is automatic.** If you're in a git repo when you run `aeolus log`, the CLI captures the current commit SHA, repo remote URL, and branch. No flag needed. This means years later, you can run:

```bash
aeolus show EXP-0073 --provenance
→ Git: aeolus/breeze-experiments @ abc123def (branch: feature/spectral-bin)
  Run: git clone ... && git checkout abc123def
  Data: stac://era5/2025-03-15/pressure-levels/north-atlantic
  Artifacts: 2 files (1 figure, 1 dataset)
```

And reproduce the experiment.

---

## Access control (programs as namespaces)

**Programs** are the scoping mechanism. Every record belongs to exactly one program (except `shared` records which are cross-cutting).

```yaml
# Example: agent mission config
agent:
  source: codex/task-energy-trading-daily
  programs:
    read: [energy-trading, shared]
    write: [energy-trading]
```

This agent can read energy trading data and shared knowledge, but can't see or write atmospheric intervention experiments.

**Implementation:** Postgres Row-Level Security (RLS) on Supabase. Each API key / auth token is associated with a set of program permissions. The CLI authenticates via `AEOLUS_API_KEY` or a config file. RLS enforces scoping at the database level — the application code doesn't need to filter.

**Program examples:**
- `weather-intervention` — atmospheric science research
- `energy-trading` — market signals, agent performance, trading strategies
- `nwp-development` — Breeze.jl development, model validation
- `shared` — data source documentation, methods papers, tool guides

Programs can be created as needed. They're lightweight — just a string tag with an RLS policy.

---

## Sync and integration

The knowledge base is the source of truth. Other tools consume it.

### Notion sync

```bash
# Push a program's findings to a Notion database
aeolus sync notion --program weather-intervention --target "Research Findings"

# Push experiment list to Notion
aeolus sync notion --program weather-intervention --type experiments --target "Experiment Log"
```

An agent (or cron job) runs this periodically. Notion becomes a read-only view of the knowledge base — not the source of truth.

### Slack integration

A Slack bot watches designated channels. When it sees research discussion, it can:

1. **Capture questions.** "Has anyone tested spectral bin on subtropical domains?" → `aeolus question add --source slack-bot/...`
2. **Answer queries.** "@aeolus what do we know about CCN saturation?" → runs `aeolus search --text "CCN saturation"`, posts summary
3. **Notify on activity.** New experiments, new findings, superseded findings → post to relevant channel

The Slack bot calls the same CLI / MCP server. No special integration — it's just another consumer.

### Frontend / API

```bash
# Start the API server (serves the same data the CLI queries)
aeolus serve --port 8080
```

REST API backed by the same Postgres database. The frontend (React, or whatever) calls this API. Endpoints mirror CLI commands:

```
GET  /api/experiments?program=weather-intervention&status=complete
GET  /api/experiments/EXP-0073
GET  /api/experiments/EXP-0073/artifacts
GET  /api/findings?program=weather-intervention
GET  /api/directions/DIR-003
GET  /api/brief?program=weather-intervention
GET  /api/gaps?program=weather-intervention
POST /api/experiments  (create)
PUT  /api/experiments/EXP-0073  (update)
```

Auth: API keys with program-scoped permissions. Same RLS policies as the CLI.

### MCP server

```bash
aeolus mcp serve
```

Exposes the same commands as MCP tools with typed schemas. Any Claude instance (Claude Code, Codex, future agent harnesses) can discover and use them.

---

## Storage architecture

```
┌──────────────────────────────────────────────────┐
│  Supabase (Postgres)                             │
│                                                  │
│  experiments    (structured records, JSONB params)│
│  findings       (temporal validity, evidence)     │
│  directions     (research threads)                │
│  questions      (research inbox)                  │
│  artifacts_meta (pointers to files, not files)    │
│  programs       (namespace definitions)           │
│  provenance     (git commits, data source refs)   │
│                                                  │
│  + Row-Level Security per program                 │
│  + GIN indexes on JSONB (parameters, results)     │
│  + Full-text search indexes                       │
│  + Temporal validity columns on findings          │
├──────────────────────────────────────────────────┤
│  Object Storage (S3 / R2 / local filesystem)     │
│                                                  │
│  Artifacts: figures, papers, datasets, notebooks  │
│  Organized: /artifacts/{artifact-id}/{filename}   │
│  Referenced by artifacts_meta table               │
├──────────────────────────────────────────────────┤
│  STAC Catalog (data source registry)             │
│                                                  │
│  External data: ERA5, GFS, HRRR, market feeds    │
│  Simulation output: registered after experiments  │
│  Queried by: aeolus data check / aeolus data fetch│
├──────────────────────────────────────────────────┤
│  Git (provenance, not storage)                   │
│                                                  │
│  Experiment code lives in research repos          │
│  aeolus log captures commit SHA automatically     │
│  Years later: trace any result to exact code      │
└──────────────────────────────────────────────────┘
```

**Why Postgres, not files:**
- Concurrent writes from multiple agents and humans without conflicts
- Structured queries with JSONB indexes (sub-millisecond)
- Full-text search across all experiment text
- Row-Level Security for program scoping
- Temporal queries ("what did we believe on March 15?")

**Why object storage for artifacts, not Postgres:**
- Simulation outputs can be gigabytes
- Figures and papers are binary files
- Object storage is cheap and handles large files natively
- Database stays lean — only metadata + pointers

**Why git for provenance, not as storage:**
- The experiment code lives in whatever repo the scientist works in
- The CLI captures the commit SHA at log time — a pointer, not a copy
- Git history of the research code is preserved independently
- You can reproduce any experiment by checking out the referenced commit

---

## What makes this sticky

These are the features that make people want to use it, not just have to.

### 1. The brief is indispensable

Once `aeolus brief --program weather-intervention` exists and stays current, it becomes the thing you read before starting any work. New team member? Read the brief. Starting a new experiment? Read the brief. Handing a task to an agent? Prepend the brief.

If the brief is always accurate and always up-to-date (because it's generated from the live database, not written manually), it becomes the single most valuable document in the company.

### 2. Gap analysis saves thinking time

`aeolus gaps` and `aeolus suggest` do the tedious part of research planning — surveying what's been tried, identifying coverage holes, proposing next experiments. A scientist can go from "I wonder what to work on next" to "here are 5 high-value experiments ranked by impact" in 10 seconds. This is the feature that makes people open the CLI proactively, not just when they have to log something.

### 3. Questions capture ideas before they're lost

A Slack conversation surfaces a great research question at 3pm. By 4pm everyone's moved on. With the Slack bot capturing questions into the knowledge base, that idea is preserved, queryable, and promotable to a real experiment later. The research inbox grows organically from team discussion.

### 4. One-command logging from anywhere

On the HPC cluster, in a Jupyter notebook, in a Slack thread, in a Claude Code session — wherever research happens, logging is one command away. `aeolus log --quick` with just params and results is the minimum viable record. Claude Code skills fill in the rest from context.

### 5. Provenance builds trust

When a finding is questioned ("are we sure CCN saturates at 1500?"), anyone can run `aeolus show FIND-012 --provenance`, see the three experiments that support it, click through to the exact git commits, and verify. This is what turns a knowledge base from "someone's notes" into "our evidence base."

### 6. Agents get smarter over time

Every experiment an agent runs adds to the knowledge base. The next agent task starts with a richer brief, better gap analysis, and more context. This is the compounding loop: more experiments → better briefs → better-targeted new experiments → more experiments. The knowledge base is the flywheel.

---

## Build phases

### Phase 1: The ledger (weeks 1-2)

Core data model in Postgres. CLI commands: `log`, `list`, `search`, `show`, `update`.

- Pydantic models for Experiment, Finding, Direction, Question, Artifact
- Supabase project with tables, indexes, RLS
- `aeolus log` and `aeolus log --quick`
- `aeolus list` and `aeolus search`
- `aeolus show` and `aeolus diff`
- Git provenance auto-detection
- `--format` flag (table, json, md)

**Exit criteria:** A scientist can log an experiment from the HPC cluster and query it from their laptop.

### Phase 2: Skills + attachments (weeks 3-4)

Claude Code skills. Artifact storage. Program scoping.

- Log Experiment skill, Search Experiments skill, Data Discovery skill
- `aeolus attach` + artifact upload to S3/local
- Program-based RLS
- `aeolus brief` command

**Exit criteria:** A Claude Code session can log experiments conversationally and start with a brief.

### Phase 3: Living knowledge (weeks 5-6)

Findings, questions, directions. Gap analysis.

- `aeolus finding add/supersede/list`
- `aeolus question add/list/promote`
- `aeolus direction create/status`
- `aeolus gaps` and `aeolus suggest`

**Exit criteria:** An agent can query gaps, propose experiments, and a human can review and prioritize.

### Phase 4: Integration (weeks 7-8)

MCP server. Notion sync. Slack bot. API server.

- `aeolus mcp serve`
- `aeolus sync notion`
- Slack bot (question capture, query answering)
- `aeolus serve` (REST API for frontend)

**Exit criteria:** The knowledge base is accessible from CLI, Claude Code, Slack, Notion, and a web dashboard.

### Phase 5: STAC + data catalog (weeks 9-10)

Data source management. STAC integration.

- `aeolus data list/check/fetch`
- STAC catalog for atmospheric data
- Simulation output registration in STAC
- Data source references in experiment records resolve to real files

**Exit criteria:** An agent can discover available data, fetch it, run a simulation, and log the experiment with full data provenance.

---

## Tech stack

```
Python 3.12+
Click              — CLI framework
Rich               — terminal formatting
Pydantic           — schema validation + serialization
Supabase (Postgres)— structured storage, RLS, full-text search
S3 / R2 / local    — artifact storage
pystac             — STAC catalog (phase 5)
GitPython          — git provenance auto-detection
httpx              — API client (for Supabase, STAC, Notion)
```

Single package: `pip install aeolus`. Entry point: `aeolus`.

No LLM dependency. No embedding service. No graph database. The CLI is a data management tool. Intelligence comes from the agents that use it.

---

## Open design questions

These need team input before building.

1. **Artifact storage:** S3 (standard, scalable) vs. R2 (cheaper, Cloudflare) vs. local filesystem (simplest for HPC)? Or a pluggable backend?

2. **STAC hosting:** Static catalog generated by CLI vs. stac-fastapi server? Static is simpler but can't handle dynamic queries over large catalogs.

3. **Experiment ID format:** Sequential (`EXP-0073`) vs. content-addressed (hash of params+timestamp) vs. human-readable slug (`weather/ccn-1200-spectral-bin`)? Sequential is simplest. Slugs are most memorable. Content-addressed prevents duplicates.

4. **Offline mode:** Should the CLI work without Supabase connectivity (log to local files, sync later)? Important for HPC nodes with restricted network access.

5. **Schema evolution:** When we add new fields to the experiment schema, how do we handle existing records? Nullable new fields with defaults? Migration scripts?

---

*Aeolus CLI PRD. Internal document for the Aeolus team.*
*Updated 2026-03-29.*
