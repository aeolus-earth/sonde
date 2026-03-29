# Sonde — Research Experiment Management

Use the `sonde` CLI to log experiments, query research history, and find gaps in the knowledge base. Every experiment you help run should be logged so the team's institutional memory grows.

## Starting a research session

Before doing anything else, pull the current knowledge base and read the brief:

```bash
sonde pull -p <program>          # sync knowledge base to local .sonde/
sonde brief -p <program>         # see what's been tried, what's open, what to work on
```

The brief shows experiment stats, active findings, open questions, parameter coverage, and gaps. Use it to decide what to work on next.

## When to log

- After any simulation run that produces results
- After an analysis that yields a finding or insight
- When the user says "log this", "record this", "save this experiment"
- When you've helped design and run an experiment to completion

## How to log

Gather from the conversation: what was tested (parameters), what happened (results), and what it means (finding). Then call sonde:

```bash
# Quick log — minimum viable record
sonde log --quick -p <program> \
  --params '{"key": "value", ...}' \
  --result '{"metric": value, ...}'

# Full log with finding
sonde log -p <program> \
  --hypothesis "What you expected" \
  --params '{"key": "value"}' \
  --result '{"metric": value}' \
  --finding "What you learned" \
  --tag relevant-tag
```

The `--source` is set automatically from the logged-in user. Git commit, repo, and branch are auto-detected.

## Before starting new work

Always check what's been done before designing a new experiment:

```bash
sonde list -p <program>                   # recent experiments
sonde search --text "topic"               # find relevant prior work
sonde search --param key>value            # filter by parameters
sonde show EXP-0001                       # full detail on one experiment
```

## Adding notes and attachments

After logging, attach relevant outputs and add notes as you go:

```bash
sonde attach EXP-0001 figures/plot.png
sonde attach EXP-0001 output/data.nc
sonde note EXP-0001 "Retried with higher CCN, same saturation pattern"
sonde note EXP-0001 --file analysis-notes.md
```

## Syncing with the knowledge base

Use pull/push to work with local markdown files in `.sonde/`:

```bash
sonde pull -p <program>          # download experiments, findings, questions
sonde push                       # sync local edits back to the database
```

After pulling, you can read and edit files in `.sonde/experiments/` directly. Push syncs your changes back.

## Programs

Experiments are scoped to programs. Use the right one:
- `weather-intervention` — NWP simulations, cloud seeding, boundary layer experiments
- `energy-trading` — market signals, weather-to-energy, agent performance
- `nwp-development` — Breeze.jl development, model validation
- `shared` — cross-cutting knowledge, methods, tools

If `.aeolus.yaml` exists in the repo, the program is set automatically.
