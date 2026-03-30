# Synthetic experiment seed data

Use this to load **many messy, varied experiments** into Supabase for CLI stress testing. Every row is tagged **`seed-synthetic`** (override with `--seed-tag`) so you can filter and clean up later.

## Run

From the repo root, with the same auth as the CLI (`sonde login` or `SONDE_TOKEN`):

```bash
cd cli
uv run python ../dev/scripts/seed_synthetic_experiments.py
```

Options:

| Flag | Effect |
|------|--------|
| `--dry-run` | Print how many rows would be created; no DB writes |
| `--force` | Run even if experiments with the seed tag already exist |
| `--skip-related` | Skip the 5 follow-up rows that set `related[]` |
| `--skip-notes` | Skip `sonde note` subprocesses |
| `--skip-status-mutations` | Skip marking some phase-1 rows `failed` / `superseded` |
| `--seed-tag NAME` | Change the tag merged into every record |

Notes use the `sonde` on your `PATH` by default. Override with `SONDE_BIN=/path/to/sonde` if needed.

## What gets created

- **64** phase-1 experiments across `weather-intervention`, `nwp-development`, `energy-trading`, and `shared` (mixed status, content, legacy fields, tags, sources).
- **5** additional experiments with **`related`** links to earlier IDs (for `sonde show` graph output).
- **Status updates** on selected phase-1 indices: some set to `failed` or `superseded`.
- Up to **12** **`sonde note`** calls on every 7th created ID (unless `--skip-notes`).

## Verification commands

After seeding:

```bash
sonde status
sonde list --tag seed-synthetic
sonde list --tag seed-synthetic --failed
sonde search --text "CCN"
sonde search --text "σ"
sonde brief -p weather-intervention
sonde brief -p nwp-development
sonde tags
sonde recent
sonde show EXP-XXXX   # pick an ID printed by the script that listed related=
```

## Cleanup

The CLI does not expose bulk delete. Remove seed rows in Supabase (SQL or admin) using the tag, or list IDs with `sonde list --tag seed-synthetic --json`.
