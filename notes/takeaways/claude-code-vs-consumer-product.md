# Claude Code Harness vs. Consumer-Facing Product

## The distinction

There are two different surfaces where an AI agent can operate in the Aeolus stack, and they're good at different things:

**Claude Code / agent harness** — a developer- or scientist-facing CLI environment with persistent instructions (AGENTS.md / CLAUDE.md), custom tools, hooks that fire on events, skills for common operations, and the ability to be scripted, scheduled, and composed into pipelines. The output is structured and repeatable. The user is technical.

**Consumer-facing product** — a chat interface (web app, Slack bot, API endpoint) where a non-technical or semi-technical user asks questions and gets back natural language answers, plots, and summaries. The interaction is conversational and exploratory. The output is polished for reading, not for piping into the next step.

These aren't competing — they serve different parts of the workflow and different users. The question is which parts of the Aeolus data analysis stack belong where.

## Where the Claude Code harness wins

The harness is the right choice when the workflow is **repeatable, needs structured output, or needs to be composed with other tooling.** Specific cases:

### Post-simulation verification

After every cloud job completes, a verification workflow should run the same checks every time: CFL condition satisfied, conservation laws hold, no NaN/Inf in output fields, surge values within physically plausible bounds, RMSE against reference data if available. This is a scripted workflow with pass/fail output, not a conversation. The harness can:

- Be triggered by a webhook or cron when a job completes
- Read the run configuration and STAC metadata
- Execute a deterministic sequence of checks via tools
- Write structured results (JSON, markdown report, or directly to a run log)
- Fail loudly if something is wrong

This is CI/CD for simulations. It doesn't need a chat interface. It needs AGENTS.md instructions that say "when verifying a Flood.jl run, always check these 8 conditions" and tools that compute each one.

### Nightly or scheduled analysis reports

"Every morning at 6am, pull yesterday's ERCOT wind forecast runs, compare to GFS analysis, compute skill scores over CONUS, generate a summary report with maps." This is a cron job, not a conversation. The harness runs the same workflow daily with different dates. The output is a markdown report or a set of figures — structured, predictable, diffable over time.

### Batch operations across many runs

"Compare all 24 runs from the resolution sensitivity study, compute RMSE for each, rank them, produce a summary table." This is a loop over runs with consistent processing per run. The harness is good at this because:

- AGENTS.md can encode what "compare a run to observations" means for this project
- Skills (slash commands) can wrap common multi-step operations into single invocations
- The output is structured data (a table, a JSON file, a set of plots with consistent naming)
- It can be run in the background and checked later

### Configuration generation and validation

"Generate a Flood.jl configuration for a 250m grid over the Houston Ship Channel with ADCIRC coastal boundary conditions and Green-Ampt infiltration." The harness can:

- Use tools that know valid parameter ranges and required fields
- Validate the config against the model's schema
- Write the config file directly
- Optionally submit the job

This is a template-filling + validation task. The output is a file, not a conversation.

### Anything that feeds into a pipeline

If the agent's output is consumed by another process — a downstream script, a dashboard data source, a STAC catalog update, an Obsidian note — the harness is better because its output can be structured and predictable. A chat interface produces natural language that you'd have to parse. The harness produces files, tool call results, and structured data that pipelines can consume directly.

## Where a consumer-facing product wins

The chat interface is the right choice when the interaction is **exploratory, the follow-up depends on the answer, or the user is not a developer.**

### Interactive scientific investigation

"What happened with yesterday's surge run?" → "The peak surge was 3.2m at gauge TX-042, which is 0.8m higher than the ADCIRC hindcast" → "Why is it higher? Show me the wind field at hour 12" → "Here's the wind field — there's a localized gust feature at 29.5N that ADCIRC doesn't have" → "Is that feature real or a model artifact? Check the GFS analysis."

This conversation can't be scripted in advance. Each question depends on the answer to the previous one. The scientist is steering the investigation in real time. A chat interface is natural here — the scientist thinks, asks, sees, thinks again.

### Onboarding and exploration

