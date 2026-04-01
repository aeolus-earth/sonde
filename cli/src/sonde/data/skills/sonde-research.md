# Sonde — Research Experiment Management

Use the `sonde` CLI to log experiments, query research history, and find gaps in
the knowledge base. Every experiment you help run should be logged so the team's
institutional memory grows.

Pattern: `sonde <noun> <verb>`. Shortcuts exist: `sonde log` = `sonde experiment log`.

All commands support `--json` for machine-readable output. Always use `--json`
when you need to parse the response programmatically.

---

## Discovery workflow

Start broad, then drill down.

```bash
# Big picture
sonde status                          # cross-program overview
sonde brief -p <program>              # stats, findings, open work, gaps
sonde brief -p <program> --json       # structured for programmatic use
sonde brief -p <program> --active     # just live context (running, recent)
sonde brief -p <program> --active --json  # slim JSON for agent onboarding
sonde brief --all                     # all programs at once

# What's active
sonde list --open -p <program>        # queued
sonde list --running                  # in progress
sonde list --complete                 # done (shows findings)
sonde tree -p <program>               # visualize experiment trees

# Explore knowledge
sonde findings -p <program>           # current findings
sonde questions -p <program>          # open questions
sonde search --text "spectral bin"    # full-text search
sonde search --tag cloud-seeding      # filter by tag
sonde search --param ccn>1000         # parameter filter

# Go deep
sonde show EXP-0001                   # full detail + findings + artifacts
sonde show EXP-0001 --json            # enriched context (see below)
sonde show EXP-0001 --graph           # all connected entities
sonde show FIND-001 / Q-001 / DIR-001 / PROJ-001  # any entity
```

### Enriched JSON from show

`sonde show EXP-XXXX --json` returns: `_parent`, `_children`, `_siblings`,
`_findings`, `_artifacts`, `_activity`, `_suggested_next` (array of
`{command, reason}`).

### Filtering experiments

```bash
sonde list --me                       # my experiments
sonde list --source human             # prefix match on source
sonde list --tag cloud-seeding        # by tag
sonde list --direction DIR-001        # by direction
sonde list --since 2026-03-01         # created after date
sonde list --before 2026-03-15        # created before date
sonde list --sort updated             # sort by last modified
sonde list --roots                    # only root experiments (no parent)
sonde list --children-of EXP-0001     # direct children
sonde list --count --open             # just the count
sonde list -n 100 --page 2           # pagination
```

Default: open + running + failed. Use `--all` for completed/superseded too.

---

## The thought chain: Program > Project > Direction > Experiment > Finding > Takeaway

| Level | What it is | Example |
|---|---|---|
| **Program** | Top-level research area | `weather-intervention` |
| **Project** | Coherent body of work within a program | "SuperDroplets GPU Port" |
| **Direction** | Research thread answering a guiding question | "Does spectral bin improve accuracy?" |
| **Experiment** | Single test with parameters, method, results | EXP-0164 |
| **Finding** | Atomic, evidence-linked fact from experiments | FIND-042 |
| **Takeaway** | Program- or project-level synthesis | `.sonde/takeaways.md` or per-project |

Work flows down (programs contain projects contain directions contain experiments).
Knowledge flows up (experiments produce findings, findings feed takeaways).

### Field naming convention

Each entity has a *headline* (one-liner, shown in list views) and optionally a
*body* (markdown detail, shown in show/brief):

| Entity | Headline field | Body field | Status values |
|--------|---------------|------------|---------------|
| Project | `objective` | `description` | proposed, active, paused, completed, archived |
| Direction | `question` | `context` | proposed, active, paused, completed, abandoned |
| Experiment | `hypothesis` | `content` | open, running, complete, failed, superseded |

---

## How to log

The markdown body is the primary vehicle. Legacy fields (`--hypothesis`,
`--params`, `--result`) still work but are secondary.

