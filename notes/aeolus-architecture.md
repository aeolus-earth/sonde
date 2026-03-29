# Aeolus — System Architecture & Use Case Guide

For the Aeolus team. Defines what we're building, when each mode of work applies, and the architectural layers underneath.

**Related docs:**
- [`aeolus-cli/README.md`](aeolus-cli/README.md) — CLI product requirements, command surface, skills, MCP server
- [`aeolus-cli/scope.md`](aeolus-cli/scope.md) — CLI scope, starting point, build order, what we're NOT building
- [`takeaways-design-philosophy.md`](takeaways-design-philosophy.md) — invest in nouns, keep verbs thin
- [`takeaways-cli-vs-mcp.md`](takeaways-cli-vs-mcp.md) — when to use CLI vs MCP per tool

---

## Part 0 — What we build vs. what we use

```
AGENT HARNESSES (not ours — Claude Code, Codex, Cursor, future tools)
  They handle: LLM calls, tool use, code execution, context, sandboxing

AEOLUS CLI (ours — the research platform)
  We handle: experiment tracking, data catalog, knowledge, research directions

AEOLUS SKILLS + MCP (ours — the bridge)
  Makes any agent instance fluent in aeolus CLI

STAC CATALOG (ours — standard protocol)
  What data exists, spatial/temporal coverage, simulation output registration
```

**We do not build an agent harness.** Claude Code, Codex, and Cursor are investing billions in the harness problem — launching agents, managing context, tool calling, code execution, sandboxing. We don't compete there.

**We build the thing they can't build:** a domain-specific scientific discovery management layer. Any agent with shell access can call `aeolus experiment log`, `aeolus direction suggest`, `aeolus data fetch`. The CLI doesn't know what agent is calling it. A human typing in a terminal is identical to Codex running a task.

**A human scientist and any agent produce indistinguishable experiment records.** This is the design invariant. See [`aeolus-cli/scope.md`](aeolus-cli/scope.md) for the full scoping and build order.

---

## Part 1 — Two modes of work, not one system

Aeolus is not one monolithic agent. It's a platform that supports two distinct modes of working with AI. The entire team needs to be able to answer: **"Should I use the IDE or spin up a sonde?"**

### Mode A: IDE Agent (Claude Code / Codex with skills)

**What it is.** A human sits in their IDE (VS Code, terminal, etc.) with Claude Code or Codex. The agent has skills, tools, file access, and can run code. The human steers interactively.

**When to use it.**
- Exploratory work: "What does this Breeze.jl module do?"
- Writing or modifying code with tight feedback: "Add a new microphysics scheme"
- Debugging: "Why is this simulation diverging?"
- Quick analysis: "Plot the last experiment's output"
- Anything where you want to *see what the agent is doing in real time* and *redirect frequently*

**What triggers this mode.** A human has a question or task. They open their editor. They interact. Session lasts minutes to maybe an hour.

**This is the default mode.** If you're not sure, start here. Upgrade to a sonde when you hit one of the triggers below.

---

### Mode B: Sonde Agent (remote, long-running, SSH-observable)

**What it is.** A headless agent process running on a remote machine (VM, cloud instance, HPC node). It has a defined mission, access to specific data and tools, and runs autonomously for hours or days. Team members SSH in to observe progress, read logs, inspect artifacts. Built on the Claude Agent SDK.

**When to use it — the trigger conditions:**

| Trigger | Example | Why not IDE? |
|---------|---------|--------------|
| **Duration** | Run 50 NWP simulation variants, analyze each, iterate on the hypothesis | Takes 8+ hours. No one keeps an IDE session open that long. |
| **Concurrency** | 4 researchers each working a different weather intervention angle simultaneously | You can't manage 4 agent sessions in one IDE. Each sonde runs independently. |
| **Compute co-location** | Agent needs to launch Julia/GPU jobs on an HPC cluster | The agent should live where the compute is, not on your laptop. |
| **Async team visibility** | "What did the cloud-seeding sonde find overnight?" | Multiple team members check in at different times via SSH. Not one person's IDE. |
| **Structured pipeline** | Run the full research loop: literature → hypothesis → experiment design → simulate → analyze → report | The workflow is well-defined enough that human steering is rubber-stamping, not thinking. |
| **Product-facing** | Customer wants a weather risk assessment; agent runs the pipeline, produces a report | No human in the loop at all — this is a service, not a tool. |