A new team member asking "what simulations have we run over the Gulf of Mexico in the last month?" or "how does the Flood.jl coastal boundary condition work?" needs a conversational interface that can explain, show examples, and answer follow-ups. This is a Q&A use case, not a pipeline.

### Non-technical stakeholders

If a program manager or a client needs to ask "what's the flood risk for this area given yesterday's forecast," they need a polished chat interface with natural language output and embedded figures — not a CLI. The consumer product sanitizes and presents; the harness computes.

### One-off ad hoc analysis

"I have a hunch that the boundary layer is too shallow in our runs over West Texas — can you pull the last 5 runs and show me vertical profiles of theta at a few points?" This is a real analysis request but it's a one-off. Scripting it as a repeatable workflow isn't worth the overhead. A conversation where the agent uses the same underlying tools (STAC, Zarr, diagnostics, plotting) but in an interactive, exploratory mode is more efficient.

## The key insight: same tools, different surfaces

The STAC query tool, Zarr loader, diagnostic functions, and plotting tools are the same regardless of surface. The difference is how they're invoked and how the output is presented:

| | Claude Code harness | Consumer product |
|---|---|---|
| **Invocation** | Script, cron, hook, CLI command, skill | Chat message, API call |
| **Instructions** | AGENTS.md, CLAUDE.md (persistent, version-controlled) | System prompt (configured per deployment) |
| **Output** | Files, structured data, tool results | Natural language, embedded figures, formatted reports |
| **Repeatability** | High — same instructions, same tools, same workflow | Low — conversation is unique each time |
| **Composability** | High — output feeds into scripts, pipelines, other tools | Low — output is for human consumption |
| **User** | Developer, scientist comfortable with CLI | Scientist, PM, client, anyone |
| **Audit trail** | Git history of AGENTS.md + run logs | Conversation logs |

The architecture implication: **build the tools once as a shared library, then expose them through both surfaces.** The tool functions don't know or care whether they're being called from a Claude Code skill or a consumer chat product. The domain logic (what diagnostics to compute, what plots to make, what thresholds matter) lives in the tools. The surface just decides how to invoke them and how to present the results.

## Where this connects to the agent harness specifically

Claude Code's harness has specific features that map well to the repeatable-workflow use case:

**AGENTS.md / CLAUDE.md** — persistent, version-controlled instructions that define how the agent behaves in this project. "When verifying a Flood.jl run, always check: CFL, conservation, NaN/Inf, physical bounds, RMSE vs reference." This is the equivalent of a runbook, but executable. It evolves with the project and is the same for every invocation.

**Hooks** — shell commands that fire on events (tool calls, session start, etc.). A post-simulation hook could trigger the verification workflow automatically. A pre-commit hook could validate configuration files. This is the wiring that turns individual tools into pipelines.

**Skills (slash commands)** — named, reusable operations. `/verify-run run-2026-03-15-hurricane-ida` could be a skill that runs the full verification suite. `/compare-runs run-001 run-002 run-003 --metric surge_rmse` could be another. These are the repeatable workflows packaged for easy invocation.

**MCP servers** — the tool layer can be exposed as MCP tools, which means the same tools are available to both Claude Code and any consumer product that speaks MCP. Build once, expose twice.

## The practical split for Aeolus

A reasonable division based on the data analyst framing:

**Harness (Claude Code):**
- Post-simulation verification (automated, repeatable)
- Scheduled analysis reports (cron-driven, consistent output)
- Batch run comparisons (structured, multi-run)
- Configuration generation and validation
- Data pipeline operations (STAC catalog updates, Zarr processing)
- Any workflow that a scientist would otherwise script in Python

**Consumer product (chat interface):**
- Interactive investigation ("what happened with this run?")
- Ad hoc analysis requests
- Exploration and onboarding
- Stakeholder-facing summaries
- Anything where the next question depends on the last answer

**Both (shared tool layer):**
- STAC query functions
- Zarr/Icechunk loading and subsetting
- Diagnostic and verification computations
- Plotting and figure generation
- Breeze/Flood configuration utilities

Build the shared tool layer first. Wire it into Claude Code for the repeatable workflows. Wire it into a chat product for the interactive stuff. The tools don't care which surface calls them.

