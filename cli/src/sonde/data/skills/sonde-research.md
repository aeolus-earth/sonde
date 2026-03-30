# Sonde — Research Experiment Management

Use the `sonde` CLI to log experiments, query research history, and find gaps in the knowledge base. Every experiment you help run should be logged so the team's institutional memory grows.

The CLI follows a noun-verb pattern: `sonde experiment <verb>`. Common verbs have shortcuts: `sonde log` = `sonde experiment log`.

All commands support `--json` for machine-readable output. Always use `--json` when you need to parse the response programmatically.

## Discovery workflow

Start broad, then drill down:

```bash
# 1. Get the big picture
sonde status                          # cross-program overview
sonde brief -p <program>              # stats, findings, open work, gaps
sonde brief -p <program> --json       # structured output for programmatic use
sonde brief --all                     # all programs at once

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
sonde search --param ccn>1000         # parameter filter

# 4. Go deep on one record
sonde show EXP-0001                   # full detail + findings + artifacts + activity
sonde show EXP-0001 --json            # machine-readable with enriched context
sonde show EXP-0001 --graph           # show all connected entities
sonde show FIND-001                   # finding with evidence
sonde show Q-001                      # question with context
sonde show DIR-001                    # direction with experiments
```

Each command shows breadcrumb hints for the next step.

### Enriched JSON output from show

`sonde show EXP-XXXX --json` returns the experiment plus contextual fields:
- `_parent` — parent experiment (if forked)
- `_children` — child experiments
- `_siblings` — other children of the same parent
- `_findings` — findings citing this experiment as evidence
- `_artifacts` — attached files
- `_activity` — recent audit trail entries
- `_suggested_next` — array of `{command, reason}` suggesting what to do next

### Filtering experiments

`sonde list` supports rich filtering:

```bash
sonde list --me                       # my experiments only
sonde list --source human             # prefix match on source
sonde list --tag cloud-seeding        # filter by tag
sonde list --direction DIR-001        # filter by direction
sonde list --since 2026-03-01         # created after date
sonde list --before 2026-03-15        # created before date
sonde list --sort updated             # sort by last modified
sonde list --roots                    # only root experiments (no parent)
sonde list --children-of EXP-0001     # direct children
sonde list --count --open             # just the count
sonde list -n 100 --page 2           # pagination
```

Default: shows open + running + failed. Use `--all` for completed/superseded too.

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
sonde update EXP-0001 -c "New content body"
sonde update EXP-0001 --content-file analysis.md
sonde update EXP-0001 --direction DIR-001
```

Note: `--tag` on update **replaces** all existing tags. To add a single tag without replacing, use `sonde tag add EXP-0001 new-tag`.

## Lifecycle

```bash
sonde start EXP-0001                  # mark as running + claim ownership
sonde close EXP-0001                  # mark as complete
sonde close EXP-0001 --finding "..."  # complete with finding
sonde open EXP-0001                   # reopen
sonde release EXP-0001                # release a stale claim
```

### Git provenance on close

`sonde close` enforces a clean working tree by default. If you have uncommitted changes, it will refuse and suggest a commit message. This ensures every finding has clean code provenance.

```bash
# Commit first, then close
git add -A && git commit -m "EXP-0009: CFL fix with 2x timestep"
sonde close EXP-0009 --finding "Domain doubling causes CFL violation"

# Or force-close with dirty state
sonde close EXP-0009 --force --finding "..."
```

The experiment records both the start commit and the close commit. Later, `git diff <start>..<end>` shows exactly what changed.

### Claim conflicts

`sonde start` claims an experiment. If someone else claimed it:

```bash
sonde start EXP-0001 --json
# Returns: {"started": null, "conflict": {"claimed_by": "codex/task-42", "age_minutes": 15}}

sonde start EXP-0001 --force          # take over the claim
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
sonde tree -p <program> --stale       # flag stale claims
sonde tree -p <program> --leaves      # only leaf nodes
```

### Comparing experiments

```bash
sonde diff EXP-0001 EXP-0002         # side-by-side parameter/result/tag diff
sonde diff EXP-0001 EXP-0002 --json  # structured diff
```

### Housekeeping

```bash
sonde release EXP-0009                # release a stale claim
sonde archive EXP-0001 --dry-run     # preview what would be archived
sonde archive EXP-0001                # mark done subtree as superseded
sonde delete EXP-0042 --confirm       # permanently delete (children re-parented)
sonde health -p <program>             # check for stale claims, dead ends
```

## Findings

Findings are curated insights extracted from experiments. They form the
team's knowledge base — searchable, linkable, and versioned.

```bash
# List current findings
sonde findings -p <program>
sonde finding list -p <program> --json

