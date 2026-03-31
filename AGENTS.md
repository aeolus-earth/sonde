# AGENTS.md — Sonde CLI Development

You are building **Sonde**, the Aeolus CLI. It is a scientific discovery management tool — the research memory of a 16-person atmospheric science company. Scientists and AI agents use it to log experiments, record findings, track research directions, store data, and query what the team knows.

The prior repo-exploration AGENTS.md is archived at `AGENTS-repo-exploration.md`.

---

## Project structure

```
cli/
  src/sonde/
    __init__.py          # version
    cli.py               # click entrypoint, SondeCLI group with shortcuts
    config.py            # pydantic-settings, .aeolus.yaml discovery, Supabase creds
    auth.py              # OAuth PKCE login, token resolution, session persistence
    git.py               # git provenance auto-detection (commit, remote, branch)
    output.py            # Rich console (stdout=data, stderr=status), table/json/error helpers
    skills.py            # skill bundling, deployment, version tracking
    runtimes.py          # runtime adapters (Claude Code, Cursor, Codex)
    local.py             # .sonde/ directory — render/parse markdown, templates
    assets/              # static files (callback.html, aeolus-wordmark.svg)
    data/skills/         # bundled skill files deployed by `sonde setup`
    models/              # pydantic models — ExperimentCreate, Experiment, etc.
    cli_options.py       # shared decorators (pass_output_options for --json on subcommands)
    db/                  # supabase client + per-entity CRUD modules
      client.py          # auth-aware Supabase client singleton
      experiments.py     # experiment CRUD + search + update
      findings.py        # finding CRUD + supersede
      questions.py       # question CRUD + update
      artifacts.py       # file upload to Supabase Storage
      activity.py        # append-only activity log
    commands/            # click command modules (see CLI architecture below)
      experiment.py      # noun group: log, list, show, search, update + subcommand registration
      direction_group.py # noun group: list, show, create, update
      finding_group.py   # noun group: list, show, create
      question_group.py  # noun group: list, show, create, promote
      tag.py             # noun group: list, show, add, remove (top-level)
      lifecycle.py       # close, open, start (registered on experiment group)
      note.py            # add notes (registered on experiment group)
      attach.py          # attach files (registered on experiment group)
      diff.py            # compare two experiments side-by-side
      history.py         # activity timeline (registered on experiment group)
      new.py             # scaffold templates (registered on experiment group)
      sync.py            # sync group wrapping pull + push
      pull.py            # pull from Supabase to .sonde/
      push.py            # push .sonde/ to Supabase
      init.py            # repo bootstrap and default direction setup
      remove.py          # remove local notebook records from .sonde/
      brief.py           # research summary (top-level, supports --all/--tag/--direction)
      recent.py          # activity feed (top-level)
      findings.py        # list findings (used by finding_group as "list" subcommand)
      questions.py       # list questions (used by question_group as "list" subcommand)
      auth.py            # login, logout, whoami
      setup.py           # onboarding, skill deployment, MCP config
      access.py          # subsystem credential checks (S3, Icechunk, STAC)
      admin.py           # agent token management
  tests/
  pyproject.toml         # hatchling build, ruff + pytest config
  uv.lock

supabase/
  config.toml
  migrations/            # numbered SQL migrations (programs, experiments, findings,
                         #   directions, questions, artifacts, storage, views, RLS, auth RBAC)

tickets/                 # feature tickets with motivation and implementation plans
prd/                     # product requirements (overview, CLI PRD, GitHub integration)
```

---

## Stack

| Tool | Version | Role |
|------|---------|------|
| **Python** | 3.12+ | Runtime |
| **uv** | latest | Package management, virtual environments, tool installation |
| **Click** | 8.1+ | CLI framework |
| **Rich** | 13.0+ | Terminal formatting (tables, panels, spinners, progress bars) |
| **Pydantic** | 2.0+ | Data validation — every model, every config, every API boundary |
| **pydantic-settings** | 2.0+ | Settings with env var / .env / config file layering |
| **Supabase** (Python SDK) | 2.0+ | Database client — Postgres via REST, auth, storage |
| **GitPython** | 3.1+ | Git provenance auto-detection |
| **Ruff** | 0.13+ | Linter + formatter (replaces black, isort, flake8, pyflakes) |
| **ty** | 0.0.26+ | Type checker (from astral-sh, complements ruff) |
| **pytest** | 8.0+ | Test runner |

---

## Code standards

### Write production-quality Python

