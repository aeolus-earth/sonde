# Sonde — Research Experiment Management

Use the `sonde` CLI to log experiments, query research history, and find gaps in the knowledge base. Every experiment you help run should be logged so the team's institutional memory grows.

The CLI follows a noun-verb pattern: `sonde experiment <verb>`. Common verbs have shortcuts: `sonde log` = `sonde experiment log`.

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
sonde tree -p <program>               # visualize experiment trees

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

# With parameters from a YAML/JSON file
sonde log -p <program> --params-file run_config.yaml
sonde log -p <program> --params-file config.yaml --result '{"rmse": 2.3}'

# Quick structured log (still works)
sonde log --quick -p <program> \
  --params '{"ccn": 1200, "scheme": "spectral_bin"}' \
  --result '{"precip_delta_pct": 5.8}'

# Open an experiment for later
sonde log --open -p <program> "Test combined BL heating + seeding"
```

The `--source` is set automatically. Git commit, repo, and branch are auto-detected.

## Updating experiments

Use `sonde update` to modify existing experiments without the pull/edit/push cycle:

```bash
sonde update EXP-0001 --status complete --result '{"rmse": 2.3}'
sonde update EXP-0001 --finding "CCN saturates at 1500"
sonde update EXP-0001 --params-file new_config.yaml   # merges with existing params
sonde update EXP-0001 --tag cloud-seeding --tag subtropical
```

## Lifecycle

```bash
sonde start EXP-0001                  # mark as running
sonde close EXP-0001                  # mark as complete
sonde close EXP-0001 --finding "..."  # complete with finding
sonde open EXP-0001                   # reopen
```

## Working with experiment trees

The research tree tracks how experiments branch and evolve. Every command
you already use — brief, show, start, close, fork — includes tree context
to guide your next decision. Follow this loop:

### 1. Read the brief to find work

```bash
sonde brief -p <program> --json
```

The `tree_summary` tells you what needs attention: unclaimed experiments,
dead-end branches, stale claims. Pick something to investigate.

### 2. Show the experiment to understand context

```bash
sonde show EXP-0009 --json
```

Check `_parent` (where this came from), `_children` (what branched from it),
and `_siblings` (what else is happening at this level). If a sibling is
already running the same kind of work, pick something else.

### 3. Claim and start

```bash
sonde start EXP-0009 --json
```

If `conflict` is non-null, someone else claimed it — back off and pick
different work. If null, you own it.

### 4. Commit your code before closing

When you're done with an experiment, commit your work first. `sonde close`
will refuse if you have uncommitted changes — this ensures every finding
has clean code provenance.

```bash
git add -A && git commit -m "EXP-0009: CFL violation fixed with 2x timestep"
```

The experiment records both the creation commit and the close commit.
Ten months later, `git diff <start>..<end>` shows exactly what code
changed during the experiment.

### 5. Do the work, then close with a finding

```bash
sonde close EXP-0009 --finding "Domain doubling causes CFL violation" --json
```

The `suggested_next` array tells you what to do: fork a refinement, try
an alternative, record a formal finding, or review the parent.

### 6. Fork to continue

```bash
sonde fork EXP-0009 --type refinement "Apply 2x time step fix" --json
```

The response includes `siblings` so you can verify you're not duplicating
work. Then `sonde start` the new experiment and repeat from step 4.

### Branch types

- **exploratory** — trying something new
- **refinement** — improving what worked
- **alternative** — different approach to the same problem
- **debug** — diagnosing a failure
- **replication** — re-running to verify

### Tree navigation

```bash
sonde tree DIR-001                    # full picture for a direction
sonde tree EXP-0001                   # subtree from one root
sonde tree -p <program> --active      # only branches being worked on
sonde tree -p <program> --mine        # only my branches
```

### Housekeeping

```bash
sonde release EXP-0009                # release a stale claim
sonde archive EXP-0001                # mark a done subtree as superseded
sonde health -p <program>             # check for stale claims, dead ends
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

## Data workflow

When your experiment produces **geospatial output** (NetCDF, Zarr, GeoTIFF):
- Upload to S3, register in STAC catalog, link back to the experiment
- See the `stac-data-workflow` skill for the full pattern

For **non-geospatial files** (figures, CSVs, PDFs, notebooks):
- Use `sonde experiment attach EXP-XXXX file.png`

See `aeolus-conventions` for S3 paths, STAC collections, and naming patterns.
