# Denario — deep dive (Sonde notes)

**Upstream:** [AstroPilot-AI/Denario](https://github.com/AstroPilot-AI/Denario) — *Modular multi-agent system for scientific research assistance* (GPL-3).  
**Mirror:** `repos/Denario`  
**Pin:** `61e0cce55550952bc937a5031cf20a51dd7871b3` (shallow clone; `master` at time of analysis)  
**PyPI:** `denario` 1.0.1 (`pyproject.toml`)

---

## What it does (product shape)

Denario is an **end-to-end research assistant** that takes a **data + tools description** (`data_description.md`), then drives (or lets the user inject) **idea → methods → executable results → LaTeX paper** in journal styles (AAS, APS, ICML, NeurIPS, JHEP, PASJ, etc.). The public README positions it as using **AG2** and **LangGraph**, with **[cmbagent](https://github.com/CMBAgents/cmbagent)** as the **research analysis backend**.

**In this codebase**, orchestration is split cleanly into:

1. **`cmbagent`** — heavy, planner/reviewer/engineer/researcher-style **planning and control** for idea (optional), methods (optional), and **results** (default path).
2. **`langgraph`** — **StateGraph** pipelines for **fast** idea/methods, **literature check**, **referee**, and **full paper generation**.

Optional: **`futurehouse-client`** for Owl-style literature checks; **`cmbagent.preprocess_task`** / **`cmbagent.get_keywords`** for input enhancement and keywords.

---

## Tools (stack)

| Layer | Technology | Role |
|-------|------------|------|
| **Graph runtime** | **LangGraph** (`StateGraph`, `MemorySaver` checkpointer) | `denario/langgraph_agents/agents_graph.py`, `denario/paper_agents/agents_graph.py` |
| **LLM adapters** | **LangChain** — `ChatGoogleGenerativeAI`, `ChatOpenAI`, `ChatAnthropic` | Wired in `preprocess_node` (`reader.py`) from model name + `KeyManager` |
| **Research backend** | **`cmbagent`** (PyPI `cmbagent>=0.0.1post63`) | `planning_and_control_context_carryover`, `preprocess_task`, `get_keywords` |
| **Literature (alt)** | **Semantic Scholar** HTTP API | `literature.py` (`SSAPI`) |
| **Literature (alt)** | **FutureHouse** (`futurehouse-client`) | `check_idea_futurehouse()` → `FutureHouseClient`, `JobNames` `"owl"` |
| **Paper assets** | **PyMuPDF**, **Pillow** | PDF → images for referee; plot handling |
| **Validation / parsing** | **jsonschema**, **json5** | Structured novelty decisions, configs |
| **App** | **`denario_app`** (optional extra) | `denario run` — Streamlit-style GUI (separate repo DenarioApp) |
| **Docs** | **MkDocs** + Material, etc. | ReadTheDocs |

**AG2:** The upstream README states agents are implemented with **AG2** (`ag2.ai`). This tree does **not** import `ag2` directly in the paths reviewed; **multi-agent behavior for “slow” modes is delegated to `cmbagent`**, which may wrap AG2 internally — treat **AG2 as claimed ecosystem**, **cmbagent as the concrete Python dependency** you pin and inspect.

---

## Multi-agent coordination

### 1. Two backends: “fast” (LangGraph) vs “cmbagent”

`Denario` (`denario/denario.py`) documents:

- **`cmbagent`** — “detailed planning and control involving numerous agents” for idea, methods, results.
- **`langgraph`** — “faster idea and method generation, and for the paper writing.”

**`get_idea` / `get_method`:** `mode="fast"` → LangGraph (`build_lg_graph`); `mode="cmbagent"` → `Idea.develop_idea` / `Method.develop_method` calling **`cmbagent.planning_and_control_context_carryover`**.

**`get_results`:** Always **`Experiment.run_experiment`** → **`cmbagent.planning_and_control_context_carryover`** with **engineer** + **researcher** roles (and planner/plan_reviewer/orchestration/formatter models). No LangGraph shortcut for compute in the reviewed code.

**`get_paper`:** **`build_graph`** (paper agents) — LangGraph only, **`asyncio.run(graph.ainvoke(...))`**.

**`check_idea`:** Semantic Scholar path reuses **`build_lg_graph`** with `task="literature"`; FutureHouse path is a **single remote job**, not LangGraph.

**`referee` (method on `Denario`):** LangGraph **`task="referee"`** — PDF pages to images + LLM review.

---

### 2. LangGraph #1 — “research” graph (`build_lg_graph`)

**File:** `denario/langgraph_agents/agents_graph.py`

**Nodes:**

| Node | Role |
|------|------|
| `preprocess_node` | Load `data_description` (and idea for methods/lit), instantiate LLM, set output paths, token counters |
| `maker` | **Idea maker** — prompt → stream → extract `IDEA` block → append to `previous_ideas`, increment iteration, write final `idea.md` on last round |
| `hater` | **Idea hater** — critique → `CRITIC` block |
| `methods` | **Fast methods** (`methods_fast`) — one-shot style generation to `methods.md` |
| `novelty` | **Novelty decider** — JSON decision: novel / not novel / need more search + **query** |
| `semantic_scholar` | Fetch papers for query, append to logs |
| `literature_summary` | Summarize against literature, write `literature` file |
| `referee` | Vision-style review from PDF images |

**Control flow:**

- **Entry:** `START → preprocess_node`.
- **`task_router(state['task'])`** from preprocess:
  - `idea_generation` → `maker`
  - `methods_generation` → `methods`
  - `literature` → `novelty`
  - `referee` → `referee`
- **Idea loop:** `maker` → **conditional** `router`: if `idea.iteration < idea.total_iterations` → `hater` → `maker`; else **`END`** (LangGraph `__end__`).
- **Methods:** `methods` → `END`.
- **Literature:** `novelty` → **`literature_router`** returns `state['literature']['next_agent']` → either `semantic_scholar` → back to `novelty`, or `literature_summary` → `END`.

So **multi-agent** here is **explicit graph roles** (maker/hater/novelty/search/summary/referee), not free-form delegation.

---

### 3. LangGraph #2 — paper graph (`build_graph`)

**File:** `denario/paper_agents/agents_graph.py`

Linear pipeline after preprocess:

`preprocess_node → keywords_node → abstract_node → introduction_node → methods_node → results_node → conclusions_node → plots_node → refine_results → [citation_router] → citations_node | END`

**`citation_router`:** If `paper.add_citations` is True → `citations_node`; else → `__end__`.

Each `_node` is a **section specialist** (abstract, intro, methods, …) with shared **`LLM_call_stream`** / LaTeX tooling in `paper_agents/tools.py` (token accounting, temp TeX files, journal presets).

---

### 4. cmbagent — planner / multi-role loops

**Idea (`denario/idea.py`):**  
`cmbagent.planning_and_control_context_carryover(...)` with **`idea_maker`**, **`idea_hater`**, planner, plan reviewer, orchestration + formatter models. Instructions from **`idea_planner_prompt`**. Output extracted from chat via **`get_task_result(..., 'idea_maker_nest')`**.

**Method (`denario/method.py`):**  
Same entrypoint with **researcher** + planner/reviewer; **`researcher_response_formatter`** task extracts markdown methodology from fenced blocks.

**Experiment (`denario/experiment.py`):**  
`involved_agents` default `['engineer','researcher']`. **`planning_and_control_context_carryover`** with high `max_rounds_control`, experiment-specific prompts (`experiment_planner_prompt`, etc.), **`researcher_response_formatter`** for final results markdown, **`final_context['displayed_images']`** for plots moved into `input_files/Plots`.

So **coordination** is **cmbagent’s** planning-and-control loop (not a second LangGraph in-repo).

---

## Domain layer

- **Not NWP-specific:** Any domain where the user describes data + tools in natural language; examples in repo/docs skew **astro / ML / general science**.
- **Artifacts:** `project_dir/input_files/` — `data_description.md`, `idea.md`, `methods.md`, `results.md`, plots, literature file; paper outputs under a `paper/` folder (see `PAPER_FOLDER` in config) with versioned PDFs for referee.

---

## Validation and quality loops

| Mechanism | Where |
|-----------|--------|
| **Maker / hater iterations** | LangGraph idea loop; configurable `iterations` in `get_idea_fast` |
| **Literature novelty loop** | `novelty_decider` + optional Semantic Scholar rounds + summary; max iterations in state |
| **FutureHouse** | Binary-style answer + “related work” text |
| **cmbagent** | Planner + plan reviewer, step limits, `max_n_attempts` for code execution in experiments |
| **Paper** | `refine_results` node + optional **citations** branch |
| **`referee`** | Separate graph task — multimodal review of PDF |

There is **no** single unified “unit test suite for science” in the small `tests/` file listing — evaluation is **LLM + retrieval + execution** shaped.

---

## Invocation

- **Library:** `from denario import Denario, Journal` — `Denario(project_dir=...)`, then `set_data_description`, `get_idea`, `get_method`, `get_results`, `get_paper`.
- **CLI:** `denario` → `denario.cli:main` (see `pyproject.toml`).
- **Full shortcut:** `research_pilot()` runs default chain (uses defaults for `get_idea` / `get_method` — check signatures for `mode`).

---

## Comparison hooks (Sonde)

| Similar to | Unlike |
|------------|--------|
| **LangGraph DAG** apps (e.g. DATAGEN, TradingAgents) — explicit nodes + routers | Results path is **cmbagent-only**, not a second graph |
| **AI-Scientist-v2** — paper + literature | Denario **integrates cmbagent** for code execution and structured agent roles |
| **agentic-data-scientist** — plan/review loops | Denario uses **cmbagent** instead of ADK; paper path is **fixed section DAG** |

**Impressive aspects:** Clean **split** between **fast LangGraph** and **slow cmbagent**; **one** graph reused for idea/methods/lit/referee with `task` routing; **journal-aware LaTeX** pipeline; **Semantic Scholar + FutureHouse** options for novelty.

---

## References

- Paper: [arXiv:2510.26887](https://arxiv.org/abs/2510.26887)  
- Docs: [denario.readthedocs.io](https://denario.readthedocs.io/en/latest/)  
- Backend: [CMBAgents/cmbagent](https://github.com/CMBAgents/cmbagent)
