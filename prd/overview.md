# Sonde — Product Requirements Document

**Author:** Mason  
**Status:** Draft v0.1  
**Last Updated:** 2026-03-26  
**Classification:** Internal

---

## 1. What Sonde Is

Sonde is an AI meteorologist for Aeolus Labs. It is a multi-agent system that automates the scientific research cycle — from submitting simulations on our GPU infrastructure, to retrieving and analyzing output, to producing publication-quality figures and written analysis. It transforms natural language research questions into executed science.

Sonde exists because the bottleneck at Aeolus is not compute — it's the human time spent on the mechanical parts of the research loop. Every scientist on the team repeats the same cycle daily: configure a Breeze/AeFS run, submit it, wait, pull terabytes of output from cloud storage, wrangle it into analysis tools, produce figures, interpret results, write things up. Sonde handles the mechanical parts so the science team can focus on the physics.

---

## 2. Current Technical Direction

We are currently evaluating **LangChain / LangGraph** as the orchestration layer. This is a noted direction, not a committed architecture decision. The final choice of agent framework will be informed by prototyping against our actual infrastructure (Julia-based NWP stack, GPU clusters, Zarr/Icechunk data stores) during the scoping phase.

### 2.1 Knowledge Base Backend: Database, Not Git

The research knowledge base (experiments, findings, directions, questions, artifacts, activity) uses a database backend — not a git-based file store. This is an evaluated architecture decision, not a default. We considered git thoroughly (see `git-replace.md` for the full feature mapping) and chose a database for two reasons: workflow structure and write concurrency.

**Structured research is the product.** The core value of the knowledge base is that it imposes structure on the research process — across sessions, across repos, across agents. `sonde log` enforces hypothesis, parameters, tags, program scope. `sonde list --status open` gives any new agent session immediate context about what's in flight. `sonde history` shows semantic actions (status changed, finding extracted), not just file diffs. Local markdown files can store the same information, but they don't enforce a schema, can't be queried across repos, and require every agent to discover, read, and parse them before it has context. The database makes the research state instantly queryable from anywhere — a new agent in any repo runs one command and knows what the team has tried, what's running, and what's been learned. This is valuable even for a single researcher working with one agent.

**Git doesn't scale to concurrent writes.** Git's write model is serialized — a single `.git/index.lock` gates all commits. At low concurrency this is fine. At the Phase 3 scale (many parallel agent teams running autonomous research), it breaks:

| Concurrent agents | Git | Database (PostgreSQL) |
|---|---|---|
| 10 | Fine | Fine |
| 100 | Painful (push retry loops) | Fine |
| 1000 | Broken | Fine |

Each agent must pull before pushing; if another agent pushed in between, it retries. PostgreSQL handles concurrent inserts natively — row-level locking, MVCC, connection pooling. Each `sonde log` is one non-blocking write. No coordination with other agents. This matters because the Phase 3 vision is not hypothetical overhead — the entire thesis of Sonde is that research throughput scales with agents, not headcount. The backend must not be the bottleneck.

**What git IS used for:** Git tracks code provenance. Every experiment records `git_commit`, `git_branch`, and `git_dirty` so results trace back to the exact code that produced them. Git is an input to the knowledge base, not the backend.

**What this means for architecture:**
- **Database** holds structured metadata: experiment records, findings, questions, directions, activity log, record links. This is the system of record and the query layer.
- **Artifacts** (figures, datasets, model outputs) should live in object storage (S3) or the repo filesystem — not in database blob storage. The database stores metadata and paths; files stay where agents can read them directly.
- **Local sync** (`sonde pull`) writes database records as markdown files with YAML front-matter to `.sonde/` in the repo. This gives agents fast local reads and offline access. The database remains authoritative for writes.

---

## 3. Who Uses It

**Aeolus science team** — Eliot, Greg, Jatan, Toby, Nick, Danny, and the broader engineering org. These are the primary daily users. They interact with Sonde to accelerate their existing research workflows: running simulations, pulling and plotting data, writing up results.

**Mason and Koki** — strategic and cross-cutting analysis. Research direction, investor-facing materials, technical documentation that draws on simulation results.

**External researchers and partners (future)** — scoped, read-only access to Aeolus's forecasting capabilities and published analysis. Cannot submit jobs or access internal research data.

---

## 4. How Users Interact

