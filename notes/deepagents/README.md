# deepagents (LangChain)

Upstream: [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)  
Local mirror: `repos/deepagents` (monorepo; core package: `libs/deepagents/`)

## Pins

| | |
|---|---|
| **Commit (this clone)** | `a32ce7ff6b2112cf48170d2279a1953eded61987` |
| **Package version** (`libs/deepagents/pyproject.toml`) | `0.5.0a2` |

---

## What it is (one paragraph)

**Deep Agents** is a **batteries-included agent harness**: a thin product layer on top of **LangChain’s `create_agent()`** and **LangGraph’s compiled graph runtime**. You do not hand-wire prompts and tools from scratch; `create_deep_agent()` injects a **fixed middleware stack** that adds planning (`write_todos`), a **virtual filesystem** (`read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep`), optional **shell** (`execute` when the backend supports sandboxing), **sub-agents** (`task`), **automatic conversation summarization**, and optional **skills** (SKILL.md trees) and **memory** (AGENTS.md injection). The return value is a **`CompiledStateGraph`**—so you get streaming, checkpointing, LangSmith, and the rest of the LangGraph ecosystem.

---

## Architecture (how execution is structured)

### 1. Entry point: `create_deep_agent`

Defined in `libs/deepagents/deepagents/graph.py`. It does **not** implement a custom ReAct loop by hand. It:

1. **Resolves the chat model** — default is **`ChatAnthropic`** with **`claude-sonnet-4-6`**; strings like `"openai:gpt-4o"` go through `resolve_model()`.
2. **Chooses a backend** — default **`StateBackend`** (ephemeral state keyed by the graph runtime—files live in agent state, not necessarily on disk).
3. **Builds middleware lists** for:
   - the **main** agent, and
   - each **inline subagent** (including the auto-added **general-purpose** subagent).
4. Calls **`langchain.agents.create_agent(...)`** with `system_prompt` = your prompt **concatenated** with a large **`BASE_AGENT_PROMPT`** (behavior: concise, no filler, verify work, long-running tasks get progress updates).
5. Returns **`.with_config({ recursion_limit: 10000, metadata: ... })`** — a **compiled LangGraph** ready for `.invoke()`, streaming, etc.

So the **orchestration engine** is **LangGraph + LangChain agent middleware**, not a bespoke scheduler.

### 2. Middleware = where “deep” behavior lives

LangChain **middleware** wraps the model request/response cycle: it can **inject tools**, **alter messages**, **trim or summarize history**, and **run logic before/after tool calls**. Deep Agents stacks middleware in a deliberate order (main agent, simplified):

