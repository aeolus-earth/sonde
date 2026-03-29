# Aeolus CLI — Scope & Starting Point

The CLI is a **scientific discovery management system**. Not an agent harness. Not an LLM wrapper. A structured way to track, query, and plan research — usable by humans directly and by any agent (Claude Code, Codex, Cursor) through skills or MCP.

---

## The key decision: no harness engineering

We are not building an agent runtime. Claude Code, Codex, and Cursor already solve the harness problem — launching agents, managing context, tool calling, code execution, sandboxing. They're investing billions in this. We don't compete there.

We build the thing they can't build: a domain-specific research management layer that makes any agent (or human) effective at atmospheric science and energy trading research.

```
┌──────────────────────────────────────────────────┐
│  AGENT HARNESS (not ours)                        │
│  Claude Code / Codex / Cursor / future tools     │
│  They handle: LLM calls, tool use, code exec,    │
│  context management, sandboxing                   │
├──────────────────────────────────────────────────┤
│  AEOLUS CLI (ours)                               │
│  We handle: experiment tracking, data catalog,   │
│  knowledge management, research direction         │
│  planning, thesis generation support              │
├──────────────────────────────────────────────────┤
│  STAC CATALOG (ours, standard protocol)          │
│  We handle: what data exists, spatial/temporal    │
│  coverage, simulation output registration         │
└──────────────────────────────────────────────────┘
```

The boundary is clean: the agent harness calls our CLI (or MCP server). Our CLI doesn't know what agent is calling it. A human typing in a terminal is identical to Codex running a task.

---

## What the CLI manages

### 1. Experiments — the ledger of what we've tried

Every research action that produces a result gets logged. Human or agent, interactive or autonomous, one-off or systematic.

**Core operations:**

```bash
# Record
aeolus experiment log           # interactive — prompts for fields
aeolus experiment log --quick   # minimal: just params + result
aeolus experiment log --from-file experiment.yaml  # batch / agent use

# Query
aeolus experiment list
aeolus experiment search --param ccn_range --use-case weather
aeolus experiment show EXP-0073
aeolus experiment compare EXP-0047 EXP-0073

# Plan
aeolus experiment gaps          # what parameter ranges are unexplored
aeolus experiment suggest       # propose next experiments based on history
```

**The schema (experiment.yaml):**

```yaml
id: EXP-0073
timestamp: 2026-03-29T14:22:00Z
source: human/mlee                    # or codex/task-abc, claude-code/session-xyz
use_case: weather-intervention
status: complete                      # open | running | complete | failed | superseded

hypothesis: >
  Hygroscopic seeding increases precipitation in maritime cumulus
  at CCN concentrations above 1000 cm⁻³.

parameters:
  microphysics: bulk_2moment
  ccn: 1200
  domain: north_atlantic_25km
  duration_hours: 48

data_sources:
  - stac://era5/2025-03-15/pressure-levels/north-atlantic
  - stac://hrrr/2025-03-15/surface

results:
  precip_delta_pct: 6.3
  convergence: true
  wall_time_minutes: 34

finding: >
  Consistent with EXP-0047. Enhancement rate flattening —
  suggests saturation approaching above CCN ~1500.

outputs:
  - stac://simulations/EXP-0073/precipitation_delta.nc
  - plots/precip_comparison.png

related: [EXP-0047, EXP-0068]
tags: [cloud-seeding, maritime-cumulus, hygroscopic]
```

