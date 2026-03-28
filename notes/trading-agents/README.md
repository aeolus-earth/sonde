# TradingAgents (Tauric Research)

Upstream: [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)  
Local mirror: `repos/TradingAgents`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `589b351f2ab55a8a37d846848479cebc810a5a36` |
| **Release tag (in repo)** | `v0.2.2` (see `pyproject.toml` version `0.2.2`) |

Refresh: `cd repos/TradingAgents && git fetch && git pull`

---

## Tools

**Runtime / packaging**

- **Python** `>=3.10`; package layout via **setuptools** (`pyproject.toml`).
- **Entry points:** `tradingagents` → `cli.main:app` (**Typer** CLI); alternative `python -m cli.main`.
- **CLI UX:** **Rich** (console, markdown, tables, spinners), **Questionary** (interactive prompts).
- **Env:** `.env` supported (e.g. `load_dotenv` in `cli/main.py`); keys documented in README (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `ALPHA_VANTAGE_API_KEY`).

**LLM layer**

- **Abstraction:** `tradingagents/llm_clients/` — `create_llm_client(provider, ...)` → **OpenAI**-compatible path (OpenAI, Ollama, OpenRouter, xAI), **Anthropic**, **Google GenAI**.
- **Implementation:** Thin wrappers around **LangChain** chat models: `langchain-openai`, `langchain-anthropic`, `langchain-google-genai`.
- **Callbacks:** LangChain `BaseCallbackHandler` (e.g. `cli/stats_handler.py` for LLM/tool stats).

**Orchestration / agents**

- **LangGraph** (`>=0.4.8`): `StateGraph`, `START`/`END`, `langgraph.prebuilt.ToolNode` for tool execution loops.
- **LangChain Core:** `langchain-core` — messages, `@tool` decorators, prompts (`ChatPromptTemplate`, `MessagesPlaceholder`), `RemoveMessage` for “msg clear” nodes.

**Data / finance**

- **yfinance**, **pandas**, **requests** — market and news pulls.
- **stockstats** — technical indicators (wrapped in `dataflows/`).
- **Alpha Vantage** — optional vendor paths under `dataflows/alpha_vantage*.py`; configurable via `default_config` `data_vendors` / `tool_vendors`.
- **rank-bm25** — lexical retrieval for `FinancialSituationMemory` (no embedding API).

**Declared in `pyproject.toml` but not imported in first-party `.py` (as of this pin)**

- **backtrader**, **redis**, **langchain-experimental**, **parsel** — present as dependencies; no `import backtrader` / `import redis` / etc. found in the Python sources. Treat as **unused by app code here**, possibly reserved or transitive—re-verify after upgrades.

**Other**

- **pytz**, **tqdm**, **typing-extensions**.

---

## Multi-agent coordination

**Framework:** **LangGraph** compiled graph (`GraphSetup.setup_graph` → `workflow.compile()`).

**Shared state:** `AgentState` extends LangGraph **`MessagesState`** plus typed fields (company, date, analyst reports, `investment_debate_state`, `risk_debate_state`, decisions). See `tradingagents/agents/utils/agent_states.py`.

**Roles (nodes)**

1. **Analysts (sequential chain):** Market, Social, News, Fundamentals — user-selectable subset; order follows `selected_analysts`. Each analyst: **LLM ↔ tools loop** via `add_conditional_edges` + `should_continue_*` (if last message has `tool_calls` → `tools_*` → back to analyst; else → “Msg Clear *” → next analyst).
2. **Research:** Bull Researcher ↔ Bear Researcher **debate** with round caps (`ConditionalLogic.should_continue_debate`, `max_debate_rounds`).
3. **Research Manager:** “Judge” using **deep** LLM + `invest_judge_memory` (BM25-backed).
4. **Trader:** consumes prior outputs; **quick** LLM + `trader_memory`.
5. **Risk team:** Aggressive → Conservative → Neutral **cycle** with conditional exit to Portfolio Manager (`should_continue_risk_analysis`, `max_risk_discuss_rounds`).
6. **Portfolio Manager:** final node → `END`.

**Patterns**

- **Two LLM tiers:** “quick” vs “deep” models from config (`quick_think_llm`, `deep_think_llm`).
- **Tool calling:** LangChain tools + **ToolNode** per analyst channel (market/social/news/fundamentals).
- **Memory:** Per-role **BM25** memory (`FinancialSituationMemory`), not vector DB.
- **Control flow:** Mostly **fixed graph topology** with **conditional** tool loops and **debate round** counters—not a free-form planner.

**Unlike** typical NWP stacks: no simulator API here—the “domain” is **market data APIs + LLM reasoning**, with optional downstream simulation implied by README (research framework; not a production exchange).

---

## Domain / model layer (application domain)

This repo is **not** a weather model. Domain concepts:

- **Ticker / date** driven workflow; outputs are reports and a **final trade decision** string pipeline.
- **Data:** OHLCV, indicators, fundamentals, news — via yfinance/Alpha Vantage abstractions.

For **comparison to NWP work**: the relevant transferable ideas are **LangGraph structure**, **tool-attachment per role**, **dual LLM budgets**, and **structured debate state**—not the finance semantics.

---

## Comparison hooks

| | |
|---|---|
| **Similar to** | Other **LangGraph + LangChain tools** stacks: explicit graph, ToolNode, message-thread state. |
| **Unlike** | **HPC / Julia / GPU** model codes (e.g. Breeze): no PDE solver; orchestration is entirely LLM-centric. |
| **Convergence signal** | Heavy use of **LangGraph** as the coordination layer; **provider-agnostic** LLM factory; **CLI** as the primary human interface. |