Sonde is accessible through two primary interfaces, with a programmatic API for automation.

### CLI

The command-line interface is the primary tool for the science team. It supports natural language queries, structured commands, and persistent interactive sessions.

```
$ sonde "plot the 10m wind speed from yesterday's ERCOT run"

$ sonde chat
> what was the peak wind speed in last night's Cat 4 OSSE?
> compare that against the control run without seeding
> write up the difference as a 2-paragraph summary
```

Scientists live in terminals. The CLI meets them where they already work and supports both quick one-shot queries and extended research conversations with full context.

### Embedded Web Frontend

A chat-based interface embedded in the Aeolus platform. Two modes:

- **Internal mode.** Full access — simulation submission, all data, all analysis tools. Behind Aeolus SSO.
- **External mode.** Scoped access for partners and customers. Published forecast data and pre-approved analysis tools only. No cluster access, no internal research data.

The frontend renders inline figures, interactive maps, code blocks, and structured reports. Users can export any analysis to a Jupyter notebook for manual follow-up.

### API

Programmatic access for integration into automated pipelines — post-forecast-cycle analysis triggers, model regression testing in CI/CD, batch research workflows.

---

## 5. Capabilities

### 5.1 Simulation Management

Sonde can submit, monitor, and catalog Breeze/AeFS simulation runs on our persistent GPU clusters.

- **Submit jobs.** A user describes a simulation in natural language (e.g., "run a 48-hour ERCOT forecast initialized from GFS at 2026-03-25 00Z at 3km resolution"). Sonde generates the appropriate Breeze configuration and submits it to the cluster.
- **Monitor status.** Query running, queued, and completed jobs. Surface errors with suggested fixes.
- **Browse the simulation catalog.** Search past runs by date, domain, resolution, experiment tag, or free-text description of what the run was for.
- **Cost awareness.** Estimate compute cost before submission. Flag expensive runs for human approval.

### 5.2 Data Retrieval

Sonde knows where all of Aeolus's data lives and can retrieve exactly what a user needs without requiring them to navigate storage hierarchies or write data-loading boilerplate.

- **Smart subsetting.** A user asks for "500mb geopotential height over the Gulf of Mexico from yesterday's hurricane run." Sonde resolves the simulation, identifies the correct Zarr store, and loads only the requested variable, level, time range, and spatial extent — not the entire multi-terabyte dataset.
- **Zarr and Icechunk native.** All data access goes through Zarr for chunked reads and Icechunk for versioned, transactional access. This is non-negotiable for performance at our data volumes.
- **Cross-simulation comparison.** Load corresponding fields from multiple runs for differencing, ensemble spread, or parameter sensitivity analysis.
- **External reference data.** Pull GFS, ERA5, HRRR, HAFS analysis fields for verification and context.

### 5.3 Analysis

Sonde can compute standard and custom atmospheric diagnostics over retrieved data.

- **Standard meteorological diagnostics.** CAPE, wind shear profiles, vorticity, moisture flux convergence, precipitation accumulation, boundary layer height, etc.
- **Forecast verification.** Compare Breeze output against observations or analysis fields. Compute RMSE, bias, anomaly correlation, skill scores, reliability diagrams.
- **Custom analysis.** Execute user-described analysis — the agent writes and runs analysis code based on a natural language description of what's needed.
- **Statistical analysis.** Ensemble statistics, significance testing, trend detection across simulation campaigns.

### 5.4 Visualization

Sonde produces figures that are ready for papers, presentations, and investor materials.

- **Publication-quality static figures.** Matplotlib/Cartopy plots with Aeolus styling — plan views, cross-sections, soundings, time series, skew-T diagrams, hovmöller diagrams.
- **Interactive exploration.** HTML-based interactive maps and plots for spatial and temporal data exploration.
- **Consistent styling.** All figures follow the Aeolus design system (inheriting from Canopy design tokens) for visual consistency across publications and decks.

### 5.5 Writing and Synthesis

Sonde can turn analysis results into structured written output.

- **Technical summaries.** Given analysis results and figures, produce experiment descriptions, key findings, and implications in atmospheric science conventions.
- **Paper sections.** Draft methods, results, and discussion sections suitable for journal submission (with human review).
- **Slide content.** Generate bullet points, figure captions, and narrative framing for internal presentations or investor decks.
- **Formatted reports.** Package results into PDF or HTML reports and deliver via email or Slack.