```bash
# Content-first (preferred)
sonde log -p <program> "## Objective
Test CCN=1500 with spectral bin microphysics at 25km resolution.

## Method
Modified run_config.yaml: scheme=spectral_bin, ccn=1500, domain=ERCOT.
Submitted via sbatch with 4 A100 GPUs.

## Expected
Enhancement should drop below 10% based on prior CCN sweep."

# From file or stdin
sonde log -p <program> -f experiment-notes.md
echo "detailed analysis" | sonde log -p <program> --stdin

# With params from YAML/JSON
sonde log -p <program> --params-file run_config.yaml
sonde log -p <program> --params-file config.yaml --result '{"rmse": 2.3}'

# Structured fields (still supported)
sonde log --quick -p <program> \
  --params '{"ccn": 1500, "scheme": "spectral_bin"}' \
  --result '{"precip_delta_pct": 5.8}'

# Structured metadata: reproducibility, environment
sonde log -p <program> --repro "python run.py --config cfg.yaml"
sonde fork EXP-0001 --env CUDA_VERSION=12.0

# Open for later
sonde log --open -p <program> "Test combined BL heating + seeding"
```

`--source` is set automatically. Git commit, repo, and branch are auto-detected.

### When to log

- After any simulation run that produces results
- After an analysis that yields a finding or insight
- When the user says "log this", "record this", "save this experiment"
- When you've helped design and run an experiment to completion

---

## What makes a good experiment

### Experiment log

- Clear objective with expected outcome
- Specific parameters (not "some config changes")
- Method (what you actually did, reproducibly)
- References prior work (parent experiment, related findings)

**Bad:** `Tested some CCN values with the new scheme.`

**Good:**
```
## Objective
Test CCN=1500 with spectral bin microphysics at 25km resolution.
## Method
Modified run_config.yaml: scheme=spectral_bin, ccn=1500, domain=ERCOT.
Submitted via sbatch with 4 A100 GPUs. Based on EXP-0158 (saturation at CCN=1200).
## Expected
Enhancement should drop below 10% based on prior sweep (EXP-0142 through EXP-0158).
```

### Finding

Findings must be: quantitative, specific, reproducible, evidence-linked.

```
Bad:  "CCN affects precipitation"
Good: "CCN=1500 shows 8.2% less precipitation enhancement (5.8% vs 13.6%)
       across 3 independent runs with spectral bin microphysics at 25km resolution"
```

### Takeaway

Takeaways must: synthesize (not restate), connect to program objective, state next step.

```
Bad:  "Tested CCN levels"
Good: "CCN saturates at ~1500 across all 3 schemes. The effect is robust --
       enhancement drops from 13.6% to 5.8% above threshold. Next: test whether
       BL heating interaction shifts the saturation point."
```

---

## Updating experiments

Modify existing experiments without pull/edit/push:

```bash
sonde update EXP-0001 --finding "CCN saturates at 1500"
sonde update EXP-0001 -c "Updated analysis with new data"
sonde update EXP-0001 --content-file analysis.md
sonde update EXP-0001 --params '{"k": "v"}'  # merges, does NOT replace
sonde update EXP-0001 --params-file new_config.yaml
sonde update EXP-0001 --result '{"rmse": 2.3}'
sonde update EXP-0001 --direction DIR-001
sonde update EXP-0001 --evidence EXP-0002
sonde update EXP-0001 --blocker "waiting for GPU allocation"
sonde update EXP-0001 --status complete
sonde update EXP-0001 --tag cloud-seeding --tag subtropical  # replaces ALL tags!
```

**Important:** `--tag` on update **replaces** all existing tags. To append, use
`sonde tag add EXP-0001 new-tag`.

---

## Lifecycle

```bash
sonde start EXP-0001                  # mark running + claim ownership
sonde close EXP-0001                  # mark complete
sonde close EXP-0001 --finding "..."  # complete with finding
sonde close EXP-0001 --finding "ADA dispatch is 60% host compile" \
  --takeaway "Host compile dominates. Next: test warm cache path."
sonde open EXP-0001                   # reopen
sonde release EXP-0001                # release a stale claim
```

### Close with finding + takeaway

The fast path. One command: finding goes to DB, takeaway goes to brief.

```bash
sonde close EXP-0164 --finding "ADA dispatch is 60% host compile" \
  --takeaway "Host compile dominates. Next: test warm cache path."
```

