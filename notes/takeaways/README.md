# Takeaways — Durable Agent System Design

Cross-cutting lessons extracted from the 9 repos surveyed in Sonde. These are the patterns that separate production-grade agent systems from demos. Update this file as new learnings emerge during system build.

Related notes:

- [Data analyst first, research agent maybe later](./data-analyst-vs-research-agent.md)
- [Multi-agent: what's real vs. what's cope](./multi-agent-reality-check.md)
- [Obsidian as a living knowledge base](./obsidian-living-knowledge-base.md)
- [Claude Code harness vs. consumer product](./claude-code-vs-consumer-product.md)
- [Agent stack choice for Sonde](./agent-stack-choice.md)
- [Obsidian vs. Mem0 for Sonde](./obsidian-vs-mem0.md)

---

## Core principles

### 1. State lives on disk, not in context windows

Durable state must be files, git, or a structured store — not chat history or in-process session objects. If the agent can't cold-start from files alone, it's not durable.

**Strongest examples:** autoresearch (`program.md` + `train.py` + `results.tsv` + git), AutoResearchClaw (checkpoint/resume per stage), ScienceClaw (append-only artifact store + global index).

**Anti-pattern:** LangGraph `MessagesState` or ADK session objects without checkpointing — process dies, state is gone.

**Rule:** The filesystem (or structured store) is the single source of truth. Context windows are ephemeral working memory.

---

### 2. Explicit stage machines beat free-form planning for long workflows

Encode the outer loop as a state machine with checkpoint/resume. Let the LLM be creative *within* stages, but don't let it decide *which stage to run next* for mission-critical pipelines.

**Strongest example:** AutoResearchClaw — 23-stage pipeline with gates, rollback maps, pivot caps. Clear audit trail, deterministic retry/rollback.

**Anti-pattern:** deepagents — LLM decides when to delegate. Flexible but hard to debug, resume, or audit.

**Rule:** State machine for the outer loop. LLM creativity inside stages only.

---

### 3. Quality gates need structure, not vibes

Every quality gate should have a machine-checkable condition, not just "LLM reviews and says ok." Use the LLM for interpretation of results, not for deciding whether a simulation succeeded.

**Structured evaluation (good):**
- AI-Scientist-v2: metric-based (val_bpb)
- AutoResearchClaw: VerifiedRegistry + sentinel (NaN/Inf detection) + gate stages
- agentic-data-scientist: Pydantic `met` + `evidence` per criterion
- ScienceClaw: deterministic pressure scoring

**Vibes evaluation (fragile):**
- TradingAgents, DATAGEN, deepagents — LLM says it's good

**Rule:** Machine-checkable conditions at every gate. LLM interprets; code validates.

---

### 4. Failure recovery must be designed, not hoped for

For each stage: what can fail, how many retries, what's the fallback, and what's the circuit breaker. Pre-allocate failure budgets like you pre-allocate memory — no runtime surprises.

**Best patterns:**
- AutoResearchClaw: gates with rollback maps + `MAX_DECISION_PIVOTS` prevents infinite loops
- AI-Scientist-v2: tree search — failed branches don't kill siblings; `max_debug_depth` limits retries
- ScienceClaw: reactor fan-out limits + `consumed.txt` prevents cascade failures

**Worst patterns:**
- TradingAgents: no rollback at all
- DATAGEN: `MemorySaver` declared but not wired to `compile()`
- deepagents: trusts sandboxing, no structured retry

**Rule:** Explicit failure modes, retry budgets, and circuit breakers per stage.

---

### 5. Two-speed execution

Planning and execution have different compute profiles. Don't use the same orchestration weight for both.

**Examples:**
- Denario: fast LangGraph for routing, slow cmbagent for code-heavy work
- agentic-data-scientist: ADK for planning/review, Claude Code SDK for implementation
- AI-Scientist-v2: quick LLM calls for tree navigation, expensive GPU runs for code execution
- TradingAgents: `quick_think_llm` vs `deep_think_llm`

**Rule:** Lightweight reasoning for routing/planning. Heavyweight execution for simulation/code. Separate the tiers.

---

### 6. Cross-run learning (the biggest gap)

Most repos start fresh every run. Only two have any story here:
- AutoResearchClaw: MetaClaw merges past failures into prompts across stages
- ScienceClaw: artifact lineage tracks what was produced and by whom

**Minimum viable version:** `results.tsv` (autoresearch) — flat log of what was tried and what the metric was.

**Better:** Journal tree (AI-Scientist-v2) — tree of attempts with parent/child relationships and metrics at each node, queryable by future sessions.

**Rule:** Structured experiment log that persists across runs. What was tried, what worked, why. Queryable by the agent.

---

## Orchestration styles ranked by durability

| Rank | Style | Resumable? | Auditable? | Failure recovery? | Example |
|------|-------|------------|------------|-------------------|---------|
| 1 | Explicit stage machine + gates | Yes (checkpoints) | Yes (stage log) | Rollback maps | AutoResearchClaw |
| 2 | Tree search + journal | Yes (journal nodes) | Yes (tree structure) | Sibling branches survive | AI-Scientist-v2 |
| 3 | Artifact reactor + index | Yes (append-only store) | Yes (lineage) | Fan-out limits | ScienceClaw |
| 4 | Files + git + external agent | Yes (disk state) | Yes (git log) | Git reset | autoresearch |
| 5 | LangGraph DAG + structured state | Partial (if checkpointed) | Partial | Router reroute | DATAGEN, TradingAgents |
| 6 | ADK sequential + loops | Partial | Partial (event stream) | Loop detection | agentic-data-scientist |
| 7 | Middleware + LLM-planned delegation | No | No | Sandbox only | deepagents |

---

## Checklist for building a new durable agent system

- [ ] Can the agent cold-start from disk state alone (no prior context window)?
- [ ] Is the outer loop an explicit state machine with named stages?
- [ ] Does every stage have a checkpoint written on completion?
- [ ] Does every quality gate have a machine-checkable condition?
- [ ] Does every stage have a defined failure budget (max retries, fallback, circuit breaker)?
- [ ] Is planning/routing separated from heavyweight execution?
- [ ] Is there a structured experiment log that persists across runs?
- [ ] Can a human (or new agent session) audit what happened from the log alone?

---

## Open questions

- How to balance stage-machine rigidity with the need for adaptive replanning (agentic-data-scientist's stage reflector rewrites stages mid-run)?
- What's the right granularity for checkpoints in a GPU simulation pipeline?
- How to do cross-run learning without unbounded context growth (MetaClaw merges past failures, but how to prune)?
- When is tree search (AI-Scientist-v2) better than linear pipeline (AutoResearchClaw) for experiment orchestration?

---

## Future additions

Add new takeaways below as they emerge during system build. Reference the source repo or experience.
