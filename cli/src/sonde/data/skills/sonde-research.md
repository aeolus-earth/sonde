# Sonde — Research Experiment Management

Use the `sonde` CLI to log experiments, query research history, and find gaps in the knowledge base. Every experiment you help run should be logged so the team's institutional memory grows.

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

## Programs

Experiments are scoped to programs. Use the right one:
- `weather-intervention` — NWP simulations, cloud seeding, boundary layer experiments
- `energy-trading` — market signals, weather-to-energy, agent performance
- `nwp-development` — Breeze.jl development, model validation
- `shared` — cross-cutting knowledge, methods, tools

If `.aeolus.yaml` exists in the repo, the program is set automatically.

## Attaching files

After logging, attach relevant outputs:

```bash
sonde attach EXP-0001 figures/plot.png
sonde attach EXP-0001 output/data.nc
```