This is a CLI that scientists and agents rely on. Every commit should be shippable.

- **Type every function signature.** Use `str | None`, not `Optional[str]`. Use `list[str]`, not `List[str]`. Pydantic models handle runtime validation; type hints handle static analysis.
- **Validate at boundaries, trust internally.** Pydantic models validate CLI input and API responses. Internal functions that receive already-validated data do not re-validate.
- **Use `from __future__ import annotations`** at the top of every module. This is already established in the codebase — do not break the pattern.
- **Keep modules small and focused.** One file per entity in `models/` and `db/`. One file per command group in `commands/`. If a module exceeds ~200 lines, it probably needs splitting.

### Pydantic patterns

The codebase uses a consistent create/read pattern:

```python
class ExperimentCreate(BaseModel):
    """Input model — validated before database write."""
    program: str = Field(description="Program namespace")
    parameters: dict[str, Any] = Field(default_factory=dict)
    # ...

class Experiment(ExperimentCreate):
    """Full record — includes database-generated fields."""
    id: str
    created_at: datetime
    updated_at: datetime
```

Follow this pattern for new entities. The `Create` model is what the CLI command builds; the full model is what the database returns.

- Use `Field(description=...)` for fields that appear in auto-generated docs or error messages.
- Use `Field(default_factory=...)` for mutable defaults, never bare `[]` or `{}`.
- Use `model_dump(mode="json", exclude_none=True)` when serializing for Supabase inserts.
- Use `model_dump(mode="json")` when serializing for `--json` output.

### Supabase patterns

The database client in `db/client.py` is a singleton that handles auth transparently:

```python
client = get_client()  # raises SystemExit if not authenticated
result = client.table("experiments").select("*").eq("id", exp_id).execute()
rows = to_rows(result.data)  # safely casts the loose union type
```

- Always use `from sonde.db import rows as to_rows` to handle Supabase's loose return types.
- Build queries with method chaining: `.select()`, `.eq()`, `.order()`, `.limit()`.
- For RPC calls (database functions), use `client.rpc("function_name", {params}).execute()`.
- Never construct raw SQL in Python. Schema changes go in `supabase/migrations/`.

### Output conventions

The CLI separates data from status messages:

```python
from sonde.output import out, err, print_table, print_json, print_success, print_error

# Data → stdout (pipeable)
print_table(columns, rows)
print_json(data)

# Status → stderr (visible but not in pipes)
err.print("[dim]Loading...[/dim]")
print_success("Created EXP-0001")
print_error("Not found", "No experiment with this ID.", "Try: sonde list")
```

- **stdout** is for data that another program might consume. Tables, JSON, plain text.
- **stderr** is for human-oriented messages: progress, success confirmations, errors.
- Every command must support `--json` via `ctx.obj.get("json")`. JSON output goes to stdout.
- Use Rich markup (`[bold]`, `[green]`, `[dim]`) in stderr messages, never in stdout data.
- `print_error` takes three arguments: what happened, why, and how to fix it. Always provide all three.

### CLI architecture — noun-verb grammar

The CLI follows a strict noun-verb pattern. **This is the most important structural rule.** It prevents the command namespace from bloating as features are added.

**Structure:**

```
sonde <noun> <verb> [args]        # canonical form
sonde <verb> [args]               # shortcut (common verbs only)
```

**Current noun groups:**

| Noun | Verbs | File |
|------|-------|------|
| `experiment` | log, list, show, search, update, close, open, start, note, attach, diff, fork, history, new, pull, push, remove | `experiment.py` + registered submodules |
| `direction` | list, show, create, update, new, pull, push, remove | `direction_group.py` |
| `finding` | list, show, create, extract, new, pull, push, remove | `finding_group.py` |
| `question` | list, show, create, promote, new, pull, push, remove | `question_group.py` |
| `tag` | list, show, add, remove | `tag.py` |
| `admin` | create-token, list-tokens, revoke-token | `admin.py` |
| `access` | s3, icechunk, stac | `access.py` |

**Top-level cross-cutting views** (not noun groups — they span multiple record types):

```
brief, recent, status, health, tree, show
```

**Top-level workflow helpers**:

```
pull, push, init
```

`sync` remains as a backward-compatibility wrapper, but it is not the primary surface the CLI should teach.

**Backward-compat shortcuts** for old names: `findings` → `finding list`, `questions` → `question list`, `tags` → `tag list`.

**Shortcuts** are defined in `SondeCLI._shortcuts` in `cli.py`. They map a bare verb to its noun group:

