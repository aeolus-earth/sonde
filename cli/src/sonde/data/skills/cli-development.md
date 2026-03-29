# SKILL.md — Production-Grade CLI Development

## When to use

Apply these rules whenever creating, modifying, or reviewing CLI commands, argument parsers, output formatting, error handling, or help text in this project. This is mandatory for all aeolus CLI work.

---

## Command structure

- **`noun verb`** pattern: `aeolus experiment list`, `aeolus finding add`, `aeolus data check`.
- Keep a small, consistent verb set: `list`, `show`, `create`/`log`, `update`, `delete`, `search`.
- Allow implicit default resource for the most common noun: `aeolus log` = `aeolus experiment log`.
- Maximum depth: 3 levels. `aeolus <noun> <verb>` is the sweet spot.

## Arguments and flags

- **Flags over positional args.** At most 1-2 positional args (the "obvious" ones like an experiment ID). Flags for everything else.
- `--long-flag-names` with hyphens (kebab-case).
- Short aliases (`-p`, `-s`) only for the most frequently used flags.
- Standard flags on every command:
  - `-h` / `--help`
  - `--json` for machine-readable output
  - `--quiet` / `-q` suppresses non-essential output
  - `--verbose` increases detail
  - `--no-color` disables color (also respect `NO_COLOR` env var)
- State-changing commands get `--dry-run` and `--force` (skip confirmations).
- Every flag overridable via env var with `AEOLUS_` prefix: `AEOLUS_PROGRAM=weather-intervention`.
- Priority: explicit flag > env var > project config > user config > default.

## Output design (critical for agent composability)

### Stdout vs stderr — enforce this strictly

- **stdout**: Data output only. The thing the user/agent asked for. What gets piped.
- **stderr**: Everything else — spinners, progress bars, status messages, warnings, prompts, errors.

If someone runs `aeolus list --json | jq '.experiments'`, the spinner must not corrupt the JSON stream. This is non-negotiable.

### Default format

Human-readable table with aligned columns. Respect terminal width. Color-code status (green=complete, yellow=running, blue=open, red=failed, dim=superseded).

```
ID        STATUS    PROGRAM              PARAMS                    FINDING
EXP-0073  complete  weather-intervention ccn=1200 scheme=bulk      Enhancement saturates ~1500
EXP-0082  complete  weather-intervention ccn=1200 scheme=spectral  8% less than bulk at same CCN
EXP-0090  open      weather-intervention heating=500 ccn=1200      —
```

### Machine formats

- `--json` outputs structured JSON to stdout. Always available.
- `--format md` outputs markdown. Useful for reports and pasting.
- `--format tsv` outputs tab-separated values. Useful for piping to `awk`/`cut`.

### Progress and completion

For operations >1 second: show a spinner or progress bar on **stderr**.

On completion, print a summary with next steps:

```
✓ Created EXP-0082 (weather-intervention)
  Attached 2 artifacts
  Linked to DIR-003

  View:    aeolus show EXP-0082
  Attach:  aeolus attach EXP-0082 <file>
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error / command failed |
| `2` | Usage error (bad flags, missing args) |
| `130` | Interrupted (Ctrl+C / SIGINT) |

Never exit 0 on failure. Scripts and agents depend on this.

## Error messages — the three-part rule

Every error must answer:

1. **What happened?** Clear, jargon-free.
2. **Why?** The likely cause.
3. **What can the user do?** Suggested fix.

```
Error: Experiment EXP-9999 not found
  No experiment with this ID exists in the database.

  List experiments: aeolus list
  Search: aeolus search --text "your query"
```

Suggest corrections on typos (Click does this by default). Distinguish user errors (exit 2) from transient errors (exit 1) from bugs (exit 1 + trace if `--verbose`).

Validate all inputs before doing work. Don't upload artifacts and then tell the user their experiment ID is invalid.

## Interactivity

- **TTY detected**: Use interactive prompts, color, progress bars, confirmations.
- **Non-TTY** (piped/scripted): No prompts, no color, structured output. Fail with a clear message if required input is missing rather than hanging on a prompt.
- Every interactive prompt must be bypassable with a flag (`--force`, or explicit flag values).
- Confirm before destructive actions (`delete`, `supersede`). Bypassable with `--force`.

## Help text — examples are mandatory

Every command must have at least one realistic example in `--help`:

```
Usage: aeolus log [OPTIONS]

  Log an experiment to the knowledge base.

