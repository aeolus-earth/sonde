# Sonde — Research Experiment Management

Use the `sonde` CLI to log experiments, query research history, and find gaps in the knowledge base. Every experiment you help run should be logged so the team's institutional memory grows.

## Discovery workflow

Start broad, then drill down:

```bash
# 1. Get the big picture
sonde brief -p <program>              # stats, findings, open work, gaps
sonde brief -p <program> --json       # structured output for programmatic use

# 2. Drill into what's active
sonde list --open -p <program>        # what's queued up
sonde list --running                  # what's in progress
sonde list --complete                 # what's done (shows findings)

# 3. Explore knowledge
sonde findings -p <program>           # current research findings
sonde questions -p <program>          # open research questions
sonde search --text "spectral bin"    # full-text search across all content
sonde search --tag cloud-seeding      # filter by tag

# 4. Go deep on one experiment
sonde show EXP-0001                   # full detail + findings + artifacts + activity
sonde show EXP-0001 --json            # machine-readable with all context
```

Each command shows breadcrumb hints for the next step.

## When to log

- After any simulation run that produces results
- After an analysis that yields a finding or insight
- When the user says "log this", "record this", "save this experiment"
- When you've helped design and run an experiment to completion

## How to log

Experiments are markdown documents. Write what's relevant — hypothesis, method, parameters, results, analysis — in the content body:

```bash
# Content-first (preferred)
sonde log -p <program> "Ran spectral bin at CCN=1200, saw 8% less enhancement"
sonde log -p <program> -f experiment-notes.md
echo "detailed analysis" | sonde log -p <program> --stdin

# Quick structured log (still works)
sonde log --quick -p <program> \
  --params '{"ccn": 1200, "scheme": "spectral_bin"}' \
  --result '{"precip_delta_pct": 5.8}'

# Open an experiment for later
sonde log --open -p <program> "Test combined BL heating + seeding"
```

The `--source` is set automatically. Git commit, repo, and branch are auto-detected.

## Lifecycle

```bash
sonde start EXP-0001                  # mark as running
sonde close EXP-0001                  # mark as complete
sonde close EXP-0001 --finding "..."  # complete with finding
sonde open EXP-0001                   # reopen
```

## Adding notes and attachments

```bash
sonde attach EXP-0001 figures/plot.png
sonde note EXP-0001 "Retried with higher CCN, same saturation pattern"
sonde note EXP-0001 --file analysis-notes.md
```

## Activity tracking

```bash
sonde recent -p <program>             # what happened lately
sonde history EXP-0001                # full audit trail for one record
```

## Syncing with the knowledge base

Use pull/push to work with local markdown files in `.sonde/`:

```bash
sonde pull -p <program>               # download experiments, findings, questions
sonde push                            # sync local edits back to the database
```

After pulling, `.sonde/experiments/` contains one markdown file per experiment. Read and grep these directly — they're the knowledge base.

## Programs

Experiments are scoped to programs. Use the right one:
- `weather-intervention` — NWP simulations, cloud seeding, boundary layer experiments
- `energy-trading` — market signals, weather-to-energy, agent performance
- `nwp-development` — Breeze.jl development, model validation
- `shared` — cross-cutting knowledge, methods, tools

If `.aeolus.yaml` exists in the repo, the program is set automatically.