Key fields:
- **`source`** — who produced this. `human/<name>`, `codex/<task-id>`, `claude-code/<session>`, `cursor/<session>`. Required. This is how you know what produced what.
- **`status`** — experiments can be `open` (hypothesis stated, not yet run), `running`, `complete`, `failed`, or `superseded` (a later experiment replaced this one's findings).
- **`hypothesis`** — what you expected to find. Stated before results. This is what makes it science, not just logging.
- **`finding`** — what you actually learned. Can be null for failed/running experiments.
- **`related`** — links to other experiments. Bidirectional. This builds the graph.

### 2. Open experiments — active research threads

This is the feature that makes the CLI a research management tool, not just a log. Experiments can be **open** — a hypothesis has been stated, the question is active, work may or may not be in progress.

```bash
# Open a research thread
aeolus experiment open \
  --use-case weather-intervention \
  --hypothesis "BL heating at 500 W/m² triggers convective initiation within 90 min" \
  --suggested-params '{"heating_rate": 500, "domain": "subtropical"}' \
  --priority high \
  --assigned-to mlee

# See all open threads
aeolus experiment open list
aeolus experiment open list --use-case weather-intervention
aeolus experiment open list --assigned-to mlee

# Update status
aeolus experiment open update EXP-0080 --status running
aeolus experiment open update EXP-0080 --status complete --result '...'

# What's stale?
aeolus experiment open stale     # open > 7 days with no activity
```

**Why this matters:** When you hand a task to Codex or Claude Code, you can say "look at open experiments and pick the highest priority one" or "here's EXP-0080, run the suggested parameters and log the results." The agent doesn't need to know the full research context — the open experiment record contains the hypothesis, suggested approach, and relevant prior work.

### 3. Research directions — thesis generation and exploration planning

This is the layer above individual experiments. A research direction is a question that may require many experiments to answer.

```bash
# Define a research direction
aeolus direction create \
  --title "Optimal CCN range for maritime cloud seeding" \
  --question "What CCN concentration maximizes precipitation enhancement in maritime Cu without triggering excessive evaporation?" \
  --use-case weather-intervention \
  --experiments EXP-0047,EXP-0068,EXP-0073 \
  --status active

# List directions
aeolus direction list
aeolus direction list --status active

# See what we know about a direction
aeolus direction status DIR-003
# → shows: question, all related experiments, current findings,
#    what parameter ranges are covered, what gaps remain,
#    suggested next experiments

# Ask for new thesis suggestions
aeolus direction suggest \
  --use-case weather-intervention \
  --based-on EXP-0047,EXP-0068,EXP-0073
# → outputs structured suggestions based on experiment history
#    (this is where an agent adds value — the CLI provides the
#    data, the agent/human provides the reasoning)
```

**`aeolus direction suggest` is NOT an LLM call.** It assembles context — experiment history, parameter coverage, known gaps, findings — and outputs it as structured text that a human or agent can reason over. The CLI doesn't generate theses. It provides the material from which theses are generated.

```
$ aeolus direction suggest --use-case weather-intervention

RESEARCH DIRECTION ANALYSIS: weather-intervention
=================================================

PARAMETER COVERAGE:
  ccn_range:        [100, 500, 1000, 1200, 1500, 2000]  ← well covered
  microphysics:     [bulk_2moment]                        ← only one scheme tested
  domain:           [north_atlantic_25km]                 ← only one domain tested
  heating_rate:     [200, 500]                            ← sparse
  duration_hours:   [24, 48]                              ← limited

GAPS:
  - No experiments with spectral bin microphysics (only bulk tested)
  - No experiments outside North Atlantic domain
  - No experiments combining seeding + boundary layer heating
  - Heating rate range 200-500 W/m² has only 2 data points

CONVERGENT FINDINGS (multiple experiments agree):
  - Precip enhancement saturates above CCN ~1500 cm⁻³ (EXP-0047, EXP-0073)
  - BL heating at 500 W/m² triggers convection within 2h (EXP-0068)

CONTRADICTIONS:
  - None detected

SUGGESTED NEXT EXPERIMENTS:
  1. [HIGH] Test spectral bin microphysics with CCN=1200
     (controls for: microphysics scheme sensitivity)
  2. [HIGH] Test subtropical domain with same CCN range
     (controls for: domain sensitivity)
  3. [MEDIUM] Combined seeding + BL heating
     (new interaction: no prior data)
  4. [LOW] Fill heating rate gap: 300, 400 W/m²
     (refinement: existing data brackets this range)
```

This output is what you paste into Claude Code or Codex and say: "Run suggestion #1." The agent takes it from there — using the CLI to fetch data, run the sim, and log the result.

### 4. Data catalog — what's available (STAC-backed)

```bash
aeolus data list                              # all collections
aeolus data check era5 --region north_atlantic --date 2025-03
aeolus data check market --source power_prices --date 2026-03
aeolus data fetch stac://era5/2025-03-15/pressure-levels/north-atlantic
aeolus data register --collection simulations --experiment EXP-0073 \
  --file results/precipitation_delta.nc --bbox "-60,30,-10,70"
```

STAC catalog underneath. The CLI is the human/agent-friendly wrapper.

### 5. Knowledge — distilled findings and accumulated learning

```bash
aeolus knowledge findings list
aeolus knowledge findings list --topic "cloud seeding"
aeolus knowledge findings add \
  --topic "CCN saturation" \
  --finding "Precip enhancement saturates above CCN ~1500 cm⁻³" \
  --evidence EXP-0047,EXP-0073 \
  --confidence high

aeolus knowledge findings for-agent --use-case weather-intervention
# → outputs all findings as structured context an agent should know
#    before starting new research in this area
```

`knowledge findings for-agent` is the briefing document. When you give Codex a task, you prepend this. Now the agent starts with everything we've learned, not from zero.

---

## How agents use this (without harness engineering)

### With Claude Code (skills)

You install aeolus CLI on the machine. You add skills to `.claude/skills/` that teach Claude Code to use it. Claude Code already handles tool calling, code execution, context management. The skills just say "when the user wants to log an experiment, call `aeolus experiment log`."

### With Codex (task description)

You create a Codex task that says:

```
Context: Run `aeolus knowledge findings for-agent --use-case weather-intervention`
to see what we've learned so far.

Task: Run `aeolus direction suggest --use-case weather-intervention` and
execute suggestion #1 (spectral bin microphysics test).

Use `aeolus data fetch` to get initial conditions.
Log results with `aeolus experiment log --source codex/this-task`.
```

Codex has shell access. It runs the CLI commands. It logs the experiment. Done. No custom harness.

### With Cursor (terminal)

Same as Codex — Cursor has terminal access, can run CLI commands. The experience is identical.

### With a future agent harness (whatever ships next)

As long as it can run shell commands, it can use aeolus CLI. The interface is stable. The agent runtime is someone else's problem.

---

## What we are NOT building (restated for clarity)

1. **Not an agent runtime / harness / SDK.** Claude Code, Codex, Cursor handle this.
2. **Not an LLM caller.** The CLI has no AI in it. It's a data management tool.
3. **Not a workflow orchestrator.** No stage machines, no DAGs, no pipelines in the CLI. The agent harness handles orchestration. The CLI handles state.
4. **Not a database server.** It reads/writes files in git. It may index into SQLite for fast queries. But the source of truth is always YAML files in git.
5. **Not a visualization platform.** It outputs structured text. If you want charts, use the agent (Claude Code can plot) or a separate dashboard later.

---

## Where to start

### Week 1: The minimum viable ledger

Build these commands and nothing else:

```bash
aeolus experiment log --quick    # params + result, minimal required fields
aeolus experiment list           # show all experiments
aeolus experiment show <id>      # show one experiment
```

Storage: YAML files in a `experiments/` directory, committed to git. Auto-incrementing ID (`EXP-0001`). No STAC yet — just file paths for data sources and outputs.

This is usable on day one. A human types `aeolus experiment log --quick` after a sim run. Done.

### Week 2: Query and compare

```bash
aeolus experiment search --param <key>=<value>
aeolus experiment compare <id> <id>
aeolus experiment gaps
```

The index is built by scanning `experiments/*.yaml`. In-memory for now. This is when the CLI starts earning its keep — you can ask "what have we tried?" and get a real answer.

### Week 3: Open experiments and directions

```bash
aeolus experiment open ...
aeolus direction create ...
aeolus direction suggest ...
```

This is when agents become useful. You can create open experiments, hand them to Codex/Claude Code, and get results back in the same ledger.

### Week 4: Skills and MCP

Write Claude Code skills. Stand up MCP server. Now any Claude instance can use the CLI conversationally.

### Week 5+: STAC integration, knowledge layer, data catalog

Add STAC for proper data cataloging. Add `aeolus knowledge` for findings. Add `aeolus data` for catalog queries. Each of these is additive — the core (experiments + directions) already works.

---

## Tech stack

```
Python 3.12+
Click            — CLI framework (explicit subcommand groups)
Rich             — terminal formatting (tables, panels, syntax highlighting)
PyYAML           — experiment schema (read/write)
Pydantic         — schema validation
GitPython        — git operations (branch listing, commit)
pystac           — STAC catalog (week 5+)
stac-fastapi     — STAC server if needed (week 5+)
```

Single package: `pip install aeolus-cli`. Entry point: `aeolus`. No Docker, no server process, no cloud dependency. It's a CLI that reads and writes files.

---

*See also:*
*`aeolus-cli/README.md` — full PRD with scenarios and dependency graph*
*`aeolus-architecture.md` — system architecture and use cases*
*`takeaways-design-philosophy.md` — invest in nouns, keep verbs thin*
