# Contributing to Sonde

## Quick setup

```bash
git clone git@github.com:aeolus-earth/sonde.git
cd sonde
make setup
cp .env.example .env    # fill in credentials (ask team lead)
cd cli && uv run sonde login
```

## Development

- **CLI**: `cd cli && make check` (lint + typecheck + test)
- **UI**: `cd ui && npm run dev` (needs server running on port 3001)
- **Server**: `cd server && npm run dev`
- **Local DB**: `supabase start` (requires Docker)
- **All at once**: `make dev` for instructions

## Making changes

1. Create a branch: `git checkout -b feature/your-change`
2. Make changes and add tests
3. Run `make test` and `make lint`
4. Push and open a PR against `main`
5. CI runs automatically — all checks must pass

## Tests that catch bugs

- Use production-shaped fixtures: include pagination, empty rows, large IDs, missing optional fields, and realistic env fallback chains.
- Cover negative auth paths for every new hosted or admin endpoint before adding happy-path tests.
- Assert behavior, not mock round-trips: inspect payloads, state transitions, ordering, and user-visible output.
- Retry tests must prove each retry reads fresh state, not a cached copy from the first attempt.
- Avoid fixed sleeps in Playwright. Prefer locators, URL/load-state waits, or `expect.poll` with a clear condition.
- When a regression escapes, add the smallest local guard that would have failed before the fix.

## Database migrations

- Add SQL files to `supabase/migrations/` with timestamp prefix: `YYYYMMDDHHMMSS_description.sql`
- Migrations auto-deploy to production when merged to `main`
- Test locally first: `supabase db reset --local --yes`
- Never edit an already-deployed migration — add a new one instead

## CLI conventions

- Commands follow `sonde <noun> <verb>` pattern
- All commands support `--json` for machine output
- Errors use three-part format: what happened, why, how to fix
- See `cli/src/sonde/data/skills/sonde-research.md` for the full command reference

## Auth troubleshooting

| Problem | Fix |
|---------|-----|
| "Session expired" | Run `sonde login` to re-authenticate |
| OAuth won't open browser (SSH/remote) | CLI prints a URL — copy it to your local browser |
| Agent auth | Set `SONDE_TOKEN` env var — see [docs/agent-setup.md](docs/agent-setup.md) |
| "Permission denied: ~/.config/sonde" | `sudo chown -R $(whoami) ~/.config/sonde` or `export SONDE_CONFIG_DIR=~/.sonde` |
| "Permission denied" on DB ops | Your program membership may not include that program — check `sonde whoami` |
| "Error connecting" after `sonde login` | Check `.env` has correct `AEOLUS_SUPABASE_URL` |

## Code structure

```
sonde/
├── cli/        Python CLI (Click + Pydantic + Supabase SDK)
├── ui/         React web app (Vite + TailwindCSS + Supabase SDK)
├── server/     MCP server (Claude Agent SDK + TypeScript)
├── supabase/   Database migrations and local config
```

All three packages talk to the same Supabase database. The CLI and UI authenticate independently.
