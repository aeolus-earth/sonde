# TICKET-006: Sonde Agent Package — AI-Powered Knowledge Base Tools

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** Medium
**Phase:** After Phase 1 CLI is stable
**Related:** TICKET-005 (entropy/curation), TICKET-003 (agent identity), Claude Agent SDK

---

## What this is

A separate Python package (`sonde-agent`) that provides AI-powered tools for the sonde knowledge base. The agent is exposed through the sonde CLI as `sonde agent <verb>` but lives in its own package with its own dependencies.

The agent uses the Claude Agent SDK (`claude-agent-sdk`). It calls sonde CLI commands via the Bash tool — same interface as a human. It doesn't get special database access or internal APIs. It dogfoods the CLI.

---

## Why a separate package

- **Different dependencies.** The CLI needs click, rich, supabase. The agent needs `claude-agent-sdk`. Most sonde users don't need the agent — they shouldn't pay for its dependency tree.
- **Different release cadence.** The agent's prompts and policies iterate faster than the CLI's command surface. Decoupling lets us ship prompt improvements without CLI releases.
- **Different runtime.** The CLI runs in a user's terminal. The agent can run as a background process, cron job, or CI step. Different operational concerns.
- **Clean boundary.** The agent consumes sonde as a tool, not as a library. If the CLI's `--json` output is insufficient for the agent, that's a signal to improve the CLI — not to add internal shortcuts.

---

## Architecture

```
User types:     sonde agent review EXP-0001
                         │
CLI (cli/):              │ thin launcher
  commands/agent.py ─────┤ imports sonde_agent, validates API key
                         │
Agent (agent/):          │
  sonde_agent.run() ─────┤ wraps claude_agent_sdk.query()
                         │ with system prompt + tool config
                         │
Claude Agent SDK:        │
  query(prompt, opts) ───┤ autonomous agent loop
                         │ uses Bash to run `sonde` commands
                         │
Sonde CLI:               │
  sonde brief --json ────┘ the agent's eyes and hands
  sonde show --json
  sonde close EXP-0001
  sonde note EXP-0001 "..."
```

The agent never imports from `sonde.*` directly. It runs `sonde` commands via Bash, reads their JSON output, reasons about it, and runs more commands. This means:
- The agent works with any sonde version that supports `--json`
- The CLI doesn't need to know the agent exists
- Testing is straightforward — mock the Bash tool responses

---

## Package structure

```
/sonde/agent/
├── pyproject.toml              # claude-agent-sdk dep, ruff, pytest
├── .python-version             # 3.13
├── src/sonde_agent/
│   ├── __init__.py             # version
│   ├── run.py                  # core runner: wraps query() with sonde defaults
│   ├── prompts/
│   │   ├── __init__.py         # prompt assembly (base + task)
│   │   ├── base.py             # shared preamble: what sonde is, command reference
│   │   ├── review.py           # review mandate and behavior
│   │   ├── clean.py            # curation mandate and policies
│   │   └── format.py           # formatting mandate and style guide
│   └── tools.py                # tool allow-lists per task type
└── tests/
    ├── conftest.py
    ├── test_prompts.py
    └── test_run.py
```

---

## Commands

### `sonde agent review`

Evaluates experiment quality and knowledge base coherence.

```bash
sonde agent review EXP-0001                    # review one experiment
sonde agent review -p weather-intervention     # review a program
```

**What the agent does:**
1. Reads the target experiment(s) via `sonde show --json` / `sonde list --json`
2. Reads the program context via `sonde brief --json`
3. Evaluates:
   - Completeness: has content? has tags? has finding (if complete)?
   - Staleness: running >48h? open >30d?
   - Coherence: contradicts any active findings? duplicates another experiment?
   - Provenance: has git commit? has data sources?
4. Outputs a structured assessment with suggested actions

**Tools:** Read-only. `Bash` (sonde read commands only), `Read`, `Glob`, `Grep`.
**Max turns:** ~15. This is analysis, not a long running task.

### `sonde agent clean`

Resolves obvious issues, flags ambiguous ones for human review.

```bash
sonde agent clean -p weather-intervention          # clean a program
sonde agent clean -p weather-intervention --dry-run  # show what would change
```

**What the agent does:**
1. Runs `sonde brief --json` and `sonde list --json` to assess the program
2. Identifies issues (stale, missing content, tag duplicates, contradictions)
3. For easy issues — auto-resolves:
   - Closes experiments stale >7 days with `sonde close EXP-XXXX` and a note
   - Normalizes obvious tag duplicates with `sonde update EXP-XXXX --tag ...`
   - Adds `needs-review` tag to experiments with no content
4. For hard issues — flags without resolving:
   - Contradictions between findings → adds a note, doesn't supersede
   - Potential duplicate experiments → tags as `possible-duplicate`
   - Questions open >60 days → notes them in the report
5. Produces a summary of what was done and what needs human attention

**Tools:** `Bash` (sonde read + write commands). No file editing — it only uses sonde.
**Max turns:** ~30. May need to iterate through many records.
**`--dry-run`:** Agent reports what it would do but doesn't execute any write commands.

### `sonde agent format`

Improves content structure and completeness of an experiment record.

```bash
sonde agent format EXP-0001
```

**What the agent does:**
1. Reads the experiment via `sonde show --json`
2. Evaluates the content quality:
   - Does it have structure (headings, lists)?
   - Does it describe the method, results, and interpretation?
   - Is there a finding that could be extracted?
   - Are there obvious tags to suggest?
3. Rewrites the content with better structure (headings, parameter lists, findings section)
4. Updates the record via `sonde update EXP-0001 --content-file improved.md`
5. If finding field is empty but content describes a result, suggests one

