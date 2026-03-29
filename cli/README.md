# Aeolus CLI

Scientific discovery management for the Aeolus research platform.

## Setup

```bash
cd cli
uv sync          # install all dependencies
uv run aeolus    # run the CLI
```

## Development

```bash
uv sync                          # install deps + dev deps
uv run ruff check src/ tests/    # lint
uv run ruff format src/ tests/   # format
uv run pytest                    # test
```

## Configuration

Set these environment variables (or create a `.env` file in the repo root):

```
AEOLUS_SUPABASE_URL=https://your-project.supabase.co
AEOLUS_SUPABASE_KEY=your-api-key
```

For per-repo defaults, create `.aeolus.yaml` in your research repo:

```yaml
program: weather-intervention
source: human/yourname
```

## Quick start

```bash
# Log an experiment
aeolus log --quick -p weather-intervention \
  --params '{"ccn": 1200}' --result '{"delta": 6.3}'

# List experiments
aeolus list

# Show details
aeolus show EXP-0001

# Search
aeolus search --text "spectral bin"
aeolus search --param ccn>1000
```
