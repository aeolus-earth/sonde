# ATLAS (atlas-gic) — deep dive (Sonde notes)

**Upstream:** [chrisworsey55/atlas-gic](https://github.com/chrisworsey55/atlas-gic) — *ATLAS: self-improving AI trading agents* (General Intelligence Capital narrative; license in repo `LICENSE`).  
**Mirror:** `repos/atlas-gic`  
**Pin:** `170aadbe8bdcd80806ba569a54df5627b669ecac` (shallow clone; `main` at time of analysis)

---

## What the project claims (product / research story)

ATLAS is described as a **multi-agent trading stack** that combines:

- **[Karpathy autoresearch](https://github.com/karpathy/autoresearch)**-style **prompt = weights**, **Sharpe ≈ loss**, **git keep/revert** over ~5 trading days.
- **“Darwinian” per-agent weights** (daily nudge toward top/bottom quartile; CIO consumes weighted inputs).
- **25+ role-specialized agents** across **four layers** (macro → sector desks → “superinvestors” → decision), plus **meta-layer JANUS** (cohort blending) and **MiroFish**-inspired **swarm / scenario** simulation (including **reflexivity** rules in prompts).
- **PRISM / “All Seasons”**: regime-specific training cohorts; **JANUS** compares short- vs long-horizon cohorts for an emergent **regime signal**.
- **Agent spawning** and live-capital claims are **documented in the root README**; **trained prompts and production orchestration are explicitly excluded** from the public repo.

This note separates **documented architecture** from **what is actually present in the open-source tree**.

---

## What is actually in the public repository

| Content | Role |
|--------|------|
| **`README.md`** | High-level narrative, backtest headlines, stack list (Claude, MiroFish, FMP/Finnhub/Polygon/FRED, Azure VM, git). |
| **`architecture/*.md`** | Layer diagrams, JSON I/O contracts, autoresearch loop pseudocode, daily schedule. |
| **`prompts/examples/*.md`** | **Placeholder** agent prompt *structures* (macro, sector desk, superinvestor, CIO) — not trained prompts. |
| **`src/janus.py`** | Runnable-style **JANUS** implementation (cohort weights, blending, regime label). |
| **`src/mirofish/*.py`** | **MiroFish bridge**, **seed/futures/trainer/context** helpers — **import paths assume a larger `src/` layout** (see below). |
| **`results/*`** | Sample **equity curve image**, `summary.json`, `portfolio_trajectory.csv`, `autoresearch_log.json` (illustrative / demo). |
| **`src/README.md`** | Describes a **full** `agents/` pipeline (`eod_cycle.py`, `autoresearch.py`, etc.) — **those files are not in this clone**. |

**Critical honesty for integrators:** The **mirofish** and **seed** modules do `sys.path` hacks and import **`config.settings`**, **`data.macro_client`**, **`data.price_client`**. This repository **does not ship** `src/config/` or `src/data/` in the shallow tree we analyzed — so **`mirofish_bridge.py` and `mirofish_seed_generator.py` are not self-contained** without vendoring those dependencies or stubs. **`janus.py`** only needs standard library + `data/state` under the repo (it resolves `Path(__file__).parent.parent / "data" / "state"`). Treat the open repo as **architecture + partial reference implementation**, not a drop-in runnable full stack.

---

## Tools (as stated vs as seen in code)

### Stated in root README (marketing / ops)

- **LLM:** Claude Sonnet (**Anthropic API**).
- **Simulation:** MiroFish swarm engine (upstream [666ghj/MiroFish](https://github.com/666ghj/MiroFish)); public ATLAS code emphasizes a **“lightweight” mode**: **one Claude call** with a **system prompt that role-plays many agent types** (see below).
- **Market data:** FMP, Finnhub, Polygon, FRED.
- **Infra:** Azure VM; **git** for autoresearch branches.

### Present in open Python

- **`anthropic`** — `Anthropic` client in `mirofish_bridge.py` (`LightweightSimulator`), `mirofish_trainer.py` (`ForwardTrainer`).
- **`numpy`** — synthetic price paths in `mirofish_futures_generator.py`.
- **stdlib** — `json`, `pathlib`, `logging`, `dataclasses`, `math`, `argparse`, etc.

**No** LangChain, LangGraph, or multi-process agent framework appears in the provided files — coordination is **documented as a Python async pipeline** in architecture docs; **orchestration code for the 25-agent daily run is not open-sourced** per `src/README.md` (“implementation details are proprietary”).

---

## Multi-agent workflows (how they are described vs implemented)

### 1. Four-layer daily pipeline (documentation)

**Source:** `architecture/overview.md`, `architecture/layers.md`, root `README.md`.

- **Layer 1 — Macro (10 agents):** Parallel specialists → aggregated **regime** (risk-on / risk-off / neutral).
- **Layer 2 — Sector desks (7):** Long/short + **relationship mapper**; consumes Layer 1.
- **Layer 3 — Superinvestors (4):** Philosophy filters (named styles: Druckenmiller, Aschenbrenner, Baker, Ackman).
- **Layer 4 — Decision (4):** **CRO** (adversarial), **Alpha Discovery**, **Autonomous Execution**, **CIO** (final synthesis).

**Information flow:** Sequential **layering** with **structured JSON** artifacts (e.g. `macro_regime.json` → `sector_picks.json` → …) under `data/state/` in the docs. **Parallelism** within a layer is described (e.g. macro agents “in parallel”); **cross-layer** flow is **strictly downstream** (not a flat peer debate graph like some trading LLM frameworks).

**Open repo:** **No** `eod_cycle.py` or agent runner — only **scheduling narrative** and **example prompt outlines**.

---

### 2. Autoresearch (Karpathy-style prompt evolution)

**Source:** `architecture/autoresearch.md`, root README.

- Pick **worst Sharpe** agent → **one** targeted prompt edit → **git branch** → **5 trading days** → compare Sharpe → **merge or reset**.
- Separate from autoresearch: **Darwinian weights** updated daily from quartile performance; **CIO** consumes weighted recommendations.

**Open repo:** Detailed **pseudocode** and **git workflow** in markdown; **no** `autoresearch.py` in tree. `results/autoresearch_log.json` is a **sample artifact** only.

---

### 3. JANUS — meta cohort weighting (implemented)

**File:** `src/janus.py`

- **Inputs:** Per-cohort files `data/state/recommendations_{cohort}.json`, optional `scored_outcomes.json` (list with `cohort`, `date`, `is_hit`, `weighted_return`).
- **Logic:** Rolling **30d** metrics per cohort → combined score (50% hit rate + 50% normalized Sharpe) → **softmax with min/max caps** (`MIN_WEIGHT` 0.2, `MAX_WEIGHT` 0.8).
- **`regime_signal()`:** Compares default cohorts **`18month`** vs **`10year`** weight split → **`NOVEL_REGIME`**, **`HISTORICAL_REGIME`**, or **`MIXED`** from a fixed threshold on weight difference.
- **`blend_recommendations()`:** Per-ticker merge across cohorts; **contested** if cohorts disagree LONG vs SHORT; applies **disagreement penalty** to conviction.
- **CLI:** `python janus.py` optional cohort list.

This is **true multi-cohort fusion**, not multi-agent LLM calls — it is **algorithmic** meta-orchestration on top of whatever produces `recommendations_*.json`.

---

### 4. MiroFish integration — “swarm” without open swarm engine

**Files:** `src/mirofish/mirofish_bridge.py`, `mirofish_trainer.py`, `mirofish_futures_generator.py`, `mirofish_seed_generator.py`, `mirofish_context.py`

**Design intent (from comments):**

- **Lightweight (default):** Single **Claude** completion with **`SIMULATION_SYSTEM_PROMPT`** instructing the model to **role-play** hedge funds, central banker, retail, journalists, etc., and output **JSON** (round-by-round actions, reflexive loops, predictions, tail risks, highest-conviction trade).
- **Full MiroFish:** Described as optional (Zep / OASIS / `ZEP_API_KEY`); **not implemented** in the snippets reviewed — `MiroFishBridge(use_full_mirofish=True)` still instantiates **`LightweightSimulator`** only.

**Pipeline in `MiroFishBridge.generate_and_simulate()`:**

1. **`SeedGenerator`** — macro snapshot + key prices + `*_briefs.json` debates + `positions.json`; writes `mirofish_seeds.json`.
2. **`ScenarioGenerator`** — default scenario templates (Fed, oil, tech earnings, China, etc.) + high-conviction agent lines → top-N scenarios.
3. **`LightweightSimulator.run_simulation()`** — one **`messages.create`** with large max_tokens; parse JSON from response.
4. **Append** to `data/state/mirofish_predictions.json`; **`get_agent_context()`** formats markdown for **injection into downstream prompts** (matches `mirofish_context.py` helper).

**`ForwardTrainer`:** Loads **`futures_*.json`** scenarios, **per agent_id** calls **Haiku** with JSON recommendation, scores vs **synthetic `price_paths`**, updates **`agent_weights.json`**.

**Multi-agent angle:** This is **simulated** multi-agent behavior via **single-model role-play** + **separate per-agent evaluation** in the trainer — **not** 25 independent LLM agents in one framework.

---

## Domain layer

- **Finance / discretionary equity** — regime, sector, style filters, portfolio actions; **no** weather or physical modeling.

---

## Validation / feedback loops (as described)

| Loop | Mechanism |
|------|-----------|
| **Live / backtest** | Forward returns vs recommendations; **Sharpe** per agent; Darwinian weights. |
| **Autoresearch** | Prompt diff → 5-day window → git merge/revert. |
| **JANUS** | Cohort accuracy → softmax weights → blended recommendations + regime label. |
| **MiroFish lightweight** | **`PredictionScorer`** compares past simulation text to rough price reality (heuristic direction match); marked “simplified”. |

---

## Comparison hooks (Sonde)

| Similar to | Unlike |
|------------|--------|
| **[TradingAgents](../trading-agents/README.md)** — multi-role finance agents | ATLAS open repo **does not** ship the LangGraph-style runner; narrative is **layered + Darwinian + autoresearch** |
| **[karpathy autoresearch](../autoresearch/README.md)** | Same **git / metric** metaphor; ATLAS swaps **Sharpe** and **prompt files** |
| **Denario / cmbagent** | ATLAS is **trading**; no scientific paper pipeline |

**Bottom line for reuse:** Use **`janus.py`** as a **reference for cohort blending + regime from weight spread**. Use **MiroFish files** as **patterns** for **single-LLM scenario simulation** and **prompt injection** — expect to **rewire imports** and supply **`config` / `data` clients** yourself. For the **25-agent EOD pipeline**, the public repo is **documentation and examples only**.

---

## References

- Upstream README and `architecture/` markdown in the mirror.  
- External: [MiroFish](https://github.com/666ghj/MiroFish), [autoresearch](https://github.com/karpathy/autoresearch).