**What triggers this mode.** The task is too long, too parallel, too compute-heavy, or too autonomous for interactive IDE work.

### The rule of thumb

> **IDE agent** = human thinks, agent helps.
> **Sonde agent** = human defines the mission, agent executes, human checks in.

If you find yourself re-prompting the IDE agent with "keep going" every 5 minutes for an hour, that's a sonde. If you're making judgment calls every few turns, that's IDE work.

---

## Part 2 — Use cases (what Aeolus actually does)

These are distinct products with different data, different workflows, and different success metrics. Do not conflate them.

### Use Case 1: Weather Intervention Research

**What.** Run NWP simulations (Breeze.jl and related tools) to test weather intervention hypotheses — cloud seeding efficacy, boundary layer modification, precipitation targeting, etc.

**Who uses it.** Atmospheric scientists on the Aeolus team.

**Primary mode.** Sonde agents for simulation campaigns. IDE agents for analysis and code development.

**Data sources:**
- Breeze.jl / Oceananigans.jl simulation framework (Julia, CPU/GPU)
- ERA5 / GFS / HRRR reanalysis and forecast data (initial/boundary conditions)
- Observation networks (radiosondes, radar, satellite — for validation)
- Literature corpus (arXiv, AMS journals — for hypothesis generation)
- Experiment history (prior simulation configs, results, git history)

**Workflow shape (sonde):**
```
Mission brief (hypothesis + constraints)
  → Literature scan (what's been tried, what parameters matter)
  → Experiment design (simulation configs, parameter ranges)
  → Run simulations (Breeze.jl, potentially many variants in parallel)
  → Analyze results (metrics: precipitation delta, energy budget, stability)
  → Iterate or report
```

**Success metric.** Quantitative: simulation accuracy vs. observations, statistical significance of intervention effect. This means metric-gated validation works here.

**Key constraint.** Simulations are expensive (minutes to hours each). The agent must be smart about what to run, not brute-force the parameter space.

---

### Use Case 2: Energy Trading (Weather-Informed)

**What.** Use weather forecasts and NWP model output to generate energy market signals — power demand forecasting, renewable generation prediction, weather-driven price dislocation detection.

**Who uses it.** Trading/quantitative team at Aeolus.

**Primary mode.** Sonde agents running a daily structured pipeline (like ATLAS). IDE agents for strategy development and debugging.

**Data sources:**
- NWP model output (temperature, wind, solar irradiance, precipitation forecasts)
- Energy market data (power prices, gas/oil futures, renewable capacity, grid load)
- Fundamental data (plant outages, transmission constraints, regulatory filings)
- Historical performance (agent recommendation accuracy, P&L attribution)

**Workflow shape (sonde):**
```
Daily cycle:
  Weather data refresh (NWP model runs)
  → Weather-to-energy translation (demand model, renewable gen model)
  → Market signal agents (price dislocations, volatility, spread analysis)
  → Risk review (adversarial: what could go wrong?)
  → Portfolio synthesis (position sizing, hedge recommendations)
  → Report / execution signals
```

**Success metric.** Sharpe ratio, hit rate, P&L. Hard numbers. Darwinian weights and autoresearch loops apply directly.

**Key constraint.** Time-sensitive. The daily pipeline must complete before market open. Latency matters more than in research.

---

### How the use cases share infrastructure (and where they don't)

| Layer | Shared | Diverges |
|-------|--------|----------|
| **Claude Agent SDK** | Same SDK, same agent harness | — |
| **LLM provider** | Same Anthropic API | Research may use longer context; trading needs faster response |
| **Tool surface** | File I/O, web search, git | Research: Breeze.jl, HPC job submission. Trading: market data APIs, price feeds |
| **Execution sandbox** | Subprocess model | Research: Julia/GPU. Trading: Python, lighter compute |
| **Memory** | Git-based experiment history | Research: simulation configs + results. Trading: agent weights + recommendations + forward returns |
| **Orchestration** | Stage-based pipeline | Research: exploration-heavy, variable length. Trading: fixed daily cycle, time-boxed |
| **Validation** | Metric-gated | Research: simulation accuracy. Trading: Sharpe/P&L |
| **Self-improvement** | Autoresearch pattern | Research: hypothesis refinement. Trading: prompt evolution on Sharpe |