Options:
  --program TEXT      Program namespace (e.g., weather-intervention)
  --hypothesis TEXT   What you expected to find
  --params JSON       Experiment parameters as JSON
  --result JSON       Results as JSON
  --finding TEXT      What you learned
  --source TEXT       Who logged this (default: human/$USER)
  --attach PATH       Attach a file (repeatable)
  --direction TEXT    Parent research direction ID
  --related TEXT      Related experiment IDs (comma-separated)
  --git-ref TEXT      Git commit reference (default: HEAD)
  --quick             Minimal record — just params + result
  --open              Log as open/backlog (no results yet)
  --json              Output created record as JSON
  -h, --help          Show this message and exit

Examples:
  # Quick log after a simulation run
  aeolus log --quick --program weather-intervention \
    --params '{"ccn": 1200, "scheme": "spectral_bin"}' \
    --result '{"precip_delta_pct": 5.8}'

  # Full log with attachments and provenance
  aeolus log --program weather-intervention \
    --hypothesis "Spectral bin changes CCN response curve" \
    --params '{"ccn": 1200, "scheme": "spectral_bin"}' \
    --result '{"precip_delta_pct": 5.8}' \
    --finding "8% less enhancement than bulk at same CCN" \
    --attach figures/precip_delta.png \
    --direction DIR-003

  # Open an experiment for the backlog
  aeolus log --open --program weather-intervention \
    --hypothesis "Combined BL heating + seeding is superlinear"
```

## Configuration

- User config: `~/.config/aeolus/config.yaml`
- Project config: `.aeolus.yaml` in repo root (walk up from cwd)
- `aeolus config list` shows all values with source attribution:

```
KEY         VALUE                    SOURCE
program     weather-intervention     project config (.aeolus.yaml)
db_url      postgresql://...         env var (AEOLUS_DB_URL)
source      human/mlee               user config (~/.config/aeolus/config.yaml)
```

Setting `program` in project config means scientists don't have to pass `--program` on every command when working in a research repo. This removes the most common flag.

## Robustness

- **Idempotency**: `aeolus update EXP-0073 --status complete` twice should not fail or create duplicates.
- **Signal handling**: SIGINT/SIGTERM → clean up gracefully, print short message, exit 130. SIGPIPE → exit silently.
- **Atomic writes**: Write to temp file, then rename. Don't leave half-written artifacts on error.
- **Timeouts**: All database/network operations have configurable timeouts with sane defaults (30s). Never hang forever.

## Click-specific patterns (our framework)

Use Click with these patterns:

```python
import click
from rich.console import Console
from rich.table import Table

console = Console(stderr=True)  # Rich output goes to stderr
output = Console()               # Data output goes to stdout

@click.group()
@click.version_option()
@click.option('--json', 'use_json', is_flag=True, help='Output as JSON')
@click.option('--quiet', '-q', is_flag=True, help='Suppress non-essential output')
@click.option('--verbose', is_flag=True, help='Increase detail')
@click.option('--no-color', is_flag=True, help='Disable color output')
@click.pass_context
def cli(ctx, use_json, quiet, verbose, no_color):
    ctx.ensure_object(dict)
    ctx.obj['json'] = use_json
    ctx.obj['quiet'] = quiet
    ctx.obj['verbose'] = verbose
```

- Use `click.group()` for noun groups, `@group.command()` for verbs.
- Use `Rich` for all terminal formatting (tables, panels, syntax highlighting, progress bars).
- Rich `Console(stderr=True)` for status output. Plain `Console()` for data output.
- Use `click.echo()` or `output.print_json()` for data that goes to stdout.
- Use Pydantic for all input validation before database operations.

## Checklist — verify before shipping any command

- [ ] Follows `noun verb` structure
- [ ] Flags over positional args (max 1-2 positional)
- [ ] `--help` with at least one realistic example
- [ ] Data to stdout, everything else to stderr
- [ ] `--json` flag works
- [ ] `--quiet` and `--verbose` work
- [ ] Respects `NO_COLOR` / `--no-color`
- [ ] Shows progress for operations >1s
- [ ] Error messages: what happened, why, how to fix
- [ ] Typo correction enabled
- [ ] Validates all input before doing work
- [ ] Confirms destructive actions (bypassable with `--force`)
- [ ] `--dry-run` for state-changing commands
- [ ] Exit codes correct (0/1/2/130)
- [ ] Handles SIGINT/SIGTERM gracefully
- [ ] Works in non-TTY (no hanging prompts, no color)
- [ ] Config precedence: flag > env > project config > user config > default
- [ ] `--version` works

---

## Sources

- [clig.dev](https://clig.dev/) — Command Line Interface Guidelines
- [Heroku CLI Style Guide](https://devcenter.heroku.com/articles/cli-style-guide)
- [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46)
- Exemplars: `gh` (GitHub), `stripe`, `kubectl`, `docker`, `fly` (Fly.io)