Always use `--finding` when there is something to report. Add `--takeaway` when
the finding changes program-level understanding.

### Git provenance

`sonde close` enforces a clean working tree by default. Commit first:

```bash
git add -A && git commit -m "EXP-0009: CFL fix with 2x timestep"
sonde close EXP-0009 --finding "Domain doubling causes CFL violation"

# Or force-close with dirty state
sonde close EXP-0009 --force --finding "..."
```

The experiment records start and close commits. `git diff <start>..<end>` shows
exactly what changed.

### Claim conflicts

```bash
sonde start EXP-0001 --json
# Returns: {"started": null, "conflict": {"claimed_by": "codex/task-42", "age_minutes": 15}}
sonde start EXP-0001 --force          # take over
```

---

## Working with experiment trees

Trees track how experiments branch and evolve. The standard loop:

1. `sonde brief -p <program> --json` -- find work via `tree_summary`
2. `sonde show EXP-0009 --json` -- check `_parent`, `_children`, `_siblings`
3. `sonde start EXP-0009 --json` -- claim (back off if `conflict` is non-null)
4. `git commit` -- commit code before closing
5. `sonde close EXP-0009 --finding "..." --json` -- `suggested_next` tells you what's next
6. `sonde fork EXP-0009 --type refinement "Apply fix" --json` -- continue the thread

### Branch types

- **exploratory** -- trying something new
- **refinement** -- improving what worked
- **alternative** -- different approach to same problem
- **debug** -- diagnosing a failure
- **replication** -- re-running to verify

### Tree navigation

```bash
sonde tree DIR-001                    # full picture for a direction
sonde tree EXP-0001                   # subtree from one root
sonde tree -p <program> --active      # branches being worked on
sonde tree -p <program> --mine        # my branches
sonde tree -p <program> --stale       # flag stale claims
sonde tree -p <program> --leaves      # leaf nodes only
```

### Comparing and housekeeping

```bash
sonde diff EXP-0001 EXP-0002         # side-by-side param/result/tag diff
sonde diff EXP-0001 EXP-0002 --json  # structured diff
sonde release EXP-0009                # release a stale claim
sonde archive EXP-0001 --dry-run     # preview archival
sonde archive EXP-0001                # mark done subtree as superseded
sonde delete EXP-0042 --confirm       # permanently delete (children re-parented)
```

---

## Findings

Curated insights from experiments. Searchable, linkable, versioned.

```bash
sonde findings -p <program>
sonde finding list -p <program> --json
sonde show FIND-001
sonde finding show FIND-001 --json

# Create directly
sonde finding create -p weather-intervention \
  --topic "CCN saturation" \
  --finding "Enhancement saturates at CCN ~1500" \
  --confidence high \
  --evidence EXP-0001 --evidence EXP-0002

# Extract from experiment
sonde finding extract EXP-0001 --topic "CCN saturation"
sonde finding extract EXP-0001 -t "CCN saturation" --confidence high

# Supersede
sonde finding create -p weather-intervention \
  --topic "CCN saturation" \
  --finding "Saturation at ~1200 with spectral bin" \
  --supersedes FIND-001

sonde finding delete FIND-001 --confirm  # repairs supersession chains
```

Every finding should be: **quantitative** (numbers, not direction),
**specific** (names parameters, conditions), **reproducible** (linked to
experiments with method), **evidence-linked** (`--evidence`).

---

## Takeaways

Running synthesis of what the program has learned. Update **every time you
close an experiment**.

```bash
sonde takeaway "CCN saturates at ~1500 across all schemes. Next: BL heating."
sonde takeaway -f synthesis.md
sonde takeaway --show                 # view current
sonde takeaway --replace "Fresh consolidated summary"
```

Takeaways appear at the top of `sonde brief`. They are the first thing the next
agent or human reads.

### When to update

- After closing with a meaningful finding
- After superseding a finding (old narrative may be wrong)
- When starting a new direction (state why the pivot happened)
- When consolidating: `--replace` with a fresh synthesis

### Takeaways vs findings