**The shared core is the agent runtime + tool protocol + memory model. The domain-specific parts are the data connectors, the orchestration topology, and the success metrics.**

---

## Part 3 — The sonde agent: what you see when you SSH in

This matters for adoption. If team members can't understand what a sonde is doing, they won't trust it.

### What a running sonde looks like

```
$ ssh research-box
$ sonde status
SONDE-047  weather-intervention/cloud-seeding-hygroscopic
  Started:    2026-03-27 22:15 UTC
  Stage:      4/6 — Running simulations (variant 12 of 20)
  Runtime:    9h 42m
  Last artifact: results/variant-011/precipitation_delta.nc
  Git branch: sonde/047-hygroscopic-seeding
  Status:     RUNNING

SONDE-048  weather-intervention/boundary-layer-heating
  Started:    2026-03-28 01:30 UTC
  Stage:      2/6 — Experiment design
  Runtime:    4h 12m
  Last artifact: configs/heating-profiles-v2.yaml
  Git branch: sonde/048-bl-heating
  Status:     RUNNING
```

### What you can do

```
$ sonde logs 047              # tail the agent's reasoning + tool calls
$ sonde artifacts 047         # list all files the agent has produced
$ sonde inspect 047           # read the agent's current plan + state
$ sonde pause 047             # pause before next stage (human review gate)
$ sonde message 047 "skip variants 15-20, focus on the high-CCN cases"
```

### What a completed sonde produces

A git branch with:
- `mission.md` — the original brief
- `plan.md` — the agent's execution plan (updated as it ran)
- `logs/` — full agent reasoning trace
- `configs/` — simulation configurations it designed
- `results/` — output data, analysis, plots
- `report.md` — summary of findings and recommendations

The team reviews the branch. Merges what's useful. The artifacts become inputs to the next sonde or to IDE-mode analysis.

---

## Part 4 — Interfaces: how people (and agents) interact with the system

Three audiences, three interfaces, one source of truth.

### Researchers / quants — Claude Code + CLI

These users live in terminals. They don't want a new app. They want Claude Code with domain skills, and a `sonde` CLI they can run directly.

The CLI is the primary interface for operating sondes:

```
$ sonde launch --mission missions/hygroscopic-seeding.yaml
$ sonde status
$ sonde logs 047
$ sonde pause 047
$ sonde message 047 "focus on high-CCN cases"
$ sonde experiments --use-case weather-intervention --parameter ccn_range
$ sonde data --source era5 --region north_atlantic --date 2025-03
```

Claude Code calls the same CLI (or the MCP wrappers around it). The researcher can always do manually what the agent does programmatically. No black boxes.

### Team leads / trading desk — Web dashboard (read-only)

Status page, not an application. Shows active sondes, trading pipeline status, experiment history, key metrics. Reads from the same state the CLI reads from. No ability to launch or modify — that's deliberate.

Build this *after* the CLI works. It's a display layer, not infrastructure.

### Future external customers — Product UI

Not yet. Don't build this until you're selling something.

---

## Part 5 — The CLI vs. MCP decision

This matters enough to state explicitly. CLIs are making a resurgence in agent systems, and for good reason. But MCP exists for good reason too. Here's when to use each.

### Why CLI

Every effective agent system we studied reduces to "agent calls subprocess." Karpathy's autoresearch is `uv run train.py`. ScienceClaw runs skills as subprocesses. AutoResearchClaw is a CLI. Claude Code itself is a CLI.

CLIs have properties that matter for agent systems:

- **Human-debuggable.** When a sonde does something wrong, SSH in and run the same command. See exactly what the agent saw.
- **Composable.** Pipe output, wrap in scripts, chain with `&&`. The universal integration interface.
- **Zero infrastructure.** No server process, no connection management. Call it, get stdout.
- **Already exists.** ERA5 has `cdsapi`. Julia has `julia -e`. Git is a CLI. You don't build adapters.

