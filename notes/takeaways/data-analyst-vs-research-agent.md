# Data Analyst First, Research Agent Maybe Later

## The realization

After surveying 9 agent frameworks and thinking through what a "durable agent system" looks like for Aeolus, the most important insight isn't about orchestration patterns or knowledge bases. It's about what kind of agent we're actually building.

There are two fundamentally different things hiding behind the word "agent":

**A data analyst agent** — a human asks a question ("how does yesterday's 500m Flood.jl run compare to the ADCIRC hindcast at the Houston Ship Channel gauges?"), the agent finds the data, loads it, computes diagnostics, makes plots, and presents a summary. The human interprets, decides what to ask next, and drives the investigation. The AI is fast hands with domain awareness.

**A research agent** — the system autonomously generates hypotheses, designs experiments, runs simulations, evaluates results, updates a knowledge base, and iterates. The human reviews findings and steers high-level direction. The AI is the driver.

These are not points on a spectrum. They require fundamentally different architectures, different infrastructure investments, and different levels of trust in the AI's judgment. Most of the Sonde survey work — orchestration frameworks, stage machines, knowledge graphs, cross-run learning — is about the research agent. But the data analyst is what's actually useful right now, and possibly for a long time.

## Why the data analyst framing is more honest

**Scientists are good at the research part.** Generating hypotheses, designing experiments, interpreting surprising results, connecting findings to theory — that's what atmospheric scientists do. They don't need an AI to tell them "maybe try higher resolution in the eyewall region." They need an AI to pull the data, compute the RMSE, and show them the comparison plot in 30 seconds instead of 30 minutes.

**The bottleneck is data wrangling, not insight.** In practice, the majority of a scientist's time on any analysis task is finding the right file, loading it correctly, dealing with coordinate transforms, subsetting in space and time, computing standard diagnostics, and making figures. This is the tedious part. This is also the part that models can do reliably today with good tools.

**A single model call with good tools is sufficient.** The data analyst doesn't need LangGraph, multi-agent coordination, or a stage machine. It needs: a STAC query tool, a Zarr/Icechunk loading tool, diagnostic functions, plotting functions, and a frontier model that can chain them together. Claude, Gemini, or GPT can do "search the catalog → load the data → compute statistics → make a plot → summarize" in a single tool-use chain right now. The orchestration framework is the model's native tool-use loop. That's it.

**The research agent requires trust we haven't earned yet.** Trusting an AI to design experiments and interpret results in atmospheric science requires extensive validation that we haven't done. Trusting it to load a Zarr slice and compute an RMSE requires almost none. Start where the trust is justified.

## What this means for infrastructure priorities

The data analyst reframing dramatically simplifies what needs to be built now:

### Build now (critical for the data analyst)

**STAC catalog.** This is how the agent discovers what data exists. Without it, every query requires hardcoded paths or a human saying "the file is at s3://...". With it, the agent can search by model, date range, spatial extent, variable, resolution — the same way a scientist would browse a data catalog, but in milliseconds. This is the single most important infrastructure investment.

**Zarr/Icechunk tools.** Functions that load, subset, and transform simulation output. `load_zarr_slice(run_id, variable, level, bbox, time_range)` — this is the core data access layer. The agent needs to go from a STAC item to arrays in memory without knowing the storage hierarchy.

**Diagnostic and verification functions.** `compute_rmse(forecast, observation, region)`, `compute_bias(forecast, observation)`, `compute_skill_score(forecast, observation, reference)`. These are the domain-specific tools that make the agent useful for atmospheric science rather than generic data analysis. They encode what "good" looks like.

**Plotting tools.** `plot_plan_view(data, style)`, `plot_cross_section(data, lat_or_lon, level_range)`, `plot_time_series(data, locations)`, `plot_comparison(forecast, observation, metrics)`. Scientists think in plots. The agent's output should be visual.

**Breeze/Flood configuration tools.** Functions that help set up and submit simulation runs. Not autonomous — the scientist reviews the config before submitting — but the agent can generate a draft config from a description ("500m grid over Houston Ship Channel, Flood.jl with Green-Ampt infiltration, 24-hour forecast from yesterday's GFS").

### Build later (needed for the research agent, not the analyst)

**Orchestration framework.** The data analyst doesn't need a stage machine. The human is the orchestrator. Defer this until there's a demonstrated need for autonomous multi-step workflows.

