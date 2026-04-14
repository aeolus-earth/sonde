# Sonde CLI

Scientific discovery management for the Aeolus research platform.

## Prerequisites

- **Python 3.12+** — check with `python3 --version`
- **uv** (fast Python package manager) — install with:

  ```bash
  # macOS
  brew install uv

  # or any platform
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- **Access to the private repo** — you need GitHub access to `aeolus-earth/sonde`

## Install

**Option A — Install directly from GitHub (recommended):**

```bash
uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@main#subdirectory=cli"
```

**Option B — Clone and develop (recommended for contributors):**

```bash
git clone https://github.com/aeolus-earth/sonde.git
cd sonde/cli
uv sync
```

Then run commands with `uv run sonde <command>`, or activate the virtualenv:

```bash
source .venv/bin/activate
sonde <command>
```

**Option C — Install as a global tool from a local clone:**

```bash
git clone https://github.com/aeolus-earth/sonde.git
cd sonde/cli
uv tool install .
```

## Getting started

```bash
# 1. Authenticate (opens browser for Google OAuth)
sonde login

# 2. Set up IDE integration, skills, and MCP server
sonde setup

# 3. Browse existing research
sonde list
sonde show EXP-0001

# 4. Log an experiment
sonde log --quick -p weather-intervention \
  --params '{"ccn": 1200}' --result '{"delta": 6.3}'

# 5. Search
sonde search --text "spectral bin"
sonde search --param ccn>1000
```

## Troubleshooting

If install or login behaves strangely, first verify which `sonde` binary your shell is using:

```bash
which -a sonde
sonde --version
sonde doctor
```

If you see older login wording or noisy browser-open errors, you are likely running a stale install.
Reinstall the current CLI:

```bash
uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@main#subdirectory=cli"
```

For SSH, VM, or headless shells, `sonde login` now switches to a hosted activation
flow automatically and prints a short code plus a browser URL. The compatibility alias
still works if you want to force that path explicitly:

```bash
sonde login --remote
```

For local desktop troubleshooting, the old localhost callback remains available:

```bash
sonde login --method loopback
```

Keep both `http://localhost:*/callback` and your hosted `/activate/callback`
origin allowlisted in Supabase → Authentication → Redirect URLs.

## Configuration

For per-repo defaults, create `.aeolus.yaml` in your research repo:

```yaml
program: weather-intervention
source: human/yourname
```

Environment variables also work — prefix with `AEOLUS_`:

```bash
export AEOLUS_PROGRAM=weather-intervention
```

Precedence: explicit flag > environment variable > `.aeolus.yaml` > defaults.

## Development

```bash
make install    # uv sync
make test       # pytest
make lint       # ruff check
make format     # ruff format
make check      # lint + type-check + test
```

Or run directly:

```bash
uv sync                          # install deps + dev deps
uv run ruff check src/ tests/    # lint
uv run ruff format src/ tests/   # format
uv run ty check src/             # type check
uv run pytest                    # test
```