### Why MCP

MCP solves problems CLIs can't:

- **Typed schema.** Agent knows parameters and types *before* calling. No guessing at flags from `--help` text.
- **Tool discovery.** Agent asks "what can you do?" and gets a structured list. CLIs require the agent to already know what commands exist.
- **Structured response.** JSON in, JSON out. No parsing terminal output with regex.
- **Stateful sessions.** Expensive setup once (DB connection, data loading, auth), reuse across many calls. Each CLI invocation pays startup cost.
- **Streaming.** Partial results as they arrive for long-running queries.

### The principle

```
Human ──→ CLI ──→ implementation
                      ↑
Agent ──→ MCP ────────┘
```

**Build CLIs first. Wrap as MCP when the agent needs structure.**

1. Build `sonde status` as a CLI. A researcher types it, sees output, verifies it works. Takes an hour.
2. The agent can call the CLI via subprocess. This works for simple commands with text output.
3. When the agent needs to call `sonde launch` with 8 typed parameters and get structured JSON back, wrap it as MCP. The CLI is still the implementation — MCP is the agent-facing schema.

### What gets which treatment

| Capability | CLI only | CLI + MCP wrapper | MCP only |
|-----------|----------|-------------------|----------|
| `sonde status` | Quick check by human | Agent needs structured JSON of all sondes | — |
| `sonde launch` | Human launches with flags | Agent needs typed params + validation | — |
| `sonde logs` | Human tails output | Agent summarizes recent activity | — |
| Experiment query | `sonde experiments --param X` | Agent queries with structured filters, gets typed results | — |
| Data catalog | `sonde data --source era5 ...` | Agent discovers available data, queries coverage | — |
| Julia runner | `julia -e '...'` | — | Agent needs structured result parsing + error handling |
| Literature search | — | — | Agent-only; no human CLI needed; structured query/response |
| Market data feed | — | — | Agent-only; streaming, stateful connection |

**Rule of thumb:** If a human might type it → build a CLI. If an agent needs typed I/O → add MCP. If only agents use it → MCP only. Most things in the first two categories get both.

### What this means for build order

1. **`sonde` CLI** (Click or Typer + Rich) — launch, status, logs, inspect, pause, message, experiments, data. Human-usable from day one.
2. **MCP wrappers** for the same commands — thin layer that calls CLI implementation, adds JSON schema, returns structured responses. Claude Code discovers these as tools.
3. **MCP-only servers** for agent-internal tools — literature search, market data, Julia result parser. No CLI needed because humans don't call these directly.
4. **Web dashboard** reads from the same state files that CLI reads from. Different view, same data.

---

## Part 6 — Architectural layers (reference)

These are the building blocks underneath both modes and both use cases. Each layer is an independent design decision. Options are drawn from the 11 repos studied in Sonde.

Layers are ordered bottom-up: lower layers constrain higher ones.

---

### Layer 0 — LLM Provider

**What it decides:** Which foundation models the system calls and how.

| Approach | Trade-off |
|----------|-----------|
| **Direct SDK** (anthropic) | Full control, no abstraction tax; we own retry/fallback logic. |
| **LangChain chat wrappers** | Provider-agnostic swap; adds dependency, can lag behind SDK features. |
| **LiteLLM / OpenRouter** | Unified interface to 100+ models; one more hop. |
| **Dual runtime** (planning LLM ≠ coding LLM) | Best model for each job; increases integration surface. |

**Our direction:** Direct Anthropic SDK. We're building on Claude Agent SDK already. Adding an abstraction layer buys optionality we don't need yet and costs us access to features (extended thinking, prompt caching) that matter for long-running sondes.

---

### Layer 1 — Tool / Capability Surface

**What it decides:** How agents interact with the outside world.

| Approach | When to use |
|----------|-------------|
| **CLI** (Click/Typer) | Human-facing operations. Debuggable, composable. Build first. |
| **MCP wrapper over CLI** | Same operations, agent-facing. Typed schema, structured JSON response. |
| **MCP-only server** | Agent-internal tools no human calls directly (literature search, streaming data). |
| **SDK-native tool_use** | Tight inner-loop tools where MCP overhead matters. |
| **Skills** (SKILL.md / Claude Code format) | Reusable multi-step procedures (not single tool calls). |

