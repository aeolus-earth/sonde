# SKILL.md — CLI Design & UX Best Practices

## Purpose

This skill defines the design principles, patterns, and concrete rules for building high-quality command-line interfaces. Reference this document whenever you are creating, modifying, or reviewing CLI commands, argument parsers, output formatting, error handling, or help text.

These guidelines are synthesized from clig.dev (the canonical open-source CLI guidelines by the Docker Compose creators), Heroku's CLI style guide, 12-Factor CLI Apps, and practitioner consensus from Stripe, GitHub (`gh`), `kubectl`, and others.

---

## 1. Command Structure

### 1.1 Use `noun verb` (resource-action) structure

```
mycli project create
mycli run list --status active
mycli config set key value
```

NOT:

```
mycli create-project
mycli listRuns --status active
```

The top-level binary is the namespace. Subcommands should read like `<resource> <action>`. This mirrors REST semantics and makes commands guessable.

### 1.2 Keep a small, consistent verb set

Pick a canonical set and reuse it everywhere:

| Verb | Meaning |
|------|---------|
| `list` | List resources (paginated) |
| `get` / `show` | Get a single resource by ID |
| `create` | Create a new resource |
| `update` | Modify an existing resource |
| `delete` | Remove a resource |
| `run` | Execute a workflow or job |
| `status` | Show current state |
| `logs` | Stream or fetch logs |

If you need a special operation (like `sync`, `push`, `watch`), that's fine — but don't invent synonyms for the standard verbs.

### 1.3 Implicit default resources

If one resource is overwhelmingly the most common, allow the user to omit it:

```
# Both should work:
mycli build
mycli project build
```

### 1.4 Maximum depth: 3 levels

`mycli <noun> <verb>` is the sweet spot. `mycli <group> <noun> <verb>` is acceptable for large CLIs. Deeper nesting is a smell.

---

## 2. Arguments & Flags

### 2.1 Flags over positional arguments

Positional args are ambiguous. Use at most 1-2 positional args (the "obvious" ones), and flags for everything else.

```
# Good — self-documenting
mycli run create --model breeze --region ercot --hours 48

# Bad — what is what?
mycli run create breeze ercot 48
```

### 2.2 Flag naming conventions

- Use `--long-flag-names` with hyphens (kebab-case), not underscores or camelCase.
- Provide `-x` short aliases only for the most frequently used flags.
- Standard aliases to always support:
  - `-h` / `--help`
  - `-v` / `--version`
  - `-q` / `--quiet`
  - `--verbose` (do NOT alias `-v` to verbose if you use it for version)
  - `--json` for machine-readable output
  - `--no-color` to disable color output
  - `--dry-run` for state-changing commands
  - `-o` / `--output` for output format selection
  - `-f` / `--force` to skip confirmations

### 2.3 Boolean flags should be positive

```
# Good
--color (default on), --no-color to disable
--interactive (default on for TTY), --no-interactive

# Bad
--no-verify (confusing double negative when combined with --no-)
```

### 2.4 Accept stdin when it makes sense

If a command takes file input, accept `-` as a filename meaning stdin:

```
mycli config validate -f -          # reads from stdin
cat config.yaml | mycli config validate -f -
```

### 2.5 Environment variable overrides

Every flag should be overridable via an environment variable with a consistent prefix:

```
MYCLI_REGION=ercot mycli run create --model breeze
```

Document the env var name in `--help` output next to each flag. Priority order: explicit flag > env var > config file > default.

---

## 3. Output Design

### 3.1 Default to human-readable, opt into machine-readable

- Default output should be formatted for a human reading a terminal.
- `--json` flag outputs structured JSON to stdout.
- `--quiet` / `-q` suppresses all non-essential output.
- `--verbose` increases detail level.

### 3.2 Stdout vs. stderr

This is critical for composability:

- **stdout**: Data output only. The thing the user asked for. What gets piped.
- **stderr**: Everything else — progress bars, spinners, status messages, warnings, prompts, error messages.

If someone runs `mycli data export | jq '.records'`, your spinner must not corrupt the JSON stream.

### 3.3 Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error / command failed |
| `2` | Usage error (bad flags, missing args) |
| `126` | Command not executable |
| `127` | Command not found |
| `130` | Interrupted (Ctrl+C / SIGINT) |

Never exit 0 on failure. Scripts depend on this.

### 3.4 Progress and status

For any operation that takes more than ~1 second:

- Show a spinner or progress bar on stderr.
- For multi-step operations, show the current step: `[2/5] Downloading boundary conditions...`
- On completion, print a summary: what was done, how long it took, what to do next.

```
✓ Run created (id: run_3fa8b)
  Model: breeze-v2.1
  Region: ERCOT
  Forecast hours: 48
  
  View logs:  mycli run logs run_3fa8b
  Check status: mycli run status run_3fa8b
```

### 3.5 Tables

When listing resources, use aligned columns. Respect terminal width. Default to the most useful columns, and let users select columns with `--columns` or `-c`:

```
ID          MODEL       REGION    STATUS     CREATED
run_3fa8b   breeze-v2   ercot     running    2 mins ago
run_7cd2e   breeze-v2   pjm       completed  1 hour ago
```

Use `--json` for full-fidelity output.

### 3.6 Color

- Use color to encode semantics: red for errors, yellow for warnings, green for success, dim/gray for secondary info.
- Check `NO_COLOR` env var and `--no-color` flag. Respect them.
- Check if stdout/stderr is a TTY. If not (piped), disable color automatically.
- Never use color as the *only* signal — always pair with text (e.g., `✓` or `✗` alongside green/red).

---

## 4. Error Handling

### 4.1 The three-part error message

Every error message should answer three questions:

1. **What happened?** — A clear, jargon-free description.
2. **Why?** — The likely cause.
3. **What can the user do?** — Suggested fix or next step.

```
# Good
Error: Cannot connect to forecast API at https://api.aeolus.com
  The server returned a 503 (Service Unavailable).
  This usually means the API is temporarily down for maintenance.

  Try again in a few minutes, or check status at https://status.aeolus.com
  If this persists, run: mycli support create --attach-logs

# Bad
Error: connection refused
```

### 4.2 Suggest corrections on typos

Use Levenshtein distance to suggest the closest valid command or flag:

```
$ mycli run craete
Error: Unknown command "craete". Did you mean "create"?
```

Most argument parsing libraries (Click, Cobra, clap, Comonicon) support this out of the box. Enable it.

### 4.3 Distinguish user errors from internal errors

- **User error** (bad input, missing config): Tell them what to fix. Exit code 2.
- **Transient error** (network, API down): Tell them to retry. Exit code 1.
- **Bug** (unexpected crash): Apologize, print a debug trace, and tell them how to report it. Exit code 1.

Never show a raw stack trace to the user unless `--verbose` is set.

### 4.4 Validate early, fail fast

Check all inputs, permissions, and preconditions before doing any work. Don't download 2GB of data and then tell the user their output path is invalid.

---

## 5. Help System

### 5.1 Every command gets `--help`

Including the root command and every subcommand. The root `--help` is the table of contents.

### 5.2 Help text structure

```
Usage: mycli <command> [flags]

Brief one-line description of the tool.

Commands:
  run        Manage forecast runs
  config     Manage configuration
  data       Access and export data

Flags:
  -h, --help       Show this help
  -v, --version    Show version
  --json           Output as JSON
  --no-color       Disable color output
  --verbose        Increase output detail

Examples:
  # Create a new 48-hour forecast run
  mycli run create --model breeze --region ercot --hours 48

  # Stream logs from a running forecast
  mycli run logs run_3fa8b --follow

  # Export forecast data as CSV
  mycli data export --run run_3fa8b --format csv > forecast.csv

Use "mycli <command> --help" for more information about a command.
```

