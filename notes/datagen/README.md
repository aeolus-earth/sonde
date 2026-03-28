# DATAGEN (starpig1129)

Upstream: [starpig1129/DATAGEN](https://github.com/starpig1129/DATAGEN)  
Local mirror: `repos/DATAGEN`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `31567439cc8f4fd5429c22286489aedca2da6658` |

---

## What it does (product)

**DATAGEN** is an **AI data-analysis and research pipeline** aimed at **tabular/file data** (e.g. CSV in `WORKING_DIRECTORY`). It runs a **fixed multi-stage workflow**: form a **hypothesis**, optionally **iterate with a human**, then a **supervisor agent** repeatedly chooses which **specialist agent** runs next (code, search, visualization, report), each pass goes through **quality review**, a **note-taking agent** consolidates **shared state**, and when the supervisor says **FINISH**, a **refiner** polishes materials on disk before a final **human review**.

**Warning (from upstream):** agents may **modify data**; backup inputs first.

**Invocation:** `python main.py` after setting `user_input` (path + natural-language goal). **`MultiAgentSystem`** builds **`WorkflowManager`**, then **`graph.stream(...)`** with a high **recursion_limit** (3000).

---

## How coordination works (deep)

### 1. Two layers: LangGraph supervisor + LangChain agents

| Layer | Technology | Responsibility |
|-------|------------|------------------|
| **Outer** | **LangGraph** `StateGraph` (`src/core/workflow.py`) | Fixed **topology**: which node runs next is **code + router functions**, not an LLM planner for the graph edges. |
| **Inner** | **LangChain** `create_agent` per specialist (`src/agents/base.py`) | Each node runs **one ReAct-style agent** with tools (and optional MCP), returns messages / **structured outputs** where configured. |

So “coordination” is **hybrid**: **graph routers** implement the research loop; **LLMs** implement reasoning **inside** each node.

### 2. Graph topology (simplified)

```
START → Hypothesis → HumanChoice ⇄ (loop) Hypothesis | Process
```

- **`HumanChoice`**: **Blocking CLI** (`input()`): regenerate hypothesis vs continue → sets `process` / messages (`human_choice_node`).

```
Process ──process_router──► Coder | Search | Visualization | Report | Process | Refiner
```

- **`process_router`** reads **`process_decision`** from state (set by **`process_agent`** structured output: next step **`Coder` / `Search` / `Visualization` / `Report`**, or **`FINISH`** → **`Refiner`**).

```
Visualization ──┐
Search          ├──► QualityReview ──► NoteTaker → Process
Coder           │
Report          ┘
```

- **`QualityReview_router`**: if **`needs_revision`** (from quality agent), route **back** to the **same specialist** inferred from the message list; else go **`NoteTaker`**.

```
NoteTaker → Process
Refiner → HumanReview → Process (if user wants more) | END
```

- **`HumanReview`**: CLI yes/no; can inject new human message and **`needs_revision`** to loop.

**`MemorySaver`** is constructed in `setup_workflow` but **`compile()`** is called **without** passing it—so **checkpointing may be ineffective** unless changed; streaming still works off ephemeral run state.

### 3. Shared state (`src/core/state.py`)

**LangGraph** `State` is a **`TypedDict`** with:

- **`messages`** — `add_messages` reducer (conversation log).
- **Domain fields** — `hypothesis`, `process`, **`process_decision`** (supervisor’s next step), per-agent string states (`visualization_state`, `searcher_state`, …), **`quality_review`**, **`needs_revision`**, **`sender`**.

**`agent_node`** copies each agent’s last output into both **`messages`** and the **typed state keys** so routers and the next agent see structured progress without re-parsing free text.

### 4. Supervisor semantics (`process_agent`)

The **process agent** is the **orchestrator**: its prompt (`config/agents/process_agent/AGENT.md`) describes academic report structure and tells it to output **`FINISH`** only when criteria are met. The implementation expects **structured output** (`structured_response` with **`task`** and **`next`** / `process_decision`) so **`process_router`** can branch **deterministically**.

This is **closer to TradingAgents** (explicit next-step routing from state) than to **Deep Agents** (delegation via a `task` tool inside one agent).

### 5. Note agent (`note_agent`)

**`note_agent_node`** is special: it may **trim** the middle of `messages` for context control, invokes the note agent, then **rebuilds** structured **`State`** from **`structured_response`** (hypothesis, process, all substates, flags). It acts as a **state compressor / secretary** between quality review and the next **`Process`** turn.

### 6. Human-in-the-loop

- After hypothesis: **regenerate vs continue**.
- After refiner: **continue analysis vs end** (optional revision request).

No headless API mode in `main.py`—**stdin** is assumed.

---

## Tools (stack)

### Python dependencies (`requirements.txt`)

- **LangChain** 1.x family: `langchain`, `langchain-core`, `langchain-community`, provider packages (**openai**, **anthropic**, **google-genai**, **ollama**, **groq**).
- **LangGraph** 1.x.
- **Data / web:** `pandas`, `arxiv`, `beautifulsoup4`, `wikipedia`, `selenium`, `firecrawl-py`, `openai`.
- **MCP:** `mcp>=1.0.0`.
- **Env:** `python-dotenv`.

Per-agent **models** come from **`config/agent_models.yaml`** (provider + `model_config`).

### Built-in tool registry (`src/tools/factory.py`)

| Name | Role (typical) |
|------|------------------|
| `execute_code` | Run analysis code in controlled environment |
| `execute_command` | Shell |
| `list_directory` | List files |
| `create_document`, `read_document`, `edit_document` | File/report ops |
| `collect_data` | Data ingestion helper |
| `google_search`, `scrape_webpages` | Web |
| `wikipedia` | Wikipedia API |
| `arxiv` | Paper search |

**Security / limits:** `config/tool_limits.yaml`, `src/tools/security.py`, validators.

### MCP (`config/mcp.yaml` + `src/core/mcp_manager.py`)

Declared servers (via **npx**):

- **filesystem** — `@modelcontextprotocol/server-filesystem` on **`WORKING_DIRECTORY`**.
- **web-search** — `@anthropic/mcp-server-web-search` (+ `TAVILY_API_KEY`).
- **github** — `@modelcontextprotocol/server-github` (+ token).

Per-agent **`config.yaml`** lists which **`mcp_servers`** and **`tools`** to attach. **Process agent** can start with **empty** `tools:` and rely on prompts + routing only—specialists carry the heavy tools.

### Skills

**Progressive disclosure** pattern: optional **`skills`** in agent config + **`LookupSkill`** tool when skills exist (`src/tools/skills.py`). See `docs/SKILL_CONFIG.md`.

---

## Domain / model layer

- **Input:** user text with **`datapath:File.csv`** and analysis instructions; data under configurable **`WORKING_DIRECTORY`**.
- **Output:** markdown/PNG artifacts in working dir, consolidated report narrative, refiner pass over collected materials.

---

## Comparison hooks

| | |
|---|---|
| **Similar to** | **LangGraph** pipelines with **role-specific nodes** (cf. TradingAgents finance graph); **YAML-driven** agent prompts and tool lists. |
| **Unlike** | **Deep Agents** (middleware harness + `task` subagents); **autoresearch** (no graph, external IDE only). |
| **Coordination style** | **Explicit graph + structured supervisor field** (`process_decision`) vs pure LLM-delegated subagents. |