```python
"log"    → ("experiment", "log")
"close"  → ("experiment", "close")
# etc.
```

### Rules for adding new commands

1. **New verb on existing noun?** Add it to the noun's `click.Group` in the corresponding file. Register it on the group with `group.add_command()`. If the verb lives in its own file, import and register it at the bottom of the noun's file (see how `experiment.py` registers commands from `lifecycle.py`, `note.py`, etc.).

2. **New noun group?** Create `commands/<noun>.py` with a `@click.group()`. Register it on `cli` in `cli.py`. Add it to `category_map` in `format_help`. Keep verbs consistent with existing nouns (prefer `list`, `show`, `create`/`log`, `update`, `search` over novel verbs).

3. **New cross-cutting view?** Only if it genuinely spans multiple record types (like `brief` spans experiments + findings + questions). Otherwise it belongs under a noun. Register as a top-level command in `cli.py`.

4. **Never add a new top-level command for something that operates on a single noun.** If it acts on an experiment, it goes under `sonde experiment <verb>`. Add a shortcut in `_shortcuts` if it's common enough.

5. **Shortcuts are for ergonomics, not structure.** The canonical form is always `sonde <noun> <verb>`. Skills and docs should teach the canonical form. Shortcuts exist so `sonde close EXP-0001` works without typing `sonde experiment close EXP-0001`.

6. **All write paths go through the DB abstraction layer** (`db/experiments.py`, etc.). Commands must not call `client.table(...).update(...)` directly — use `db.update()`, `db.create()`, etc. This keeps the data layer in one place.

### Agent-native guidance

Sonde is used heavily by AI agents. The CLI should not only expose primitives; it should make the next sensible action obvious from the current state.

- **Prefer opinionated guidance over silent flexibility.** After a meaningful transition or inspection command, show the likely next command(s) instead of making the agent infer them.
- **Do not invent hidden workflow state just to guide the user.** Guidance should be computed from current record state, tree state, claim state, and direction context.
- **Success should hand-hold.** A completed experiment should usually suggest one of: continue the active child branch, fork a refinement, curate a finding, or attach the work to a direction.
- **Inspection should reduce ambiguity.** `show`, `tree`, `brief`, and lifecycle commands should agree on the current coordination story so different commands do not imply different next steps.
- **Guidance belongs in stderr, data in stdout.** Human-readable “what to do next” hints are status output, not structured data tables.

### Click command patterns

```python
from sonde.cli_options import pass_output_options

@experiment.command()
@click.option("--program", "-p", help="Program namespace")
@click.option("--limit", "-n", default=50, help="Max results")
@pass_output_options
@click.pass_context
def list_cmd(ctx: click.Context, program: str | None, limit: int):
    """List experiments.

    \b
    Examples:
      sonde experiment list
      sonde experiment list -p weather-intervention
    """
```

- Use `\b` before example blocks to prevent Click from rewrapping them.
- Short flags (`-p`, `-n`, `-s`) for frequently-used options.
- `--json` is defined both at the CLI group level and on each leaf command via the `@pass_output_options` decorator (from `cli_options.py`). This lets users write `sonde list --json` (natural) as well as `sonde --json list` (Click convention). Both write to `ctx.obj["json"]`. Always check `ctx.obj.get("json")` in command bodies.
- Resolve defaults through the settings chain: explicit flag > env var > `.aeolus.yaml` > hardcoded default.
- Use `raise SystemExit(1)` for errors, not `sys.exit()` or `click.Abort()`.

---

## Running the toolchain

```bash
cd cli/

# Install in development mode
uv sync

# Run the CLI
uv run sonde --help
uv run sonde login
uv run sonde list

# Lint (must pass before any commit)
uv run ruff check src/ tests/
uv run ruff format --check src/ tests/

# Type check
uv run ty check src/

# Format (auto-fix)
uv run ruff format src/ tests/
uv run ruff check --fix src/ tests/

# Tests
uv run pytest
```

### Ruff configuration (in pyproject.toml)

```
target-version = "py312"
line-length = 100
```

Enabled rule sets: `E` (pycodestyle), `W` (warnings), `F` (pyflakes), `I` (isort), `N` (naming), `UP` (pyupgrade), `B` (bugbear), `SIM` (simplify), `T20` (print detection), `RUF` (ruff-specific). `T201` is ignored because this is a CLI — we print things.

Ruff handles both linting and formatting. Do not add black, isort, or flake8 as separate tools.

