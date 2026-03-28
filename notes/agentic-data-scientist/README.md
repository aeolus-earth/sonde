# agentic-data-scientist (K-Dense AI)

Upstream: [K-Dense-AI/agentic-data-scientist](https://github.com/K-Dense-AI/agentic-data-scientist)  
Local mirror: `repos/agentic-data-scientist`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `3ce58ef0c2276565aee2648d28b494c72cbd9f0d` |
| **Package** (`pyproject.toml`) | `agentic-data-scientist` **0.2.2** |
| **Python** | `>=3.12,<3.13` |

Refresh: `cd repos/agentic-data-scientist && git fetch && git pull`

---

## What it does

**Agentic Data Scientist** is a **multi-phase data-science workflow** that **separates planning from execution**, runs **iterative review loops** at both plan and implementation levels, and **tracks success criteria** across stages with **adaptive replanning** (stage reflection). It targets **complex analyses** (CLI: `--mode orchestrated`) vs **quick coding / Q&A** (`--mode simple`).

**Marketing framing:** “Adaptive multi-agent workflow” with **continuous validation** and **self-correction**.

**Prerequisites (upstream):** **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code`), **OpenRouter** key for planning/review agents (via LiteLLM), **Anthropic** key for the coding path (Claude Agent SDK).

---

## Dependencies (tools in the software sense)

| Package | Role |
|---------|------|
| **`google-adk`** (pinned **1.18.0**) | **Google Agent Development Kit** — `SequentialAgent`, `LoopAgent`, `LlmAgent`-style agents, `InvocationContext`, `Event`, `App`, `Runner`, sessions. |
| **`google-genai`** | Gemini types (`ThinkingConfig`, `Content`, `Part`), planner config. |
| **`claude-agent-sdk`** | **`ClaudeAgentOptions`**, **`query()`** stream — powers **`ClaudeCodeAgent`**. |
| **`litellm`** (via ADK) | **`LiteLlm`** wrapper — routes **`DEFAULT_MODEL`** / **`REVIEW_MODEL`** through **OpenRouter** (`OPENROUTER_API_KEY`, `OPENROUTER_API_BASE`). |
| **`mcp`** | Protocol dependency; ADK MCP integration; Claude options can register **HTTP MCP servers**. |
| **`click`**, **`python-dotenv`**, **`pyyaml`**, **`jinja2`**, **`aiofiles`**, **`requests`** | CLI, env, prompts, async file ops, HTTP. |

**Default model names** (env-overridable in `agents/adk/utils.py`):

- `DEFAULT_MODEL` / `REVIEW_MODEL`: `google/gemini-2.5-pro` (OpenRouter)
- `CODING_MODEL`: naming for Claude; implementation uses **`ClaudeCodeAgent`** with Anthropic.

---

## Multi-agent workflow (how it is wired)

### 1. Root: `SequentialAgent` (one pipeline, four blocks)

```text
agentic_data_scientist_workflow
├── high_level_planning_loop
├── high_level_plan_parser
├── stage_orchestrator
└── summary_agent
```

Defined in `src/agentic_data_scientist/agents/adk/agent.py` (`create_agent`).

### 2. Planning phase — `NonEscalatingLoopAgent` (max **10** iterations)

Sub-agents:

1. **`plan_maker_agent`** — `LoopDetectionAgent`, `output_key="high_level_plan"` — “what needs to be done?”
2. **`plan_reviewer_agent`** — `output_key="plan_review_feedback"` — “is the plan complete?”
3. **`Review confirmation`** — `create_review_confirmation_agent(..., prompt_name="plan_review_confirmation")` — **structured** exit decision; uses **escalate** to break the loop when the plan is approved (`review_confirmation.py`).

**NonEscalatingLoopAgent** strips **escalate** so inner loops don’t abort the whole app (subclass in `agent.py`).

### 3. Plan parser — single agent, **structured output**

- **`high_level_plan_parser`** — **no tools**; **`output_schema=PlanParserOutput`** (Pydantic: `stages`, `success_criteria`).
- **`plan_parser_callback`** writes **`high_level_stages`** and **`high_level_success_criteria`** into **session state** with tracking fields (`completed`, `met`, `evidence`, etc.).

### 4. Execution phase — `StageOrchestratorAgent` (custom `BaseAgent`)

`src/agentic_data_scientist/agents/adk/stage_orchestrator.py`:

- Reads **`high_level_stages`** and **`high_level_success_criteria`** from state.
- **Loop until** all success criteria are **met** (or error/empty stages):
  1. **`implementation_loop`** — run current stage.
  2. **`success_criteria_checker`** — structured `CriteriaCheckerOutput` → **`criteria_checker_callback`** updates `met` + **`evidence`** per criterion.
  3. **`stage_reflector`** — structured `StageReflectorOutput` → **`stage_reflector_callback`** can **rewrite** unfinished stage descriptions or **append** new stages.

So “multi-agent” here is **orchestrator + three sub-agents** (implement → check → reflect) repeated per **macro-iteration**, not a separate graph per stage title.

### 5. Implementation loop — `NonEscalatingLoopAgent` (max **5** iterations per stage)

Sub-agents (`implementation_loop.py`):

1. **`ClaudeCodeAgent`** — **Claude Agent SDK** `query()`; **not** ADK Gemini. Implements the stage; **`output_key="implementation_summary"`**; **event compression** callback after runs.
2. **`review_agent`** — ADK `LoopDetectionAgent`, **`REVIEW_MODEL`**, `output_key="review_feedback"` — code review prompt (`coding_review`).
3. **`Review confirmation`** — structured `exit` / `reason`; **escalates** to exit implementation loop when review passes.

**Coding path details:** `agents/claude_code/agent.py` sets **`ClaudeAgentOptions`**: `cwd=working_dir`, **`permission_mode="bypassPermissions"`**, **`system_prompt`** preset `claude_code` + appended instructions, **`setting_sources`** for project/user/local, **`disallowed_tools`** `WebFetch`/`WebSearch` when `DISABLE_NETWORK_ACCESS` is set; **`mcp_servers`** includes **Context7** HTTP MCP (`https://mcp.context7.com/mcp`). On setup, **clones** [claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills) into **`.claude/skills/`** under the working directory.

### 6. Summary phase

- **`summary_agent`** — reads final artifacts with **tools**, produces a consolidated text report (`prompts/base/summary.md`).

---

## Built-in tools (ADK planning/review agents)

Bound to **`working_dir`** in `create_agent` (`tools/file_ops.py`, `web_ops.py`):

- **File (read-only):** `read_file`, `read_media_file`, `list_directory`, `directory_tree`, `search_files`, `get_file_info`
- **Web:** `fetch_url` — unless **`DISABLE_NETWORK_ACCESS`** is true

The **coding agent** does **not** use this same tool list for ADK — it delegates to **Claude Code**, which has full tool access **within** Claude Code’s model (plus skills, MCP as configured).

---

## Validation and quality mechanisms

| Mechanism | Where |
|-----------|--------|
| **Plan review loop** | Plan maker ↔ reviewer ↔ confirmation — human-in-the-loop style **iteration** before parsing. |
| **Structured plan** | Pydantic **`PlanParserOutput`** — stages + criteria list materialized in state. |
| **Per-stage implementation loop** | Coding ↔ review ↔ confirmation — **max 5** rounds; confirmation **escalates** to exit. |
| **Success criteria checker** | **`CriteriaCheckerOutput`** — per-criterion `met` + **`evidence`** (file paths, metrics); **callback** updates state. |
| **Stage reflector** | **`StageReflectorOutput`** — optional **stage_modifications** and **new_stages**; **callback** mutates state. |
| **Loop detection** | **`LoopDetectionAgent`** — monitors for repetitive/stuck output (extends ADK behavior). |
| **Event compression** | After-agent callbacks **summarize** old events when count exceeds threshold (~40), **truncate** large text (>10KB); **manual** compression at orchestration points. |
| **Exit loop** | Review confirmation sets **`event_actions.escalate`** to break **`LoopAgent`** without failing the whole run (`NonEscalatingLoopAgent` swallows escalate for nested loops where appropriate). |

**Note:** “Validation” is largely **LLM-judged** (reviewer, criteria checker, reflector) plus **filesystem evidence** in criteria updates — not a separate formal theorem prover or statistical test harness.

---

## Execution modes (CLI / API)

- **`--mode orchestrated`** — Full ADK workflow above (`cli/main.py` → `create_app` / `Runner`).
- **`--mode simple`** — Direct **Claude Code**-style task without full planning pipeline (see `core/api.py` and CLI for branching).
- **`DataScientist`** class — `agent_type`: **`"adk"`** vs **`"claude_code"`**; optional **`mcp_servers`** in config (factory accepts; ADK root `create_agent` currently focuses on **local tools** + Claude path).

---

## Domain

**General data science** — prompts under `prompts/base/`; optional **bioinformatics** domain prompts (`prompts/domain/bioinformatics/`). Not atmospheric NWP; skills repo emphasizes **scientific** tooling (bio, chem, stats packages per upstream README).

---

## How this compares to other Sonde notes

| | |
|---|---|
| **Similar to** | **AutoResearchClaw**-style **stages + criteria + reflection** — but **much smaller** surface (data-science tasks, not 23-stage paper pipeline). |
| **Similar to** | **deepagents** — **planning + filesystem + sub-loops**, but here **planning/review** use **ADK+OpenRouter** and **coding** uses **Claude Code SDK** (two runtimes). |
| **Unlike** | **TradingAgents** — not a single LangGraph `StateGraph`; uses **ADK `SequentialAgent` / `LoopAgent`**. |
| **Unlike** | **AI-Scientist-v2** — no **BFTS journal** over training code; focus is **staged DS implementation** with **criteria checklist**. |

---

## References (upstream)

- [Google ADK docs](https://google.github.io/adk-docs/)
- [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk)
- [Claude Scientific Skills](https://github.com/K-Dense-AI/claude-scientific-skills)