### 5.3 Examples are mandatory

The `Examples` section is the most-read part of any help text. Every command must have at least one example showing the most common use case. Use realistic values, not `<placeholder>` syntax.

### 5.4 Link to full docs

At the bottom of `--help`, include a URL to full documentation:

```
Learn more: https://docs.aeolus.com/cli/run-create
```

---

## 6. Interactivity

### 6.1 Interactive by default in TTY, non-interactive in pipes

Detect whether stdin/stdout is a TTY:

- **TTY**: Use interactive prompts, color, progress bars, confirmations.
- **Non-TTY** (piped/scripted): No prompts, no color, structured output. Fail if required input is missing rather than hanging on a prompt.

### 6.2 Never require interactivity

Every interactive prompt must be bypassable with a flag:

```
# Interactive (TTY)
$ mycli run delete run_3fa8b
Are you sure you want to delete run_3fa8b? [y/N]: y
✓ Deleted run_3fa8b

# Non-interactive / scripted
$ mycli run delete run_3fa8b --force
✓ Deleted run_3fa8b
```

### 6.3 Confirm before destructive actions

Any operation that deletes data, overwrites files, or can't be undone should prompt for confirmation unless `--force` is passed.

### 6.4 Offer `--dry-run`

For commands that change state, `--dry-run` should show what *would* happen without doing it:

```
$ mycli run create --model breeze --region ercot --hours 48 --dry-run
Dry run — no changes will be made.

Would create run with:
  Model:   breeze-v2.1
  Region:  ERCOT
  Hours:   48
  Est. compute: 12 GPU-minutes
```

---

## 7. Configuration

### 7.1 Layered config with clear precedence

```
explicit flag > environment variable > project config > user config > system config > default
```

### 7.2 Config file location

Follow XDG Base Directory spec on Linux/macOS:

- User config: `~/.config/mycli/config.yaml` (or `$XDG_CONFIG_HOME/mycli/`)
- Project config: `.mycli.yaml` in the project root (walk up from cwd)

### 7.3 `config` subcommand

Provide `mycli config set`, `mycli config get`, `mycli config list` for inspecting and modifying config without hand-editing files. Show where each value is coming from:

```
$ mycli config list
KEY         VALUE       SOURCE
region      ercot       project config (.mycli.yaml)
api_key     sk-****     env var (MYCLI_API_KEY)
model       breeze-v2   default
```

---

## 8. Robustness

### 8.1 Idempotency

Where possible, make commands idempotent. Running `mycli config set region ercot` twice should not fail or create duplicates.

### 8.2 Signal handling

