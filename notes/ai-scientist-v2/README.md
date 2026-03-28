# AI-Scientist-v2 (Sakana AI)

Upstream: [SakanaAI/AI-Scientist-v2](https://github.com/SakanaAI/AI-Scientist-v2)  
Local mirror: `repos/AI-Scientist-v2`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `96bd51617cfdbb494a9fc283af00fe090edfae48` |

---

## What it does

**AI Scientist v2** is an **end-to-end automated ML research pipeline** that aims to go from a **topic / idea** to **experiments** and a **manuscript-style PDF** (workshop-level). It:

1. **Ideation** — Brainstorms and refines **structured research ideas** from a Markdown topic file, optionally checking **novelty** via **Semantic Scholar**.
2. **Experimentation** — Runs **best-first tree search (BFTS)** over **LLM-written training code**: many branches of code changes are tried, **executed on GPU** (PyTorch), scored by a **metric**, and organized in a **search tree** (“journal”).
3. **Write-up** — After experiments, **aggregates plots**, generates **LaTeX** (ICLR-style templates), gathers **citations**, and runs **LLM/VLM review** of text and figures.

**v1 vs v2 (upstream README):** v2 is **more exploratory** and **template-free** than v1; success rates and paper quality can be **lower** than v1 when a strong human template exists.

**Safety:** README warns: **LLM-generated code runs with real compute**—use a **sandbox** (e.g. Docker).

---

## How it works (architecture)

### Phase A — Ideation (`ai_scientist/perform_ideation_temp_free.py`)

- **Input:** Markdown file (e.g. `ai_scientist/ideas/*.md`) with sections like Title, Keywords, TL;DR, Abstract.
- **Process:** LLM generates candidate ideas with **reflection** loops; **Semantic Scholar** tool can assess overlap with literature.
- **Output:** **JSON** (e.g. `my_research_topic.json`) listing structured ideas (hypotheses, experiments, etc.) for the next phase.

### Phase B — Main launch (`launch_scientist_bfts.py`)

Orchestrates, in order:

1. **`perform_experiments_bfts`** (`ai_scientist/treesearch/perform_experiments_bfts_with_agentmanager.py`) — **BFTS + AgentManager**.
2. **`perform_plotting.aggregate_plots`** — Plot aggregation.
3. **Write-up** — `perform_icbinb_writeup` or `perform_writeup` depending on `--writeup-type`.
4. **Review** — `perform_llm_review`, `perform_vlm_review` (images/captions/refs).

Configuration is merged from **`bfts_config.yaml`** (tree search, worker counts, code/feedback models, timeouts, debug policy).

### Core loop — BFTS + journals (not LangGraph)

The experiment engine is **not** a single LangChain graph. It is:

- A **Journal** data structure holding a **tree of nodes** (`journal.py`): each node is a **code attempt** + **execution result** + **metric** (better/worse than parent).
- **Parallel workers** (`parallel_agent.py`) expand the tree **concurrently** (ProcessPoolExecutor): generate code → **run** in a controlled **interpreter** → **LLM “feedback”** reviews stdout/tracebacks (and optionally VLM) → decide bugs/improvements.
- **Best-first** selection: prioritize promising nodes (configurable metric / “worst” handling in `utils/metric.py`).
- **Debugging:** `search.max_debug_depth`, `search.debug_prob` in `bfts_config.yaml` control retries on failing nodes.

### AgentManager — staged “experiment manager”

`ai_scientist/treesearch/agent_manager.py` implements a **high-level manager** that structures work into **stages** (e.g. initial implementation → baseline tuning → creative research → ablation studies). It uses **LLM structured outputs** (function/tool schemas like `generate_stage_config`, `evaluate_stage_progression`, `evaluate_stage_completion`) to:

- Propose **stage configs** (goals, iteration limits),
- Decide **when to move** between stages,
- Coordinate **multiple journals** / draft roots (`num_drafts` in config).

So “coordination” here is **hierarchical**: **manager agent** (LLM + schemas) + **parallel coding agents** (tree search workers), not a fixed DAG like DATAGEN.

### Code execution

- **`bfts_config.yaml`**: `exec.timeout`, `agent_file_name: runfile.py`, workspace under `workspaces/`, data under `data/` (often **copied** into workspace so the agent does not corrupt originals).
- **`interpreter.py`** runs generated scripts and captures results for scoring and review.

### Write-up and citations

- **LaTeX** templates under `ai_scientist/blank_icbinb_latex/` and `blank_icml_latex/`.
- **Citations:** `gather_citations` and related flows in `perform_icbinb_writeup.py`; Semantic Scholar optional (`S2_API_KEY`).
- **VLM** path for figure/caption review (`perform_vlm_review.py`, `vlm.py`).

---

## Tools and dependencies

| Category | Examples |
|----------|----------|
| **LLM APIs** | OpenAI (`openai`), Anthropic (`anthropic`), AWS Bedrock via boto3, Gemini (via docs) |
| **Literature** | `ai_scientist/tools/semantic_scholar.py`, optional API key |
| **ML stack** | PyTorch (conda install in README), `transformers`, `datasets`, `wandb` |
| **Runtime / UI** | `rich`, `humanize`, `omegaconf`, `tiktoken` |
| **PDF/LaTeX** | `pypdf`, `pymupdf4llm`; external `poppler`, `chktex` (conda) |

**Tree search** implementation is based on / adapted from **[AIDE](https://github.com/WecoAI/aideml)** (acknowledged in README).

---

## Comparison hooks

| | |
|---|---|
| **Similar to** | **Autoresearch** (iterate ML code + train) but **much larger**: multi-node search, paper writing, citations. |
| **Unlike** | **LangGraph** app graphs (DATAGEN/TradingAgents); **Deep Agents** harness—this is **custom BFTS + journals**. |
| **Coordination** | **Parallel tree expansion** + **stage manager** (LLM) + **sequential** post-hoc paper pipeline. |
