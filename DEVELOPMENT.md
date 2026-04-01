# Development Guide

## Architecture

```
CLI (Python)  ──→  Supabase (Postgres + Storage + Auth)  ←──  UI (React)
                              ↑
                     Server (MCP, Claude Agent SDK)
```

- **CLI** talks to Supabase directly via REST API. Used by humans and agents.
- **UI** talks to Supabase directly for data + proxies `/agent` to the server for AI features.
- **Server** provides MCP tools so Claude Code agents can use sonde programmatically.
- **Supabase** is the shared data layer — Postgres with RLS, Auth, and Storage.

## Prerequisites

- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 22+
- Docker (for local Supabase)
- Supabase CLI: `brew install supabase/tap/supabase`

## Full setup

```bash
# 1. Clone and install all packages
git clone git@github.com:aeolus-earth/sonde.git
cd sonde
make setup

# 2. Environment
cp .env.example .env
# Fill in AEOLUS_SUPABASE_URL and AEOLUS_SUPABASE_KEY (ask team lead)

# 3. Local database (optional — for offline dev or integration tests)
supabase start                    # starts local Postgres, Auth, Storage
supabase db reset --local --yes   # apply all migrations + seed data

# 4. Authenticate
cd cli && uv run sonde login      # opens browser for OAuth

# 5. Verify
uv run sonde status               # should show programs
uv run sonde brief                # should show research summary
```

## Environment variables

| Variable | Required | Package | Purpose |
|----------|----------|---------|---------|
| `AEOLUS_SUPABASE_URL` | Yes | CLI, Server | Supabase project URL |
| `AEOLUS_SUPABASE_KEY` | Yes | CLI, Server | Supabase anon (publishable) key |
| `AEOLUS_SUPABASE_SERVICE_ROLE_KEY` | No | CLI (admin) | Service role key for admin ops |
| `AEOLUS_DB_URL` | No | CLI (admin) | Direct Postgres connection string |
| `VITE_SUPABASE_URL` | Yes | UI | Same as `AEOLUS_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Yes | UI | Same as `AEOLUS_SUPABASE_KEY` |
| `SONDE_TOKEN` | Agents only | CLI | Agent auth token (replaces OAuth for bots) |

The CLI also reads `.aeolus.yaml` in the repo root for per-project config (program name, source label).

## Running locally

### CLI only (most common)

```bash
cd cli
uv run sonde <command>
```

### Full stack (UI + Server + CLI)

```bash
# Terminal 1: Local database (optional)
supabase start

# Terminal 2: MCP server
cd server && npm run dev           # listens on port 3001

# Terminal 3: UI
cd ui && npm run dev               # http://localhost:5173 (proxies /agent → :3001)

# Terminal 4: CLI
cd cli && uv run sonde login       # authenticate once
uv run sonde list                  # verify
```

## Testing

```bash
# All packages at once
make test
make lint

# Per-package
cd cli && make check                   # ruff lint + ty typecheck + pytest
cd ui && npm run test                  # vitest
cd server && npm run lint              # tsc --noEmit
```

### Integration tests (against local Supabase)

```bash
supabase start
supabase db reset --local --yes
cd cli && uv run pytest -m integration --tb=short
supabase stop
```

## Database migrations

Migrations live in `supabase/migrations/`. They auto-deploy to production when merged to `main` via GitHub Actions (`deploy.yml`).

### Creating a migration

```bash
# Use timestamp prefix: YYYYMMDDHHMMSS_description.sql
# Example:
cat > supabase/migrations/20260402000001_add_widget_table.sql << 'SQL'
CREATE TABLE widgets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
SQL
```

### Testing locally

```bash
supabase start
supabase db reset --local --yes    # apply all migrations from scratch
supabase stop
```

### Rules
- Never edit an already-deployed migration — add a new one
- Timestamp must be unique — check existing files before naming
- Include `NOTIFY pgrst, 'reload schema';` if you change views or RPC functions
- RLS: use `program = ANY(user_programs())` for program-scoped access

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | PR + push to main | Lint, typecheck, test for CLI + UI + Server; schema integration test |
| `deploy.yml` | Push to main (migrations changed) | `supabase db push` to hosted database |
| Vercel | Push to main (UI changed) | Auto-deploys UI via `vercel.json` |

## Hierarchy reference

```
Program → Project → Direction → Experiment → Finding
                                     ↓
                                  Takeaway (program or project level)
```

Each entity has a headline (one-liner) and optional body (markdown):

| Entity | Headline | Body | ID prefix |
|--------|----------|------|-----------|
| Project | `objective` | `description` | PROJ- |
| Direction | `question` | `context` | DIR- |
| Experiment | `hypothesis` | `content` | EXP- |
| Finding | `topic` | `finding` | FIND- |
| Question | `question` | `context` | Q- |