### 5.6 Delivery

- **Inline in CLI or web chat** — figures, tables, text rendered directly in the conversation.
- **File export** — figures as PNG/SVG/PDF, data as CSV/NetCDF/Zarr, text as Markdown/LaTeX.
- **Slack integration** — post summaries and figures to designated channels.
- **Email** — send formatted reports to specified recipients.
- **Notebook export** — any analysis session can be exported as a reproducible Jupyter notebook.

---

## 6. Infrastructure Sonde Needs Access To

| System | What Sonde does with it |
|---|---|
| **GPU cluster** (persistent) | Submits Breeze/AeFS jobs, monitors status, retrieves logs |
| **Cloud storage** (S3/GCS) | Reads simulation output, writes intermediate analysis artifacts |
| **Zarr / Icechunk** | High-performance chunked reads of multi-dimensional atmospheric data — selective loading by variable, time step, spatial region |
| **Breeze.jl / AeFS** | Generates simulation configurations, triggers runs, parses output metadata |
| **Observation databases** | Pulls verification data (station obs, satellite retrievals, radar) |
| **CRTM (GPU-native)** | Accesses observation operator outputs for data assimilation analysis |

---

## 7. Vision Over Time

**Phase 1 — Research Assistant.** A single intelligent agent that the science team can talk to. It handles the grunt work: find data, load it, plot it, summarize it. It answers questions about atmospheric science grounded in our actual simulation data. It doesn't design experiments on its own — a human tells it what to do and it executes competently.

**Phase 2 — Coordinated Specialists.** Multiple agents with distinct expertise (data retrieval, analysis, visualization, writing, peer review) working together on complex tasks. A user describes a research question; Sonde designs an analysis plan, executes it across agents, and delivers a coherent result. Human-in-the-loop at key decision points.

**Phase 3 — Autonomous Research.** Sonde monitors ongoing simulation campaigns, identifies anomalies or interesting signals, proposes follow-up experiments, and maintains a living knowledge base of Aeolus's scientific findings. Multiple agent teams run in parallel across research threads — intervention modeling, forecast verification, data assimilation experiments — with scientists acting as reviewers rather than executors. Sonde becomes the engine that makes Aeolus's research output scale independently of headcount.

---

## 8. Long-Term Vision — What This Makes Possible

Sonde is not a chatbot that makes plots. At full maturity it becomes the reason Aeolus can do things that organizations 100× our size cannot. The core thesis: a 16-person company with a differentiable NWP stack and an autonomous research engine can outproduce the scientific output of entire government lab divisions — not by working harder, but by making the research loop fast enough that the limiting factor shifts from execution to imagination.

### The Intervention Research Multiplier

Hurricane intervention via aerosol seeding is a problem that lives or dies on simulation volume. The parameter space is enormous — seeding agent, droplet size distribution, injection altitude, timing relative to storm lifecycle, outer rainband targeting geometry, dosage — and each configuration requires a high-resolution simulation to evaluate. A human-driven research program can explore maybe dozens of configurations per month. Sonde running coordinated agent teams against our GPU cluster can explore thousands. It designs OSSE experiments based on hypotheses generated from prior results, submits them in batch, analyzes the output for thermodynamic and dynamic response, ranks configurations by intervention efficacy metrics, and surfaces the most promising candidates for human review. The seeding parameter space that would take a traditional research group years to map becomes a months-long automated campaign. This is how we build the scientific case for Stormfury 2.0 — not with a handful of carefully hand-crafted simulations, but with a systematic, AI-driven exploration of the intervention design space that produces publication-ready results at a pace no one else can match.

### Always-On Forecast Intelligence

On the commercial side, Sonde transforms Aeolus from a company that sells forecasts into a company that sells understanding. Every Breeze forecast cycle produces not just predictions but automatic verification against observations, anomaly detection, written market intelligence briefs, and trend analysis across historical performance. Energy traders in ERCOT and PJM don't get a number — they get a contextualized analysis: here's our wind forecast, here's how it compares to GFS and ECMWF, here's where we've historically been most and least skillful in this regime, here's what that means for your position. Sonde generates this automatically, every cycle, at a level of depth and consistency that no human analyst team could sustain. The marginal cost of adding a new market or a new analysis product becomes near-zero — it's just another agent workflow.

