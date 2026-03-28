# AutoResearchClaw (aiming-lab)

Upstream: [aiming-lab/AutoResearchClaw](https://github.com/aiming-lab/AutoResearchClaw)  
Local mirror: `repos/AutoResearchClaw`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `01c4df9f37b633720fb0ab87a34fd370c1bdfdf2` |
| **Package** (`pyproject.toml`) | `researchclaw` v0.3.1 |

---

## What it does

**AutoResearchClaw** is a **standalone Python product** that runs a **23-stage autonomous research pipeline**: from a **natural-language topic** to **conference-style deliverables** (Markdown draft, LaTeX, BibTeX, verified citations, experiment artifacts, charts, peer-review notes) under an **`artifacts/rc-…/deliverables/`** layout.

Marketing pitch: **“Chat an idea → get a paper”** — with **OpenClaw** integration so the same pipeline can be triggered from **Discord, Telegram, Lark, WeChat**, or **ACP-compatible** coding agents (Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Kimi CLI).

**Design goals (from README):** real literature (OpenAlex, Semantic Scholar, arXiv), **hardware-aware** experiments (GPU/MPS/CPU), **anti-fabrication** (VerifiedRegistry, citation verification), **pivot/refine** when results fail hypotheses, **multi-agent debate** for hypotheses/reviews, optional **MetaClaw** cross-run learning (failures → skills injected into stages).

---

## How it works (architecture)

### 1. Orchestration model: **explicit 23-stage state machine** (not LangGraph)

Stages are defined in `researchclaw/pipeline/stages.py` as `Stage` **IntEnum** `1…23` with:

- **Phases A–H:** scoping → literature → synthesis/hypotheses → experiment design/code → run/refine → analysis/**research decision** → paper outline/draft/review/revision → quality gate → archive → export → **citation verify**
- **Gates** (`GATE_STAGES`): e.g. literature screen, experiment design, quality gate — can **block** until approval (`--auto-approve` bypasses for unattended runs)
- **Rollback maps:** gate rejection jumps back to a **prior** stage; **Stage 15** (`RESEARCH_DECISION`) supports **PIVOT** / **REFINE** with caps (`DECISION_ROLLBACK`, `MAX_DECISION_PIVOTS`)

The **runner** (`researchclaw/pipeline/runner.py`) walks **`STAGE_SEQUENCE`**, calls **`execute_stage`** (`executor.py`), writes **checkpoints** and **heartbeats** for **`--resume`**.

This is **closer to a CI/CD pipeline** than to a single ReAct agent or a LangGraph “one graph to rule them all.”

### 2. Stage implementation

Each stage has **contracts** (`pipeline/contracts.py`) and implementations split across **`pipeline/stage_impls/`** (e.g. `_literature.py`, `_experiment_design.py`, `_code_generation.py`, `_paper_writing.py`). The executor wires **LLM calls** (via `researchclaw.llm`), **prompts** (`PromptManager`), **hardware** detection, **sandbox** execution, and **adapters** (`AdapterBundle`).

### 3. Multi-agent **subsystems** (inside select stages)

Not a global LangGraph of 8 equal agents (à la DATAGEN). Instead **specialized agents** invoked where needed:

- **CodeAgent** — iterative code generation + sandbox runs (`pipeline/code_agent.py`, used from stage 10 with fallbacks)
- **BenchmarkAgent** — dataset/baseline selection for **ML** domains (skipped for non-ML) — stage 9 context
- **FigureAgent** — figure planning/charts feeding paper stages

**“Beast mode”** can route heavy codegen to **OpenCode** (`opencode` CLI) with complexity scoring and fallback.

### 4. Integrations

- **OpenClaw** — service bridge: trigger runs from chat apps / external agents
- **MetaClaw** — optional: past failures → **skills** merged into prompts across stages
- **MCP** — `researchclaw/mcp/client.py` for **stdio/SSE** MCP servers (extensibility; not the core loop’s only tool path)

### 5. Quality / safety layers

- **Sentinel** watchdog (NaN/Inf, evidence consistency, citation relevance)
- **VerifiedRegistry** + experiment **diagnosis/repair** loops (anti-fabrication)
- **Docker/sandbox** execution paths (see tests and config)
- **Citation verification** as final stage (23)

---

## Tools and dependencies

### Core (`pyproject.toml`)

Minimal **hard** deps: `pyyaml`, `rich`, `arxiv`, `numpy`.  
**Optional extras:** `anthropic` (httpx), **`web`** (scholarly, crawl4ai, tavily), **`pdf`** (PyMuPDF), **`all`** adds HF hub, matplotlib, scipy, etc.

The full experience assumes **many more** packages installed for literature crawl, plotting, LaTeX toolchain, Docker, etc. (see README conda/venv and `researchclaw setup`).

### Capabilities (by subsystem)

| Area | Mechanism |
|------|-----------|
| **Literature** | OpenAlex / Semantic Scholar / arXiv flows in web + scholar modules (`researchclaw/web/`, `web/scholar.py`) |
| **Web** | Crawling, search, PDF extraction (optional extras; SSRF guards in `web/_ssrf.py`) |
| **Experiments** | Generated Python in **sandbox**; hardware profile; torch detection |
| **Paper** | Templates NeurIPS/ICML/ICLR (`researchclaw/templates/`), LaTeX compile path |
| **Voice** | Optional voice module (`researchclaw/voice/`) |
| **Trends** | Topic feeds / digest (`researchclaw/trends/`) |

**CLI:** `researchclaw` entry point → `researchclaw.cli:main`.

---

## How it differs from other repos in this workspace

| Repo | Contrast |
|------|----------|
| **DATAGEN** | DATAGEN: **LangGraph** with ~8 specialist agents + **process supervisor** field. AutoResearchClaw: **23 numbered stages**, richer **gates**, **pivot/refine**, **citation/export** pipeline — **productized research OS**, not “one graph file.” |
| **AI-Scientist-v2** | AIS2: **best-first tree search** over ML code + AIDE-style journals. ARC: **linear stage machine** with **branching only** at gates and **stage 15** decision — not tree-search-centric. |
| **Deep Agents** | Deep Agents: **LangChain middleware harness** (`create_deep_agent`). ARC: **application** with its own executor and stage contracts — you don’t embed ARC as a library the same way. |
| **TradingAgents** | TradingAgents: **LangGraph** finance DAG. ARC: **research paper** pipeline, **stages** not trader/risk roles. |
| **autoresearch (karpathy)** | autoresearch: **no code** orchestrator — **program.md** + external IDE. ARC: **full in-repo** automation, **CLI**, checkpoints, **resume**. |

**Summary:** AutoResearchClaw is the **most “production pipeline”** of the set: **longest stage list**, **explicit quality gates**, **OpenClaw/MetaClaw/ACP** ecosystem, and **heavy emphasis on verified citations and deliverables** — versus **tree-search science** (AIS2), **graph-of-agents data analysis** (DATAGEN), or **minimal harness** (Deep Agents / autoresearch).