**Tools:** `Bash` (sonde commands), `Read`, `Write` (for temp files).
**Max turns:** ~10. Focused on one record.

---

## System prompts

The quality of the agent depends entirely on the system prompts. These are the most important files in the package.

### Base preamble (shared across all tasks)

Teaches the agent:
- What sonde is (experiment management for atmospheric research)
- The complete command reference with examples
- How to use `--json` for machine-readable output
- The data model: experiments have id, program, status, source, tags, content
- The status lifecycle: open → running → complete (or failed/superseded)
- What programs exist and what they cover
- How findings, questions, and directions relate to experiments

### Task-specific prompts

Each task prompt defines:
- **Mandate:** what the agent is responsible for
- **Boundaries:** what it must not do (never delete, never make scientific judgments)
- **Decision framework:** how to decide between auto-resolve and flag-for-human
- **Output format:** what to tell the user when done
- **Examples:** concrete scenarios with expected behavior

---

## CLI integration

### `cli/src/sonde/commands/agent.py`

A thin launcher — no agent logic lives here. It:
1. Validates `ANTHROPIC_API_KEY` is set (from `.env` or environment)
2. Tries to import `sonde_agent` — if missing, prints install hint
3. Assembles the prompt from command args (target experiment, program, flags)
4. Calls `asyncio.run(sonde_agent.run(...))`
5. Streams agent output to the terminal via Rich

### Optional dependency

```toml
# cli/pyproject.toml
[project.optional-dependencies]
agent = ["sonde-agent>=0.1"]
```

`pip install sonde` → CLI only, no agent
`pip install sonde[agent]` → CLI + agent

### Help category

```python
# cli.py category_map
"agent": "AI Tools"
```

Shows in its own panel in `sonde --help`.

---

## Configuration

### API key

`ANTHROPIC_API_KEY` in `.env` at the repo root. The CLI already loads `.env` via `python-dotenv` at startup. The agent launcher reads the key from the environment.

If the key is missing, `sonde agent review` prints:
```
Error: ANTHROPIC_API_KEY not set
  Add ANTHROPIC_API_KEY=sk-ant-... to your .env file
  Or set it in your environment: export ANTHROPIC_API_KEY=sk-ant-...
```

### Agent SDK options

```python
ClaudeAgentOptions(
    model="claude-sonnet-4-5-20250929",
    permission_mode="bypassPermissions",    # pre-authorized, no prompts
    cwd=repo_root,                          # so `sonde` commands work
    system_prompt=assembled_prompt,
    allowed_tools=task_tools,               # per-task tool list
    max_turns=max_turns,                    # per-task limit
)
```

`permission_mode="bypassPermissions"` because the agent is pre-authorized — the system prompt constrains what it does, and it only uses sonde commands (not arbitrary shell commands). The prompts explicitly instruct the agent to only run `sonde` commands.

---

## Tooling

### Build system
- **Hatchling** (same as CLI)
- **src layout** (`src/sonde_agent/`)

### Linting
- **Ruff** with same config as CLI (py312, 100 char lines, same rule set)

### Testing
- **pytest** with `pytest-asyncio` for async agent tests
- Tests mock the Claude Agent SDK (`query()` returns predetermined messages)
- No live API calls in unit tests
- Integration tests (marked `integration`) can call the real API

### Type checking
- **ty** (same as CLI dev deps)

---

## What makes this different from building the logic into the CLI

The key insight: **curation requires judgment, not code.** You can't write a function that decides whether FIND-001 and FIND-007 are truly contradictory or just about different conditions. You can't write a function that reads `"ran simulation"` and decides whether it's worth keeping or should be flagged as low-quality. These are LLM tasks.

The CLI handles what's codeable: staleness detection (running >7d), tag dedup (case-insensitive match), quality scoring (has content? has tags?). The `sonde health` command from TICKET-005 Phase 2 does this.

The agent handles what's not codeable: reading experiment content and understanding what it means, judging whether two findings actually contradict, deciding how to restructure prose into well-organized research notes. This is the gap between `sonde health` (rule-based) and `sonde agent clean` (judgment-based).

---

## Dependencies between tickets

- **TICKET-005 Phase 1** (passive quality signals) should ship first — the agent's review output is more useful when the CLI already shows staleness and quality indicators
- **TICKET-005 Phase 2** (`sonde health`) is independent — it provides rule-based diagnostics that the agent can build on but doesn't require
- **TICKET-003** (agent identity) matters for `sonde agent clean` — the curator needs a source identifier (`agent/curator`) that's tracked in activity_log
- **TICKET-001** (knowledge graph) is future work — the synthesis agent (Phase 4 of TICKET-005) depends on it, but review/clean/format don't

---

## Acceptance criteria

1. `pip install sonde-agent` installs cleanly with `claude-agent-sdk` dependency
2. `pip install sonde[agent]` installs CLI + agent together
3. `sonde agent --help` shows review, clean, format subcommands
4. `sonde agent review EXP-0001` reads the experiment, outputs a structured assessment
5. `sonde agent clean -p weather-intervention --dry-run` identifies issues without acting
6. `sonde agent clean -p weather-intervention` auto-resolves easy issues and flags hard ones
7. `sonde agent format EXP-0001` improves content structure
8. All agent actions are logged in activity_log with appropriate source
9. Missing `ANTHROPIC_API_KEY` produces a clear error message
10. Missing `sonde-agent` package produces an install hint
11. `ruff check agent/src/` passes with zero errors
12. `cd agent && pytest` passes

---

*Related:*
- *tickets/005-knowledge-base-entropy-and-curation.md — the problem this solves*
- *tickets/003-identity-and-agent-tracking.md — agent identity for curator actions*
- *Claude Agent SDK docs — https://platform.claude.com/docs/en/agent-sdk/overview*