| | Finding | Takeaway |
|---|---------|----------|
| Scope | Single fact | Program-level synthesis |
| Example | "CCN=1500 shows 8% less enhancement" | "Confirmed CCN saturation. Threshold ~1500. Next: BL heating." |
| Storage | Database (syncs everywhere) | Local `.sonde/takeaways.md` |
| Appears in | `sonde findings` | `sonde brief` |

---

## Questions and directions

### Questions

Track what the team doesn't know yet. Promote to experiments or directions.

```bash
sonde questions -p <program>
sonde question list -p <program> --json
sonde show Q-001
sonde question create -p weather-intervention "Does spectral bin change the CCN curve?"
sonde question create -p weather-intervention "BL heating interaction?" --tag cloud-seeding
sonde question promote Q-001                      # promote to experiment
sonde question promote Q-001 --to direction -t "CCN sensitivity"  # to direction
sonde question delete Q-001 --confirm
```

### Directions

Group experiments into research threads with a guiding question.

```bash
sonde direction list -p <program> --json
sonde show DIR-001

# Create with context (explain WHY this direction matters)
sonde direction create -p weather-intervention \
  "Does spectral bin improve accuracy?" \
  --title "Spectral bin approach" \
  --context "Prior work showed 8% improvement at CCN=1500. Need systematic comparison across schemes."

sonde direction update DIR-001 --status completed
sonde direction update DIR-001 --title "New title" --question "Revised question"
sonde direction update DIR-001 --context "Updated motivation text"
sonde direction delete DIR-001 --confirm  # clears direction_id on linked experiments
```

The `--context` field explains prior work, motivation, constraints. Agents use
it to decide whether an experiment belongs in this direction.

---

## Projects

Group related directions into a coherent body of work within a program. Use for
work with a clear objective and boundary -- a port, a validation campaign, a
model comparison study.

```bash
sonde project list -p <program>
sonde project list -p <program> --json
sonde project show PROJ-001
sonde project show PROJ-001 --json

# Create with objective (one-liner) and description (detailed markdown)
sonde project create "SuperDroplets GPU Port" \
  --objective "Port microphysics to GPU" \
  -p <program>
sonde project create "CCN Sensitivity" \
  --objective "Map CCN parameter space" \
  --description-file motivation.md \
  -p <program>

# Update
sonde project update PROJ-001 --objective "Updated scope"
sonde project update PROJ-001 --description-file updated_motivation.md
sonde project update PROJ-001 --status completed

# Project-level brief (scoped summary with directions, experiments, findings)
sonde project brief PROJ-001
sonde project brief PROJ-001 --json

# Project takeaways (scoped synthesis, separate from program takeaways)
sonde takeaway --project PROJ-001 "Confirmed GPU port viable for spectral bin"
sonde takeaway --project PROJ-001 --show

# Organize records into projects
sonde project attach PROJ-001 DIR-001 DIR-002 EXP-0042
sonde project detach DIR-001
sonde project adopt PROJ-001 --direction DIR-001
sonde project delete PROJ-001 --confirm
```

---

## Notes and attachments

### Notes

Lab notebook entries on experiments, directions, or projects. When experiment
notes accumulate without a finding, you'll be nudged to distill the key result.

```bash
# Experiment notes (most common)
sonde note EXP-0001 "Retried with higher CCN, same saturation pattern"
sonde note EXP-0001 --file observations.md

# Direction notes (method rationale, scope changes)
sonde note DIR-001 "Narrowing scope to mid-latitude storms only"

# Project notes (strategic decisions, stakeholder context)
sonde note PROJ-001 "Stakeholder feedback: focus on 48h forecast horizon"

# Focused experiment: omit ID to use focused experiment
sonde note "Observation about CCN response"
```

### Attachments

**Always describe what you attach.** Descriptions appear as captions in the UI.
Accepts EXP-*, DIR-*, or PROJ-* IDs.