---

## The Claude Agent SDK changes the calculus

The Claude Agent SDK (`claude-agent-sdk` on pip/npm) is Claude Code as a library — the same tools, agent loop, and context management, but programmable in Python and TypeScript. This matters because it eliminates most of the "build your own agent harness" work.

### What you get for free (don't have to build)

**The agent loop.** The SDK handles the entire tool-calling cycle: Claude decides which tool to use, the SDK executes it, feeds the result back, Claude decides the next step, repeat until done. This is the thing that LangGraph, deepagents, and every other framework in the Sonde survey built from scratch. With the SDK, it's one function call:

```python
async for message in query(
    prompt="Compare yesterday's Flood.jl run to the ADCIRC hindcast at Houston Ship Channel gauges",
    options=ClaudeAgentOptions(
        allowed_tools=["Bash", "Read", "Glob", "mcp__stac__*", "mcp__aeolus__*"],
        permission_mode="acceptEdits",
    ),
):
    print(message)
```

That's it. No graph definition, no state schema, no router, no supervisor. Claude figures out the tool sequence from the prompt.

**Built-in tools.** Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch — all implemented and ready. The agent can read files, run scripts, search the web, and navigate codebases without you writing any tool execution code.

**MCP integration.** Any MCP server — STAC catalog, Postgres database, filesystem, GitHub, Slack, custom APIs — plugs in with a few lines of config. This is how domain-specific tools connect:

```python
options = ClaudeAgentOptions(
    mcp_servers={
        "stac": {
            "command": "python",
            "args": ["-m", "aeolus_mcp.stac_server"],
        },
        "aeolus": {
            "command": "python",
            "args": ["-m", "aeolus_mcp.tools_server"],
        },
    },
    allowed_tools=["mcp__stac__*", "mcp__aeolus__*", "Read", "Bash"],
)
```

The agent discovers available tools from the MCP servers automatically. Tool search handles large tool sets by loading definitions on demand so they don't consume the context window.

**Session management.** Multi-turn conversations with resume, fork, and automatic context persistence — all handled by the SDK. A scientist can start an investigation, close the terminal, come back tomorrow, and `resume=session_id` picks up with full context. Sessions are stored as local JSONL files, human-inspectable, and can be listed/queried programmatically.

**Subagents.** Spawn specialized sub-agents for focused tasks — the SDK handles the delegation and context isolation. Define them inline:

```python
agents={
    "verifier": AgentDefinition(
        description="Simulation verification specialist",
        prompt="Run standard verification checks on the specified simulation run.",
        tools=["Bash", "Read", "mcp__stac__*", "mcp__aeolus__*"],
    )
}
```

**Hooks.** Pre/post tool-use callbacks for logging, auditing, validation, or blocking dangerous operations. Every file edit can be logged to an audit trail. Every STAC query can be recorded. This is the structured interaction log the knowledge-base doc recommended — built in.

**Permissions.** Fine-grained control: read-only agents, auto-approve edits, require approval for Bash commands, block specific tools. Lock down a consumer-facing agent to read-only STAC queries and plotting, while giving the internal harness full Bash access.

**Skills and CLAUDE.md.** Reusable workflows defined in markdown (`.claude/skills/SKILL.md`), project-level instructions (`CLAUDE.md`), and custom slash commands (`.claude/commands/*.md`). This is where domain knowledge lives — "when verifying a Flood.jl run, check these 8 conditions" — version-controlled alongside the code.

### What you still have to build

**The domain tools themselves.** The SDK gives you the harness; you supply the science. Concretely:

- An MCP server (or set of Python functions) that wraps your STAC catalog: `search_runs(model, date_range, bbox, resolution)`, `get_run_metadata(run_id)`, `get_zarr_asset(run_id, variable)`
- An MCP server that wraps Zarr/Icechunk: `load_slice(zarr_path, variable, level, bbox, time_range)`, `compute_statistics(data, region)`, `compute_rmse(forecast, observation)`
- Plotting tools: `plot_plan_view(data, style)`, `plot_comparison(forecast, observation)`
- Breeze/Flood config generators: `generate_flood_config(description)`, `validate_config(path)`