- **SIGINT** (Ctrl+C): Clean up gracefully. Remove temp files. Print a short message. Exit 130.
- **SIGTERM**: Same as SIGINT.
- **SIGPIPE**: Exit silently (don't print an error when piped output is truncated, e.g., `mycli list | head`).

### 8.3 Atomic writes

When writing output files, write to a temp file first, then rename. Don't leave half-written files on error.

### 8.4 Timeouts

Network operations should have configurable timeouts with sane defaults. Never hang forever.

---

## 9. Distribution & Versioning

### 9.1 Version output

`mycli --version` should print the version and exit. For debug purposes, `mycli --version --verbose` can include commit hash, build date, Go/Rust/Julia version, and OS/arch.

```
$ mycli --version
mycli 0.4.2

$ mycli --version --verbose
mycli 0.4.2 (commit a3f8b2c, built 2025-06-12, julia 1.11.1, linux/amd64)
```

### 9.2 Update checking

Optionally check for updates in the background (never blocking the command). Print a one-line notice if a new version is available:

```
A new version of mycli is available (0.5.0). Run `mycli update` to upgrade.
```

Allow disabling with `MYCLI_NO_UPDATE_CHECK=1`.

---

## 10. Agent & Workflow CLI Patterns

For CLIs that orchestrate multi-step autonomous workflows (e.g., an AI agent running a research cycle):

### 10.1 Make intermediate state legible

Print what the agent is doing at each stage. The user should never wonder "is it stuck?":

```
[1/6] Querying STAC catalog for GOES-16 imagery...
[2/6] Downloading 23 granules (1.2 GB)...
      ████████████████░░░░ 78% (940 MB / 1.2 GB)
[3/6] Running Breeze condensation solver on H100...
[4/6] Evaluating against HRRR baseline...
```

### 10.2 Allow intervention without losing context

Provide `--step` or `--pause-after` flags so users can halt the pipeline at a specific stage, inspect output, and resume:

```
mycli agent run --pause-after download
mycli agent resume --from analysis
```

### 10.3 Structured logs alongside human output

Write detailed structured logs (JSON lines) to a file or `--log-file` while keeping the terminal output clean:

```
mycli agent run --log-file run_20250612.jsonl
```

### 10.4 `status` and `logs` as first-class citizens

For async/long-running operations, always provide:

```
mycli agent status          # current state, elapsed time, ETA
mycli agent logs --follow   # streaming logs, like `docker logs -f`
mycli agent cancel          # graceful cancellation
```

---

## Quick Reference Checklist

When reviewing or building a CLI command, verify:

- [ ] Command follows `noun verb` structure
- [ ] Uses flags over positional args (max 1-2 positional)
- [ ] Has `--help` with at least one realistic example
- [ ] Data goes to stdout, everything else to stderr
- [ ] Supports `--json` for machine-readable output
- [ ] Supports `--quiet` and `--verbose`
- [ ] Respects `NO_COLOR` / `--no-color`
- [ ] Shows progress for operations >1s
- [ ] Error messages explain what, why, and how to fix
- [ ] Suggests corrections on typos
- [ ] Validates all input before doing work
- [ ] Confirms destructive actions (bypassable with `--force`)
- [ ] Supports `--dry-run` for state-changing commands
- [ ] Exits with correct codes (0 success, 1 error, 2 usage error)
- [ ] Handles SIGINT/SIGTERM gracefully
- [ ] Works in non-TTY environments (no hanging prompts)
- [ ] Config follows explicit flag > env var > config file > default
- [ ] Version info available via `--version`

---

## Exemplar CLIs to Study

| CLI | Why it's great |
|-----|---------------|
| `gh` (GitHub) | Excellent noun-verb structure, interactive mode, `--json` with `--jq` |
| `stripe` | Outstanding error messages, `--log-level`, idempotency keys |
| `docker` | Composability, consistent subcommand structure |
| `kubectl` | Resource-oriented, `-o json/yaml/wide`, `--dry-run` modes |
| `fly` (Fly.io) | Great onboarding UX, guided interactive flows |
| `git` | Typo correction, conversational multi-step workflows |
| `npm`/`yarn` | Clear error attribution (your bug vs. theirs), colorful output |

---

## Sources

- [clig.dev](https://clig.dev/) — Command Line Interface Guidelines (Prasad, Firshman, Tashian, Parish)
- [Heroku CLI Style Guide](https://devcenter.heroku.com/articles/cli-style-guide)
- [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46)
- [Atlassian — 10 Design Principles for Delightful CLIs](https://www.atlassian.com/blog/it-teams/10-design-principles-for-delightful-clis)
- [Thoughtworks — CLI Design Guidelines](https://www.thoughtworks.com/en-us/insights/blog/engineering-effectiveness/elevate-developer-experiences-cli-design-guidelines)
- [Lucas F. Costa — UX Patterns for CLI Tools](https://lucasfcosta.com/2022/06/01/ux-patterns-cli-tools.html)
- [Cody A. Ray — CLI Design Best Practices](https://codyaray.com/2020/07/cli-design-best-practices)