**Our direction:** CLI-first for everything humans touch. MCP wrappers for agent access to the same capabilities. MCP-only for agent-internal tools. Skills for reusable research procedures.

---

### Layer 2 — Execution Sandbox

**What it decides:** Where generated code runs.

| Approach | Trade-off |
|----------|-----------|
| **Subprocess with timeout** | OS-level isolation, simple, no containment. |
| **Docker / container** | Strong isolation; startup overhead; needs image management. |
| **Remote sandbox** (Modal, etc.) | Scalable, ephemeral; latency, cost. |

**Our direction:** Subprocess for our own code (NWP simulations, analysis scripts). We trust our own stack. Docker only if we ever run user-submitted or untrusted experiment code.

---

### Layer 3 — Memory & State

**What it decides:** How agents persist context and share information.

**Within a run:**

| Approach | Trade-off |
|----------|-----------|
| **Pydantic models** | Validated at each handoff; explicit contracts. |
| **Structured JSON on disk** | Simple audit trail; no schema enforcement. |
| **LangGraph StateGraph** | Typed, diffable; coupled to LangGraph. |

**Across runs:**

| Approach | Trade-off |
|----------|-----------|
| **Files + git** | Versioned, diffable, human-readable; no semantic retrieval. |
| **AGENTS.md / SKILL.md injection** | Zero infrastructure; scales poorly with volume. |
| **Darwinian weight files** | Algorithmic memory of agent quality; not semantic. |
| **Zep GraphRAG** | Rich relational memory; cloud dependency. |

**Our direction:** Files + git for cross-run memory. Every sonde gets a git branch; its experiment history is its memory. Within a run, Pydantic models for typed state handoffs between stages. Darwinian weights for the trading use case (we have hard metrics). No vector DB until we have a proven need for semantic retrieval over large corpora.

---

### Layer 4 — Agent Harness (Single-Agent Runtime)

**What it decides:** How one agent is configured, prompted, given tools, and run.

| Approach | Trade-off |
|----------|-----------|
| **Claude Agent SDK** | Native to our stack; direct subprocess spawning; skill support. |
| **Middleware stack** (deepagents pattern) | Maximum composability; complex to debug. |
| **Markdown contract** (autoresearch pattern) | No framework code; relies on instruction-following. |
| **YAML config + prompt assembly** | Declarative; needs a custom loader. |

**Our direction:** Claude Agent SDK as the runtime. Skills for reusable procedures (literature search, simulation setup, analysis patterns). AGENTS.md-style markdown for persistent agent instructions per use case. This gives us: tool binding, subprocess execution, context management, and the ability to SSH in and observe — all without building a custom harness.

---

### Layer 5 — Multi-Agent Orchestration

**What it decides:** How multiple agents or stages coordinate.

| Pattern | When to use |
|---------|-------------|
| **Explicit stage machine** | Long pipeline with checkpointing and gates. Research use case. |
| **Layered cascade** (parallel within layer, sequential across) | Hierarchical signal filtering. Trading use case. |
| **Tree search** | Exploration-heavy: many candidate solutions. Simulation parameter search. |
| **Router/supervisor** | Known shape, dynamic path. |
| **File + IDE loop** | Single-agent interactive work. IDE mode. |

**Our direction:** Research = explicit stage machine (6-8 stages, checkpoint/resume, metric gates). Trading = layered cascade (weather → translation → signals → risk → portfolio). Both share the same agent runtime underneath; orchestration topology is the differentiator.

---

### Layer 6 — Validation & Quality

**What it decides:** How outputs are checked.

| Approach | When to use |
|----------|-------------|
| **Metric gates** (simulation accuracy, Sharpe, P&L) | When you have a number. Both use cases. |
| **LLM review loop** (maker/reviewer) | When quality is subjective (report prose, hypothesis framing). |
| **Adversarial review** (CRO-style) | When the cost of a bad decision is high. Trading. |
| **Stage gates with rollback** | When bad work in stage N invalidates stages N+1…M. Research. |

**Our direction:** Always prefer metric gates when a metric exists. LLM review only for prose outputs. Adversarial review for trading recommendations before they reach portfolio decisions.