These are plain Python functions behind an MCP interface. They're the "durable tool layer" from the multi-agent reality check — framework-independent, reusable across any surface.

**The STAC catalog and data infrastructure.** The SDK can query STAC, but the catalog has to exist and be populated. This is the infrastructure work that matters regardless of agent framework.

**The domain knowledge in CLAUDE.md and skills.** What makes the agent useful for atmospheric science vs. generic data analysis. Which verification checks matter, what constitutes a physically valid result, how to interpret common patterns. This is prompt engineering + domain expertise, encoded in version-controlled markdown.

### What you don't have to build

This is the important list — things you would have had to build with a custom framework that the SDK handles:

- ~~Tool-calling loop~~ (SDK agent loop)
- ~~Conversation/session management~~ (SDK sessions with resume/fork)
- ~~File reading/writing/searching infrastructure~~ (built-in tools)
- ~~Permission and safety system~~ (SDK permissions + hooks)
- ~~Multi-agent coordination framework~~ (SDK subagents)
- ~~CLI interface~~ (Claude Code CLI for interactive use)
- ~~Streaming/output handling~~ (SDK async iterator)
- ~~Context window management~~ (SDK handles automatically)
- ~~Web search/fetch~~ (built-in tools)
- ~~Custom approval flows~~ (SDK `canUseTool` callback)
- ~~Audit logging~~ (SDK hooks)

That's basically everything AutoResearchClaw, deepagents, and agentic-data-scientist built custom. The SDK gives it to you as a library.

### How this maps to the two surfaces

**Claude Code CLI (interactive, scientist-facing):**
The scientist opens a terminal, runs `claude` in the project directory, and asks questions. CLAUDE.md provides project context. Skills provide reusable workflows. MCP servers provide domain tools. This is the interactive data analyst — zero custom code beyond the tools and CLAUDE.md.

**Claude Agent SDK (programmatic, pipeline-facing):**
A Python script calls `query()` with a prompt and options. Used for:
- Post-simulation verification triggered by a webhook
- Nightly scheduled analysis reports
- Batch processing across many runs
- Embedding the analyst in a web app or Slack bot (consumer product)
- CI/CD pipeline steps

Same tools, same CLAUDE.md, same MCP servers. Different invocation surface.

```python
# Nightly verification — triggered by cron or post-simulation hook
async for message in query(
    prompt=f"Verify simulation run {run_id}. Check CFL, conservation, NaN/Inf, "
           f"physical bounds, and RMSE against reference if available. "
           f"Write results to verification/{run_id}.md",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Write", "Bash", "mcp__stac__*", "mcp__aeolus__*"],
        permission_mode="bypassPermissions",  # headless, sandboxed
        system_prompt="You are Aeolus verification agent. Follow CLAUDE.md strictly.",
    ),
):
    if isinstance(message, ResultMessage):
        log_verification_result(run_id, message)
```

### The implication for the stack

The Claude Agent SDK is the thin orchestration layer the multi-agent reality check doc argued for. It's not LangGraph — there's no graph definition, no state schema, no framework abstractions to migrate away from later. It's Claude's native tool-use loop exposed as a library. If better models make the tool-use loop unnecessary (the "jQuery scenario"), you drop the SDK and call the API directly — the tools and domain knowledge are unchanged.

The revised build order:

1. **STAC catalog + data infrastructure** (the foundation everything queries)
2. **Domain MCP tools** (STAC wrappers, Zarr loaders, diagnostics, plotting — plain Python functions behind MCP)
3. **CLAUDE.md + skills** (domain knowledge, verification procedures, common workflows)
4. **Claude Code CLI for interactive use** (scientists asking questions — works immediately once 1-3 exist)
5. **Claude Agent SDK for programmatic use** (scheduled jobs, webhooks, CI — same tools, scripted invocation)
6. **Consumer product** (web UI or Slack bot wrapping the SDK — only when there's demand from non-CLI users)

Steps 1-3 are the real work. Steps 4-5 are configuration. Step 6 is a product decision, not an engineering one.