**Knowledge base (Obsidian/Mem0).** At low simulation volume with a small team, the scientists' memory and informal notes are the knowledge base. The structured knowledge layer becomes necessary when the volume exceeds what humans can track — hundreds of runs per month, or when agents start running analyses overnight without human supervision. That's a future problem.

**Cross-run learning.** Same logic. When the agent is doing its own research, it needs to know what's been tried. When the human is driving, the human knows what's been tried.

**Multi-agent coordination.** The data analyst is one agent responding to one human. No routing, no supervisor, no teams.

## The nuance: this isn't "never build the research agent"

The data analyst framing isn't a retreat from the vision — it's a sequencing decision. Some important subtleties:

**The tool layer is the same.** Every function built for the data analyst (STAC queries, Zarr loading, diagnostics, plotting, verification) is exactly what a research agent would also use. Building the analyst first means building the tool layer first, which was already the recommendation from the multi-agent reality check. The tools are the durable asset regardless of which agent framing wins.

**The analyst will evolve toward research naturally.** Once the analyst can reliably answer "how does this run compare to observations," the next natural question is "can you check all 12 runs from last week and tell me which configuration performed best?" That's still analysis, not research — but it's multi-run analysis that starts to look like automated evaluation. The boundary between "analyst that compares many runs" and "research agent that selects the best configuration" is blurry. Let the boundary move organically based on what the team trusts the agent to do, rather than designing for autonomous research from day one.

**Some research-agent infrastructure will emerge from analyst use.** If the analyst is answering the same questions repeatedly ("what's the RMSE of our latest coastal run?" every morning), that's a signal to automate — not with a research agent, but with a scheduled analysis job. That scheduled job is a one-stage "pipeline." Over time, common sequences of questions become common sequences of stages. The orchestration layer, if it's ever needed, will emerge from actual usage patterns rather than being designed a priori from surveyed frameworks.

**The knowledge base becomes necessary at a specific, observable threshold.** When any of these happen, it's time:
- A scientist asks a question and the answer requires context from a run that nobody on the team remembers
- An agent re-runs an analysis that was already done because there's no record
- The team can't reconstruct why a particular simulation configuration was chosen
- The number of runs exceeds what the team can track informally

Until those signals appear, the knowledge base is premature.

**"Spin up Claude for research" is actually a reasonable research agent strategy.** For open-ended research questions — "what's the sensitivity of surge height to Manning's n in this domain?" — an interactive conversation with a frontier model using the analyst tools might be the right interface for a long time. The human and the model co-investigate, with the model doing the data retrieval and computation. That's not an autonomous research agent, but it might be 80% of the value at 10% of the infrastructure cost. The remaining 20% (fully autonomous hypothesis generation, experiment design, overnight runs) may not justify the remaining 90% of the infrastructure until the tool layer is mature and trusted.

## Hidden assumptions in this framing (being honest)

**This assumes the bottleneck is data access, not model quality.** If Flood.jl produces bad results, a fast data analyst just shows you bad results faster. The analyst is only as valuable as the underlying simulations. If the team is still debugging the model itself, the analyst is less useful than direct code investigation.

**This assumes scientists will actually use it.** A tool that's 10x faster than manual analysis but requires learning a new interface may still lose to the scientist's existing Jupyter notebook workflow. The analyst needs to be accessible — probably a chat interface or CLI, not a programmatic API — and it needs to be reliable enough that scientists trust the results without re-checking manually.

**This assumes STAC adoption.** The whole "agent discovers data through metadata" story requires the STAC catalog to be populated, maintained, and comprehensive. If STAC coverage is patchy, the agent falls back to hardcoded paths and the value proposition collapses. STAC hygiene is a prerequisite, not a nice-to-have.

**This might underinvest in the knowledge layer.** The argument against building Obsidian/Mem0 now is "wait until you need it." But the takeaway docs also say that bolting on a knowledge layer later is harder than designing it in from the start. There's a tension here. A lightweight compromise might be: log every agent interaction (question asked, data accessed, result produced) to a structured append-only log from day one. Not a knowledge graph — just a queryable record. If the knowledge base is ever needed, this log is the raw material.

## The revised north star

**A data analyst agent that any scientist on the team can ask questions to, backed by a well-curated STAC catalog and a clean set of domain-specific tools, that's fast enough to be interactive and reliable enough to be trusted.**

That's useful in month 1. It earns trust. It builds the tool layer. And it doesn't foreclose on the research agent if that becomes the right move later.