# Show a finding with evidence
sonde show FIND-001
sonde finding show FIND-001 --json

# Create a new finding directly
sonde finding create -p weather-intervention \
  --topic "CCN saturation" \
  --finding "Enhancement saturates at CCN ~1500" \
  --confidence high \
  --evidence EXP-0001 --evidence EXP-0002

# Extract a finding from an experiment's finding field
sonde finding extract EXP-0001 --topic "CCN saturation"
sonde finding extract EXP-0001 -t "CCN saturation" --confidence high

# Supersede an outdated finding
sonde finding create -p weather-intervention \
  --topic "CCN saturation" \
  --finding "Saturation at ~1200 with spectral bin" \
  --supersedes FIND-001

# Delete a finding (repairs supersession chains)
sonde finding delete FIND-001 --confirm
```

## Questions

Questions track what the team doesn't know yet. They can be promoted to
experiments or research directions when it's time to investigate.

```bash
# List open questions
sonde questions -p <program>
sonde question list -p <program> --json

# Show a question
sonde show Q-001
sonde question show Q-001 --json

# Raise a new question
sonde question create -p weather-intervention "Does spectral bin change the CCN curve?"
sonde question create -p weather-intervention "BL heating interaction?" --tag cloud-seeding

# Promote a question to an experiment (creates an open experiment)
sonde question promote Q-001

# Promote a question to a direction instead
sonde question promote Q-001 --to direction -t "CCN sensitivity"

# Delete a question
sonde question delete Q-001 --confirm
```

## Directions

Directions group experiments into research threads. They answer a guiding
question and track what's been tried vs. what gaps remain.

```bash
# List directions
sonde direction list
sonde direction list -p <program> --json

# Show a direction
sonde show DIR-001
sonde direction show DIR-001 --json

# Create a direction
sonde direction create -p weather-intervention \
  --title "CCN sensitivity" "How does CCN affect precipitation?"

# Update a direction
sonde direction update DIR-001 --status completed
sonde direction update DIR-001 --title "New title" --question "Revised question"

# Delete a direction (clears direction_id on linked experiments)
sonde direction delete DIR-001 --confirm
```

## Programs

Programs are the top-level namespace for research. Create them when starting
a new research area:

```bash
sonde program create weather-intervention --name "Weather Intervention"
sonde program create ccn-study --name "CCN Study" -d "Cloud condensation nuclei research"
sonde program list                    # active programs with stats
sonde program list --all              # include archived
sonde program show <slug>             # stats, details
sonde program update <slug> --name "New Name" --description "New desc"
sonde program archive <slug>          # hide from default views (reversible)
sonde program unarchive <slug>        # bring back
sonde program delete <slug> --confirm <slug>  # permanent, requires repeating ID
```

Current programs:
- `weather-intervention` — NWP simulations, cloud seeding, boundary layer experiments
- `energy-trading` — market signals, weather-to-energy, agent performance
- `nwp-development` — Breeze.jl development, model validation
- `shared` — cross-cutting knowledge, methods, tools

If `.aeolus.yaml` exists in the repo, the program is set automatically.

## Tags

Tags power discovery and filtering. Manage them atomically:

```bash
sonde tags                            # all tags with counts
sonde tags -p <program>               # tags for a specific program

sonde tag add EXP-0001 cloud-seeding  # add without replacing
sonde tag remove EXP-0001 draft       # remove one tag
sonde tag show EXP-0001               # list tags on a record

sonde tag normalize                   # preview duplicate tag cleanup
sonde tag normalize --force           # apply normalization
```

Remember: `sonde update --tag X --tag Y` **replaces** all tags. `sonde tag add` **appends** one tag.

## Adding notes and attachments

```bash
sonde attach EXP-0001 figures/plot.png
sonde attach EXP-0001 report.pdf --type paper
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

## Health and diagnostics

```bash
sonde status                          # cross-program overview (all programs, directions, findings, questions)
sonde status --json                   # structured overview

sonde health -p <program>             # knowledge base health score + issues
sonde health --fixable                # only issues with automated fix commands
sonde health --category experiments   # filter to one category
sonde health --json                   # structured report with all issues

sonde brief -p <program> --gaps       # cross-parameter gap analysis
sonde brief -p <program> --gaps --param ccn --param scheme
```

## Data workflow

When your experiment produces **geospatial output** (NetCDF, Zarr, GeoTIFF):
- Upload to S3, register in STAC catalog, link back to the experiment
- See the `stac-data-workflow` skill for the full pattern

For **non-geospatial files** (figures, CSVs, PDFs, notebooks):
- Use `sonde attach EXP-XXXX file.png`

See `aeolus-conventions` for S3 paths, STAC collections, and naming patterns.
