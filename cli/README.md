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

`sonde login` now uses the hosted activation flow by default and prints a short code
plus a browser URL. The compatibility alias still works if you want to force that path
explicitly:

```bash
sonde login --remote
```

For localhost troubleshooting or local/non-hosted Supabase targets, the old callback
flow remains available explicitly:

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

## Releasing

The version string is derived at build time from the nearest git tag by
[hatch-vcs](https://github.com/ofek/hatch-vcs). Tagged commits become
`0.1.1`; commits between tags become PEP 440 dev versions like
`0.1.1.dev12+g8cf333af3` so bug reports carry an exact SHA.

### Patch releases (the default, fully automatic)

Every successful promotion from `staging` to `main` ships a new patch
release. The chain:

1. `staging` passes its smoke suite.
2. `.github/workflows/promote-main.yml` opens (or updates) the
   "Promote staging to main" PR and enables auto-merge.
3. After the PR merges, `.github/workflows/tag-on-promote.yml` runs on the
   push to `main`. It matches the merge-commit subject
   (`Merge pull request #N from <owner>/staging`), computes the next patch
   tag (the highest existing stable `vN.N.N` tag + 1, or `v0.1.0` if no
   tags exist), and pushes it.
4. The tag push triggers `.github/workflows/release.yml`, which builds the
   wheel + sdist, test-installs **both** and verifies `sonde --version`
   matches, then publishes a GitHub Release with a changelog generated
   from commits since the previous tag.

### Minor / major releases (manual)

Run the `Release` workflow with `workflow_dispatch` and pass the version
(e.g. `0.2.0`). The workflow creates the tag, builds, verifies, and
publishes. A subsequent `tag-on-promote` run for the same version is a
no-op — `release.yml` short-circuits when the release already exists.

### Required secret

`SONDE_PROMOTION_GITHUB_TOKEN` must be set as a repo secret: a fine-grained
GitHub token with `Contents: Read and write` on this repo. Without it,
`tag-on-promote.yml` fails fast (by design) — the default `GITHUB_TOKEN`
cannot chain workflow runs, so tags pushed with it would never trigger
`release.yml`.

### Installing a specific release

```bash
uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@v0.1.1#subdirectory=cli"
```

Installs from `main` (or any untagged commit) will show a dev-version
suffix; installs from a tag will show the clean version.

### Upgrading past the >1000-row ID bug

Versions before the `sonde_next_sequential_id` RPC fix computed the next
`PREFIX-NNNN` ID by pulling every matching row client-side. PostgREST caps
those responses at 1000 rows, so once a table (artifacts first, experiments
and findings next) crossed that threshold, new inserts collided on the PK
and the retry loop looped on the same stale value. The fix uses a Postgres
RPC for O(1) allocation, with a paginated client-side fallback for deploys
that don't yet have the migration applied.

- Users on `@main` auto-update on the next install — just re-run
  `uv tool install --force …@main`.
- Users pinned to a tag should reinstall from the first tag that includes
  the fix:
  `uv tool install --force "git+https://github.com/aeolus-earth/sonde.git@<tag>#subdirectory=cli"`.
- The migration is not strictly required: a post-fix CLI against a
  pre-migration DB logs a one-time WARNING and falls back to the paginated
  scan (correct, just slower on large tables). Apply
  `supabase/migrations/20260415000001_add_next_sequential_id_rpc.sql` to
  get the O(1) server-side path.