### A Living Scientific Knowledge Base

Over time, Sonde accumulates a structured memory of everything Aeolus has learned. Every simulation run, every analysis, every finding gets indexed into a queryable knowledge base. A scientist can ask "what do we know about the sensitivity of hurricane intensity to CCN concentration in the outer rainbands?" and get back not a literature review of published papers, but a synthesis of Aeolus's own simulation campaigns — with links to the specific runs, figures, and write-ups that support each finding. This is institutional memory that doesn't walk out the door when someone leaves. It compounds. The hundredth experiment Sonde runs on a topic is informed by the ninety-nine that came before it, and the knowledge base it builds becomes a moat that no competitor can replicate without running the same volume of experiments.

### The HAPS Research Loop

The HAPS program — stratospheric balloon platforms carrying radar and atmospheric sensors — generates a unique data stream that no one else has. Sonde closes the loop between HAPS observations and Breeze simulations: ingest real-time HAPS data, assimilate it into a running forecast, evaluate the impact on forecast skill, and propose adjustments to flight plans or sensor configurations to maximize scientific value. During hurricane field campaigns, this becomes a real-time adaptive research system — Sonde analyzes incoming observations, identifies gaps in the storm characterization, and recommends where to steer the platform next. The human scientist makes the final call, but the analysis that informs it happens in minutes instead of hours.

### Democratizing Atmospheric Science

The external-facing version of Sonde — scoped and permissioned — lets partners, customers, and eventually the broader research community interact with Aeolus's capabilities without needing to understand our infrastructure. A researcher at a university can ask questions about hurricane dynamics and get answers grounded in state-of-the-art simulations they could never run on their own hardware. An energy company can explore scenario analyses without hiring a meteorology team. This is how Aeolus's technology reaches beyond what we can sell directly — by making the interface to our science as simple as asking a question.

### What This Means for the Company

The strategic implication is that Sonde makes Aeolus's research output a function of compute budget and agent sophistication rather than headcount. We stop scaling linearly with people and start scaling with infrastructure. The same system that accelerates our internal science also generates the commercial intelligence products we sell, and the knowledge base it builds becomes the foundation of our scientific credibility for the intervention mission. The company that proves hurricane intervention is feasible will be the one that ran the most experiments, analyzed them the most rigorously, and published the results the fastest. Sonde is how a 16-person startup becomes that company.

---

## 9. What Success Looks Like

- **Time-to-insight** drops from ~4 hours (simulation complete → figures + summary in hand) to < 30 minutes.
- **Research throughput** increases 3–5× — more experiments analyzed per week without additional headcount.
- **Output quality** — Sonde-generated figures and text require < 2 revision rounds before publication-readiness.
- **Adoption** — 80%+ of the science team using Sonde weekly within 3 months of launch.

---

## 9. Open Questions

- **Julia ↔ Python boundary.** Breeze is Julia. Most agent frameworks are Python. What's the right interop strategy — subprocess calls, HTTP microservices, Julia-native agent logic? Needs prototyping.
- **Agent framework commitment.** LangGraph is the current direction. Should we also evaluate alternatives (custom, CrewAI, smolagents) against our specific requirements before committing?
- **Data conventions.** Do all Breeze simulation outputs already land in Zarr with consistent metadata and chunking? If not, what pipeline work is prerequisite?
- **Compute guardrails.** What approval workflow and cost limits should govern agent-submitted GPU jobs?
- **Hallucination risk.** How do we validate that agent-generated atmospheric science analysis is physically correct? What verification checks should be mandatory before any output leaves the system?
- **Scope boundary with Canopy.** Canopy defines the agent persona and design system; Sonde is the research execution engine. Is this the right boundary, or should they converge?

---

## 10. Out of Scope (Phase 1)

- Real-time operational forecasting integration
- Direct hardware control (HAPS payloads, sensors, instruments)
- Training or fine-tuning Breeze model parameters
- Public API access without authentication
- Mobile interface

---

## 11. Dependencies

- Breeze/AeFS simulation configs must be templateable and CLI-invocable
- GPU cluster must expose a programmatic job submission interface
- Simulation output pipeline must produce Zarr stores with consistent metadata
- Icechunk catalog must be operational and indexed
- Aeolus design system tokens available for figure styling