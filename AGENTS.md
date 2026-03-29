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
    assets/              # static files (callback.html, aeolus-wordmark.svg)
    models/              # pydantic models — ExperimentCreate, Experiment, etc.
    db/                  # supabase client + per-entity CRUD modules
      client.py          # auth-aware Supabase client singleton
      experiments.py     # experiment CRUD + search
    commands/            # click command groups
      auth.py            # login, logout, whoami
      experiment.py      # log, list, show, search
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

### Click command patterns

```python
@experiment.command()
@click.option("--program", "-p", help="Program namespace")
@click.option("--limit", "-n", default=50, help="Max results")
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
- Always accept `--json` via the global context, never as a per-command flag.
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

---

## Design principles

These are from the PRD. Internalize them.

1. **One command to log, zero friction to query.** If logging takes more than 30 seconds, people won't do it. The CLI must be fast enough that logging is a side effect of working, not a separate task.
2. **Human and agent records are indistinguishable.** The `source` field says `human/mlee` or `codex/task-abc`, but the record schema is identical. This is how institutional memory compounds.
3. **Provenance is permanent.** Every record links to a git commit, data sources, and the human or agent who created it. Years from now, someone should be able to trace any finding back to the exact code and data that produced it.
4. **Stdout is for data, stderr is for humans.** Data output (tables, JSON) goes to stdout and is pipeable. Status messages, progress, and errors go to stderr. Every command supports `--json`.
5. **No LLM dependency.** The CLI is a data management tool. Intelligence comes from the agents that use it. The CLI never calls an LLM.

---

## What not to do

- **Do not add an ORM.** Supabase's REST client is the database interface. SQLAlchemy, Tortoise, etc. add complexity without benefit for our query patterns.
- **Do not add async.** The CLI is synchronous. Supabase's Python SDK is synchronous. Click is synchronous. Do not introduce `asyncio` unless a specific feature requires it (e.g., parallel uploads), and even then scope it tightly.
- **Do not add a web framework.** The API server (`sonde serve`) is a future feature. Do not add FastAPI, Flask, or Django to the CLI package.
- **Do not create documentation files** (README, CHANGELOG, etc.) unless explicitly asked.
- **Do not add comments that restate the code.** The code should be clear enough on its own. Comments explain *why*, not *what*.
- **Do not add error handling for impossible states.** If `get_client()` returns a client, it is authenticated. Do not wrap every Supabase call in a try/except "just in case."
- **Do not use `Any` as a type annotation** unless the data genuinely has no known structure (e.g., Supabase's loose return types, user-provided JSON parameters). Prefer specific types.