### ty configuration

ty is the type checker from astral-sh (the ruff team). Run `uv run ty check src/` to catch type errors that ruff's lint rules miss. It understands pydantic models and generic types well.

---

## Database conventions

### Migrations

All schema changes go in `supabase/migrations/` with timestamps:

```
20260329000001_create_programs.sql
20260329000002_create_experiments.sql
...
20260329000010_auth_rbac.sql
```

- One logical change per migration file.
- Migrations are applied in order by Supabase CLI (`supabase db push`).
- Always include RLS policies in the migration that creates the table.
- Use `user_programs()` helper function (defined in migration 10) in RLS policies.

### Row-Level Security

Every table has RLS enabled. All queries flow through program-scoped policies:

```sql
CREATE POLICY "experiments_select" ON experiments
    FOR SELECT USING (program = ANY(user_programs()));
```

`user_programs()` reads from the JWT's `app_metadata.programs` claim, which is injected by the custom access token hook on login. This means:

- Humans see data in programs they're assigned to.
- Agents see data in programs their token was scoped to.
- The CLI code never filters by program — the database enforces it.

---

## Auth model

Two paths, one interface:

1. **Human login:** `sonde login` → Google OAuth PKCE → Supabase session → JWT with programs from `user_programs` table injected by custom access token hook → stored in `~/.config/sonde/session.json`
2. **Agent token:** `SONDE_TOKEN` env var → JWT signed with `pgjwt` → programs baked into the token at creation time → flows through the same RLS policies

Both paths produce a JWT that `get_client()` attaches as a Bearer token. The CLI code doesn't distinguish between human and agent after authentication.

**CLI vs web UI OAuth:** Human sign-in also exists in the Vite app (`/auth/callback` on the deployed origin). That flow is separate from `sonde login` (localhost `/callback`). Same Supabase project; different redirect URLs by design. See [`docs/oauth-flows.md`](docs/oauth-flows.md) and [`ui/docs/auth-deploy.md`](ui/docs/auth-deploy.md).

---

## Design principles

These are from the PRD. Internalize them.

1. **One command to log, zero friction to query.** If logging takes more than 30 seconds, people won't do it. The CLI must be fast enough that logging is a side effect of working, not a separate task.
2. **Human and agent records are indistinguishable.** The `source` field says `human/mlee` or `codex/task-abc`, but the record schema is identical. This is how institutional memory compounds.
3. **Provenance is permanent.** Every record links to a git commit, data sources, and the human or agent who created it. Years from now, someone should be able to trace any finding back to the exact code and data that produced it.
4. **Stdout is for data, stderr is for humans.** Data output (tables, JSON) goes to stdout and is pipeable. Status messages, progress, and errors go to stderr. Every command supports `--json`.
5. **No LLM dependency.** The CLI is a data management tool. Intelligence comes from the agents that use it. The CLI never calls an LLM.
6. **Hand-hold the next step.** Especially for branching, completion, and stale-claim cases, Sonde should tell the agent what to do next rather than requiring workflow folklore.

---

## What not to do

- **Do not add an ORM.** Supabase's REST client is the database interface. SQLAlchemy, Tortoise, etc. add complexity without benefit for our query patterns.
- **Do not add async.** The CLI is synchronous. Supabase's Python SDK is synchronous. Click is synchronous. Do not introduce `asyncio` unless a specific feature requires it (e.g., parallel uploads), and even then scope it tightly.
- **Do not add a web framework.** The API server (`sonde serve`) is a future feature. Do not add FastAPI, Flask, or Django to the CLI package.
- **Do not create documentation files** (README, CHANGELOG, etc.) unless explicitly asked.
- **Do not add comments that restate the code.** The code should be clear enough on its own. Comments explain *why*, not *what*.
- **Do not add error handling for impossible states.** If `get_client()` returns a client, it is authenticated. Do not wrap every Supabase call in a try/except "just in case."
- **Do not use `Any` as a type annotation** unless the data genuinely has no known structure (e.g., Supabase's loose return types, user-provided JSON parameters). Prefer specific types.
- **Do not add top-level commands for single-noun operations.** If a command operates on experiments, it is a verb on the `experiment` group — not a new top-level command. Add a shortcut in `_shortcuts` if ergonomics demand it. See "CLI architecture" above.
- **Do not bypass the DB abstraction layer.** Commands call `db.experiments.update()`, not `client.table("experiments").update(...)` directly. The `db/` modules are the single source of truth for data access patterns.