---

### Layer 7 — Self-Improvement

**What it decides:** How the system gets better over time.

| Approach | When to use |
|----------|-------------|
| **Autoresearch loop** (edit → run → compare → keep/revert) | When you have a loss function and can wait for results. |
| **Darwinian weights** (daily nudge toward top performers) | When you have multiple competing agents with scored outputs. |
| **None (human reviews)** | When your scoring function isn't trustworthy yet. |

**Our direction:** Start without automated self-improvement. Build L0–L6. Accumulate enough runs to understand what "good" looks like. Then introduce Darwinian weights for trading (we'll have Sharpe data). Autoresearch for research prompts only after we've manually iterated enough to trust the metric.

---

## Part 7 — Data architecture per use case

This is where scoping matters most. Each use case has a distinct data surface. The agent must know what's available and what it means.

### Weather Intervention Research — Data Map

```
┌─────────────────────────────────────────────────────────┐
│  INPUTS (what the agent can read)                       │
│                                                         │
│  Simulation framework                                   │
│  ├── Breeze.jl source + module map                      │
│  ├── Oceananigans.jl (underlying dynamics)              │
│  └── Julia package registry                             │
│                                                         │
│  Atmospheric data                                       │
│  ├── ERA5 reanalysis (initial conditions, validation)   │
│  ├── GFS / HRRR forecasts (boundary conditions)         │
│  ├── Radiosonde observations (validation)               │
│  └── Satellite products (cloud properties, precip)      │
│                                                         │
│  Literature                                             │
│  ├── arXiv (atmospheric science, intervention methods)  │
│  ├── AMS / AGU journal APIs                             │
│  └── Semantic Scholar (citation graph)                  │
│                                                         │
│  Experiment history                                     │
│  ├── Git branches (prior sonde runs)                    │
│  ├── configs/ (what was tried)                          │
│  └── results/ (what happened)                           │
├─────────────────────────────────────────────────────────┤
│  OUTPUTS (what the agent produces)                      │
│                                                         │
│  ├── Simulation configs (.yaml, .toml, Julia scripts)   │
│  ├── Raw simulation output (.nc, .jld2)                 │
│  ├── Analysis artifacts (plots, statistics, .csv)       │
│  ├── report.md (findings, recommendations)              │
│  └── Git branch with full provenance                    │
└─────────────────────────────────────────────────────────┘
```

### Energy Trading — Data Map

```
┌─────────────────────────────────────────────────────────┐
│  INPUTS (what the agent can read)                       │
│                                                         │
│  Weather                                                │
│  ├── NWP model output (GFS, ECMWF, HRRR)               │
│  ├── Ensemble spreads (forecast uncertainty)            │
│  └── Historical forecast verification scores            │
│                                                         │
│  Energy markets                                         │
│  ├── Power prices (day-ahead, real-time, futures)       │
│  ├── Gas / oil / carbon prices                          │
│  ├── Renewable generation (wind, solar capacity + gen)  │
│  └── Grid load + demand forecasts                       │
│                                                         │
│  Fundamentals                                           │
│  ├── Plant outage schedules                             │
│  ├── Transmission constraints                           │
│  └── Regulatory calendar                                │
│                                                         │
│  Agent history                                          │
│  ├── Recommendation log (ticker, direction, conviction) │
│  ├── Forward returns (scored at 1d, 5d, 20d)           │
│  ├── Agent weights (Darwinian, rolling)                 │
│  └── Prompt evolution history (git)                     │
├─────────────────────────────────────────────────────────┤
│  OUTPUTS (what the agent produces)                      │
│                                                         │
│  ├── Weather-to-energy translation (demand, gen fcsts)  │
│  ├── Market signals (JSON: direction, conviction, why)  │
│  ├── Risk review (adversarial assessment)               │
│  ├── Portfolio recommendations (sized positions)        │
│  └── Daily report + audit trail                         │
└─────────────────────────────────────────────────────────┘
```

### Should the agent be flexible or locked to its data?

**Locked per use case, discoverable within it.** Each sonde gets a manifest of available data sources (MCP servers, file paths, API endpoints) specific to its use case. The agent can explore within that surface — it knows what tools it has. It cannot reach outside its manifest. This prevents:
- A research sonde accidentally querying market data APIs
- A trading sonde wandering into literature review
- Scope creep where an agent "helpfully" does work outside its mission

The manifest is part of the sonde's mission definition:

```yaml
# sonde-mission.yaml
id: SONDE-047
use_case: weather-intervention
mission: |
  Test hygroscopic seeding efficacy in maritime cumulus
  using Breeze.jl bulk microphysics with CCN range 100-2000 cm⁻³.

data_sources:
  - breeze_jl        # simulation framework
  - era5             # initial conditions
  - arxiv            # literature
  - experiment_history  # prior runs

tools:
  - file_io
  - julia_runner
  - literature_search
  - plot_generator

constraints:
  max_simulations: 30
  max_runtime_hours: 24
  require_human_review_before: [report]
```

---

## Part 8 — What we are NOT building

Stating this explicitly to fight entropy.

1. **Not a general-purpose agent framework.** We are not competing with LangGraph, deepagents, or Google ADK. We are building a domain-specific research and trading platform that *uses* the Claude Agent SDK.

2. **Not a chatbot.** Sondes don't have conversations. They have missions. The "chat" interface is for the team to observe and occasionally redirect, not for open-ended dialogue.

3. **Not a single monolithic pipeline.** The research and trading use cases share infrastructure but have different orchestration topologies, different data, and different success metrics. Trying to make one pipeline serve both will produce something that serves neither.

4. **Not autonomous from day one.** Start with human-in-the-loop gates at every stage transition. Remove gates only when we have enough data to trust the agent's judgment at that specific gate. Autonomy is earned per-stage, not granted globally.

---

## Part 9 — Decision log (update as we go)

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-28 | Two modes (IDE + sonde), not one | IDE for interactive work, sonde for autonomous long-running work. Prevents overengineering the IDE path and underengineering the autonomous path. |
| 2026-03-28 | Two use cases scoped separately | Weather intervention and energy trading have different data, workflows, and metrics. Shared infra, separate orchestration. |
| 2026-03-28 | Claude Agent SDK as runtime | We're already on it. No abstraction layer until we need multi-provider. |
| 2026-03-28 | Files + git as primary memory | Reproducibility is non-negotiable for science. Git gives us versioning, diffing, and provenance for free. |
| 2026-03-28 | Locked data manifests per sonde | Prevents scope creep. Agent knows exactly what data it can access. |
| 2026-03-28 | CLI-first, MCP wraps CLI | Humans debug with the same commands agents call. CLI is the implementation; MCP is the agent-facing schema. |
| 2026-03-28 | Three interfaces: terminal, dashboard, (future) product UI | Researchers in terminal (Claude Code + CLI). Leads on web dashboard (read-only). External customers later, not now. |
| | | |

---

## Layer Map (quick reference)

```
┌─────────────────────────────────────────────────────────────┐
│  L7  Self-Improvement     (deferred — build L0-L6 first)    │
├─────────────────────────────────────────────────────────────┤
│  L6  Validation           Metric gates + LLM review (prose) │
│                           + adversarial review (trading)     │
├─────────────────────────────────────────────────────────────┤
│  L5  Orchestration        Research: stage machine            │
│                           Trading: layered cascade           │
├─────────────────────────────────────────────────────────────┤
│  L4  Agent Harness        Claude Agent SDK + skills          │
├─────────────────────────────────────────────────────────────┤
│  L3  Memory & State       Within-run: Pydantic models        │
│                           Cross-run: files + git branches    │
├─────────────────────────────────────────────────────────────┤
│  L2  Execution Sandbox    Subprocess (own code)              │
│                           Docker (untrusted, future)         │
├─────────────────────────────────────────────────────────────┤
│  L1  Tool Surface         MCP (stable), SDK tool_use (fast), │
│                           Claude Code skills (reusable)      │
├─────────────────────────────────────────────────────────────┤
│  L0  LLM Provider         Direct Anthropic SDK               │
└─────────────────────────────────────────────────────────────┘
```

---

*Aeolus team internal document. Updated 2026-03-28.*
*Architectural options derived from Sonde workspace analysis (11 repos).*