| Order (conceptual) | Middleware | Role |
|--------------------|------------|------|
| 1 | `TodoListMiddleware` | Exposes **`write_todos`** — structured task list in state (planning / progress). |
| 2 | `SkillsMiddleware` (optional) | Loads **SKILL.md** skills from backend paths; **progressive disclosure** into the prompt. |
| 3 | `FilesystemMiddleware` | Virtual FS tools backed by **`BackendProtocol`**: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`; large reads truncate with guidance. |
| 4 | `SubAgentMiddleware` | Exposes **`task`** — spawn **child agents** (see below). |
| 5 | Summarization (factory `create_summarization_middleware`) | When context exceeds thresholds, **summarizes older turns** and can **offload** full history to backend storage (e.g. under `/conversation_history/...`). |
| 6 | `PatchToolCallsMiddleware` | Repairs / normalizes tool calls (robustness). |
| 7 | `AsyncSubAgentMiddleware` (optional) | **Remote/async** subagents (e.g. LangSmith deployments) — launch, poll, cancel. |
| 8 | User `middleware=` | Your hooks. |
| 9 | `AnthropicPromptCachingMiddleware` | Prompt caching for Anthropic (ignored on unsupported models). |
| 10 | `MemoryMiddleware` (optional) | Injects **AGENTS.md** content from configured paths into the system prompt. |
| 11 | `HumanInTheLoopMiddleware` (optional) | **`interrupt_on`** — pause before dangerous tools (e.g. `edit_file`). |

**Filesystem + execution:** Tools talk to a **backend** (`StateBackend`, `FilesystemBackend`, `CompositeBackend`, **`LocalShellBackend`** for `execute`, partner sandboxes like Modal/Daytona/Runloop). The backend abstraction keeps the same tool surface whether storage is in-memory, local disk, or remote sandbox.

### 3. Sub-agents: how delegation works

The **`task`** tool is the multi-agent mechanism:

- **Synchronous specs (`SubAgent`)** — name, description, system_prompt; optional tools/model/middleware/skills. Each is compiled to an inner **`create_agent()`** with its own middleware stack (todos + filesystem + summarization + …).
- **`CompiledSubAgent`** — you pass a pre-built **`Runnable`** (any LangGraph/LangChain graph with a **`messages`** channel); final message is lifted back to the parent as a **`ToolMessage`**.
- **`AsyncSubAgent`** — **`graph_id`**, optional **`url`/`headers`** — background/remote runs via **`AsyncSubAgentMiddleware`**.

**Semantics (important):**

- Subagents are **ephemeral**: the parent sends **one** detailed instruction; the child runs to completion and returns **one** synthesized result (intermediate reasoning is **not** merged into the parent transcript—by design, to save context).
- **State isolation:** Keys like `todos`, parent skills/memory are **filtered** so subagents don’t inherit the parent’s full private state (see `_EXCLUDED_STATE_KEYS` in `subagents.py`).
- A **default `general-purpose`** subagent is **always added** unless you override the name—same capabilities as the main agent for delegated heavy work.

The **task tool description** (in code) explicitly encourages **parallel** `task` calls when subtasks are independent—so coordination is **orchestrator-driven**, LLM-planned, not a fixed DAG like TradingAgents’ LangGraph node graph.

### 4. Context management (how memory stays bounded)

Several layers work together:

1. **Summarization middleware** — Triggers on token pressure; older messages are **summarized** by an LLM and full text can be **written to the backend** (append-only conversation history files). Optional **`compact_conversation`** tool for explicit compaction.
2. **Filesystem tools** — Large tool outputs can be **written to files** so the model reads slices instead of stuffing megabytes into the chat.
3. **`MemoryMiddleware`** — Loads **`AGENTS.md`** files (paths you configure) **at startup** into the system prompt—**persistent project memory**, distinct from skills (on-demand).
4. **`SkillsMiddleware`** — Loads **SKILL.md** directories with YAML frontmatter; **layered sources** (user vs project) with later overrides.

5. **LangGraph `checkpointer` / `store`** — Optional args to `create_deep_agent` for **thread persistence** and **long-term store** (needed for some backend patterns).

### 5. CLI and monorepo (scope)

The repo also ships **`libs/cli`** (terminal coding agent), **partner packages** (sandboxes), and **evals**—the **library surface** for embedding is **`from deepagents import create_deep_agent`** in `libs/deepagents`.

---

## Tools (dependency / stack summary)

| Layer | Technologies |
|-------|----------------|
| **Runtime** | Python **≥3.11** |
| **Core deps** | `langchain`, `langchain-core`, `langchain-anthropic`, `langchain-google-genai`, `langsmith`, `wcmatch` (glob semantics) |
| **Graph** | **LangGraph** (`CompiledStateGraph`, checkpointer, store, cache) |
| **Agent API** | **LangChain** `create_agent` + **middleware** (`TodoListMiddleware` from LC, custom deepagents middleware) |
| **Optional integrations** | MCP via **`langchain-mcp-adapters`** (mentioned in README); remote sandboxes in separate partner libs |

---

## Multi-agent coordination (summary)

| Mechanism | Pattern |
|-----------|---------|
| **Primary** | **Single main agent** + **`task`** tool spawning **ephemeral** sub-agents with **isolated** context and **single** return message. |
| **Parallelism** | Encouraged in **prompt/tool text**: multiple `task` or tool calls in one turn when independent. |
| **Async/remote** | **`AsyncSubAgent`** + middleware for non-blocking or **LangSmith**-hosted graphs. |
| **Human** | **`interrupt_on`** + **`HumanInTheLoopMiddleware`** for approval gates on specific tools. |

**Compared to TradingAgents:** TradingAgents encodes **roles and edges** explicitly in **`StateGraph.add_node` / `add_edge`**. Deep Agents encodes **capabilities** in **middleware + tools**; the **LLM** decides when to call **`task`** and how to split work—closer to **flexible orchestration** than a fixed pipeline.

**Compared to autoresearch:** Deep Agents is **fully programmatic** (Python API, LangGraph); autoresearch is **markdown + external IDE agent** with no in-repo runtime.

---

## Security (from upstream README)

**“Trust the LLM”** — boundaries must be enforced by **sandbox / tool policy / HIL**, not by hoping the model refuses harmful actions.

---

## Domain / model layer

**General-purpose** — not tied to NWP or finance. The default “domain” is **code/research/filesystem** style tasks; you supply **`tools`**, **`system_prompt`**, and backends for your problem.

---

## Comparison hooks

| | |
|---|---|
| **Convergence** | **LangGraph-native** harness, **middleware-first** customization, **tool-based** subagents, **provider-agnostic** models. |
| **Contrast** | Fixed DAG (TradingAgents) vs **LLM-planned delegation** (Deep Agents `task`). |