```bash
# Experiment attachments
sonde attach EXP-0001 figures/plot.png -d "Precip anomaly, CCN=1200"
sonde attach EXP-0001 report.pdf --type paper -d "Final analysis report"
sonde attach EXP-0001 profiling_artifacts/        # entire directory

# Direction attachments (literature, method docs)
sonde attach DIR-001 literature_review.pdf --type paper -d "Prior work survey"

# Project attachments (architecture, stakeholder decks)
sonde attach PROJ-001 architecture.pdf --type report -d "System design overview"

# Describe after attaching
sonde artifact list EXP-0001 --json
sonde artifact update ART-0001 -d "Structured timing breakdown from nsight-compute"
sonde artifact update ART-0002 -d "Raw watchdog stdout from GPU profiling run"
```

Descriptions are searchable, shown as captions, and readable by agents via
`sonde artifact list`. Figures without context are useless.

---

## Focus and handoff

### Focus

Set a default experiment for your session. Eliminates repetitive typing.

```bash
sonde focus EXP-0164              # set default
sonde unfocus                     # clear
```

When focused, commands that take an experiment ID use the focused one if you
don't specify. E.g., `sonde note "observation"` instead of `sonde note EXP-0164 "observation"`.

### Handoff

Generate everything the next agent needs: state, direction, notes, artifacts,
next actions.

```bash
sonde handoff EXP-0164            # human-readable handoff summary
sonde handoff --json              # structured for programmatic consumption
```

Use when: session ends but experiment isn't closed, different agent will
continue, or you want a checkpoint summary.

---

## Tags

```bash
sonde tags                            # all tags with counts
sonde tags -p <program>               # tags for a program
sonde tag add EXP-0001 cloud-seeding  # append one tag
sonde tag remove EXP-0001 draft       # remove one tag
sonde tag show EXP-0001               # list tags on a record
sonde tag normalize                   # preview duplicate cleanup
sonde tag normalize --force           # apply normalization
```

Remember: `sonde update --tag` **replaces** all tags. `sonde tag add` **appends**.

---

## Takeaways

Running synthesis -- the "so what" connecting findings into a narrative.
Update after every experiment close.

```bash
# Program-level (default)
sonde takeaway "CCN saturates at ~1500. Next: BL heating interaction."
sonde takeaway --show
sonde takeaway --replace "Fresh consolidated summary"
sonde takeaway -f synthesis.md

# Project-level (scoped)
sonde takeaway --project PROJ-001 "GPU port confirmed viable for spectral bin"
sonde takeaway --project PROJ-001 --show
```

Takeaways sync to DB automatically via `sonde push`. Use `--project` to scope
to a specific project instead of the whole program.

---

## Activity tracking

```bash
sonde recent -p <program>             # what happened lately
sonde history EXP-0001                # full audit trail for one record
```

---

## Syncing with the knowledge base

```bash
sonde pull -p <program>               # download experiments, findings, questions
sonde push                            # sync local edits back to database
```

After pulling, `.sonde/experiments/` contains one markdown file per experiment.
Read and grep these directly -- they're the knowledge base.

---

## Health and diagnostics

```bash
sonde status                          # cross-program overview
sonde status --json                   # structured overview
sonde health -p <program>             # health score + issues
sonde health --fixable                # issues with automated fix commands
sonde health --category experiments   # filter to one category
sonde health --json                   # structured report
sonde brief -p <program> --gaps       # cross-parameter gap analysis
sonde brief -p <program> --gaps --param ccn --param scheme
```

---

## Data workflow

**Geospatial output** (NetCDF, Zarr, GeoTIFF): upload to S3, register in STAC,
link to experiment. See `stac-data-workflow` skill.

**Non-geospatial files** (figures, CSVs, PDFs, notebooks): `sonde attach EXP-XXXX file.png`

See `aeolus-conventions` for S3 paths, STAC collections, naming patterns.

---

## Programs

Top-level namespace for research.

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
- `weather-intervention` -- NWP simulations, cloud seeding, boundary layer experiments
- `energy-trading` -- market signals, weather-to-energy, agent performance
- `nwp-development` -- Breeze.jl development, model validation
- `shared` -- cross-cutting knowledge, methods, tools

If `.aeolus.yaml` exists in the repo, the program is set automatically.
