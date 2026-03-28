# MiroFish — deep dive (Sonde notes)

**Upstream:** [666ghj/MiroFish](https://github.com/666ghj/MiroFish) — *简洁通用的群体智能引擎* / swarm intelligence prediction engine (AGPL-3.0 in `backend/pyproject.toml`).  
**Mirror:** `repos/MiroFish`  
**Pin:** `1536a7933450abc4dbecec90bf4bb7990ef27a4f` (shallow clone; `main` at time of analysis)  
**Backend package:** `mirofish-backend` 0.1.0

---

## What it does (product shape)

MiroFish is a **full-stack application** (Vue frontend + Flask backend) that:

1. Ingests **seed documents** (reports, stories, etc.).
2. Uses an **LLM** to design a **social-simulation-oriented ontology** (entity/edge types for “accounts that can post and interact”).
3. Builds a **standalone knowledge graph** in **Zep Cloud** (chunked text → episodes → GraphRAG-style graph).
4. **Materializes graph entities** into **thousands of LLM-driven social agents** via **CAMEL [OASIS](https://github.com/camel-ai/oasis)** — simulated **Twitter** and **Reddit** environments running in **parallel** subprocesses.
5. **Streams simulation actions** to the UI, optionally **appends each action as natural-language episodes** back into Zep so the graph **grows with the simulation**.
6. Runs a **ReportAgent** that **plans an outline**, then **ReACT-loops** per section with **Zep retrieval tools** (and **live “interviews”** with simulated agents).

**Stated workflow** (README): 图谱构建 → 环境搭建 → 双平台模拟 → ReportAgent 报告 → 深度互动.

---

## Tools (stack)

| Layer | Technology | Role |
|-------|------------|------|
| **Backend API** | **Flask** 3.x, **flask-cors** | REST for graph, simulation, reports |
| **LLM** | **OpenAI Python SDK** (`openai>=1`) with **any OpenAI-compatible endpoint** (`LLM_BASE_URL`, `LLM_MODEL_NAME`; README suggests Alibaba **Qwen** via DashScope) |
| **Graph + memory** | **zep-cloud** 3.13.0 (`Zep` client) | Create graph, ontology, ingest episodes, search, temporal edges |
| **Social simulation** | **camel-oasis** 0.2.5, **camel-ai** 0.2.78 | Twitter/Reddit-style multi-agent env |
| **Documents** | **PyMuPDF**, **charset-normalizer**, **chardet** | PDF/text ingestion |
| **Config** | **python-dotenv**, **pydantic** | Env and models |
| **Frontend** | **Vue** + **Vite** (`frontend/`) | Wizard UI: graph build → env → simulation → report → chat |
| **Ops** | **Docker Compose**, root **npm** scripts | `npm run dev` runs both tiers |

**Environment (from `.env.example` / README):** `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME`, **`ZEP_API_KEY`** (required for graph features).

**Note on “LangChain”:** `report_agent.py`’s module docstring says “LangChain + Zep.” The backend **`pyproject.toml` does not depend on LangChain**; **ReportAgent** implements **ReACT manually** (LLM turns + `_execute_tool` calling `ZepToolsService`). Treat “LangChain” as **outdated comment** unless a future commit adds the dependency.

---

## Multi-agent workflows

### 1. Ontology generation (single LLM, structured output)

**File:** `backend/app/services/ontology_generator.py`

- **LLMClient** prompts the model as a **knowledge-graph ontology designer** for **社交媒体舆论模拟**.
- Output is **strict JSON**: exactly **10 entity types** (8 domain-specific + **Person** + **Organization** as fallbacks), **6–10 edge types**, attributes — tuned so downstream agents are **posting/interacting subjects**, not abstract concepts.

This is **one** specialist “agent” in the orchestration sense (no multi-LLM debate here).

---

### 2. Graph build (Zep GraphRAG)

**File:** `backend/app/services/graph_builder.py`

- Creates a Zep **standalone graph**, **`set_ontology`**, splits text with **`TextProcessor.split_text`**, sends **batched episodes** (`EpisodeData`, `EntityEdgeSourceTarget`), waits for processing, polls graph stats.
- **Async** task via `TaskManager` + background thread.

**Multi-agent relevance:** The graph is the **shared world model** for all simulated users and for ReportAgent tools.

---

### 3. OASIS profiles (LLM + Zep enrichment)

**File:** `backend/app/services/oasis_profile_generator.py`

- Reads **Zep entities**, optionally **enriches** via Zep search, uses **LLM** to write rich **persona / bio** for each entity.
- Emits profiles in **Reddit** and **Twitter** shapes expected by **OASIS**.

So each graph node becomes one **social agent** with narrative identity.

---

### 4. Simulation config (LLM, staged)

**File:** `backend/app/services/simulation_config_generator.py`

- **Multi-step LLM generation**: time config (including **China circadian** activity multipliers), events, **batched agent activity configs** (activity level, posts/hour, stance, influence, etc.), platform parameters (recency/popularity weights, echo chamber, viral threshold).
- Grounded in **`ZepEntityReader`** so agent counts and roles match the graph.

---

### 5. Core swarm: OASIS dual-platform simulation

**Files:** `backend/app/services/simulation_runner.py`, `backend/scripts/run_parallel_simulation.py` (+ `run_twitter_simulation.py`, `run_reddit_simulation.py`)

- **SimulationRunner** **`subprocess.Popen`** runs Python scripts with `--config simulation_config.json` under `uploads/simulations/<id>/`.
- **`parallel`** mode runs **both** platforms; each writes **`twitter/actions.jsonl`** and **`reddit/actions.jsonl`**.
- Parent process **tails logs**, parses actions, exposes **live state** (`SimulationRunState`: per-platform rounds, simulated hours, recent actions).
- **OASIS** internally runs **many agents** taking turns / actions (post, like, comment, follow, etc.) — this is the **actual multi-agent swarm** (library-driven, not hand-rolled LangGraph).

---

### 6. Zep graph memory updater (simulation → graph)

**File:** `backend/app/services/zep_graph_memory_updater.py`

- **`ZepGraphMemoryManager`** converts each **`AgentActivity`** into **natural-language episode text** (e.g. “Alice: 发布了一条帖子：「…」”) and **feeds Zep** so **post-simulation** knowledge merges with **seed** knowledge.
- Runs on a **queue** / threading model (async ingestion).

**Effect:** The “digital world” **evolves** in the same graph the user queries later.

---

### 7. ReportAgent — ReACT + tools (post-hoc analyst agent)

**File:** `backend/app/services/report_agent.py`, **`zep_tools.py`**

- **Phase 1 — Planning:** LLM produces a **structured report outline** from simulation requirement + context.
- **Phase 2 — Per section:** **`_generate_section_react`**: iterative **thought → optional tool call → observation** (custom ReACT), capped by **`MAX_TOOL_CALLS_PER_SECTION`**, with **reflection** rounds (`MAX_REFLECTION_ROUNDS`).
- **Tools** (see `_define_tools` / `_execute_tool`):
  - **`insight_forge`** — multi-sub-query hybrid retrieval over Zep (`ZepToolsService.insight_forge`).
  - **`panorama_search`** — broad search including expired temporal content.
  - **`quick_search`** — fast graph search.
  - **`interview_agents`** — **calls into the running OASIS stack** to get **simulated agent interview answers** (dual platform), not just static retrieval.

So **one** “report agent” coordinates **retrieval** and **live swarm interrogation** — classic **tool-using LLM**, separate from the **thousands** of micro-agents in OASIS.

---

### 8. Frontend “interaction”

The UI supports **simulation monitoring** and (per README) **chat with any agent / ReportAgent** — implemented via API modules under `frontend/src/api/` and backend routes (`backend/app/api/`).

---

## Coordination summary

| Stage | Coordination style |
|-------|---------------------|
| Ontology + config | **Sequential LLM** calls with JSON contracts |
| Graph | **Zep** batch ingest + ontology |
| Swarm | **OASIS** environment — **many agents**, **turn-based / round-based** social actions, **two platforms in parallel processes** |
| Memory | **Async** Zep episode updates from action stream |
| Report | **Single** ReportAgent, **ReACT** over **Zep tools** + **interview** tool |

**Not** primarily a LangGraph/CrewAI-style DAG; the **dominant multi-agent physics** is **OASIS** + **optional Zep-synced narrative memory**.

---

## Domain layer

- **Public opinion / social media simulation** is the **default ontology framing** (README examples: university PR, *Dream of the Red Chamber*).
- **Finance / political** examples are listed as **coming soon** in English README — the **engine** is domain-agnostic given seed text + user prediction prompt.

---

## Comparison hooks (Sonde)

| Similar to | Unlike |
|------------|--------|
| **[ATLAS / atlas-gic](../atlas-gic/README.md)** — references MiroFish for swarm | ATLAS public repo uses **lightweight Claude simulation**; **this** repo is the **real OASIS + Zep** integration |
| **TradingAgents** — multi-agent | MiroFish is **social simulation + graph memory**, not portfolio graphs |
| **Denario** — LangGraph pipelines | MiroFish uses **OASIS subprocess** + **custom ReACT** report loop |

---

## Pins and references

- **Simulation engine:** [camel-ai/oasis](https://github.com/camel-ai/oasis) (acknowledged in README).  
- **Graph:** [Zep](https://www.getzep.com/) Cloud API.
