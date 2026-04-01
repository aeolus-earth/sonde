# Sonde Formatter — Structure, Enrich, and Close Experiment Records

Use this skill when experiment results need to be properly formatted, enriched with metadata, and closed cleanly. This covers the gap between "the run finished" and "the knowledge base accurately reflects what happened."

Typical triggers:
- "Format my recent experiments"
- "Clean up EXP-0042"
- "Make sure the metadata is right on my latest runs"
- "Link my output data to the experiment"
- "Close this experiment with results"

## Core principle: content first

The `content` field (markdown body) is the primary vehicle for experiment records. It is what humans and agents read, what full-text search indexes, and what `sonde show` displays. Legacy structured fields (`hypothesis`, `parameters`, `results`, `finding`) still work and power specific search/filter axes, but the content body is where the real record lives.

Write content as if a colleague — or an agent six months from now — needs to reproduce or build on this work without asking you any questions.

## The formatting workflow

### 1. Assess what exists

Start by reading the experiment as-is:

```bash
sonde show EXP-XXXX --json
```

Check:
- Does it have **content**? (the markdown body — the most important field)
- Does it have **tags**? (critical for searchability)
- Does it have a **finding**? (if status is complete, it should)
- Does it have **data linked**? (check for `has-data` tag or `metadata.stac_items`)
- Is the **status** correct? (running but actually finished? open but already done?)
- Does it have structured metadata? (`repro`, `evidence`, `blocker`, `env_vars`)
- Does it have a **project link**? (check `project_id` -- orphan experiments are hard to find later)

### 2. Enrich with `sonde update`

The preferred way to enrich experiments is `sonde update`. Do not pull/edit/push — update directly:

```bash
# Set the content body (the most important update)
sonde update EXP-0001 -c "## Objective\nTest CCN=1500 saturation threshold\n\n## Method\nSpectral bin, 25km, North Atlantic"

# Or from a markdown file (better for longer content)
sonde update EXP-0001 --content-file analysis.md

# Record the finding
sonde update EXP-0001 --finding "CCN=1500 shows 8.2% less precipitation enhancement (5.8% vs 13.6%)"

# Set structured parameters (merges with existing)
sonde update EXP-0001 --params '{"ccn": 1500, "scheme": "spectral_bin"}'

# Set status
sonde update EXP-0001 --status complete
```

All flags can be combined in a single call:

```bash
sonde update EXP-0001 \
  --content-file analysis.md \
  --finding "CCN=1500 saturates enhancement" \
  --params '{"ccn": 1500}' \
  --tag spectral-bin --tag north-atlantic --tag 25km
```

### 3. Structure the content body

Good experiment content follows this template. Adapt to what is relevant — not every section applies to every experiment — but these sections make records searchable, reproducible, and useful to future agents:

```markdown
## Objective
What you're testing and why.
Reference the finding or question that motivated it.

## Method
What you did. Commands, configs, hardware. Be reproducible.
- Model: Breeze v2.1 / WRF 4.5 / etc.
- Domain: North Atlantic, 25km horizontal, 50 vertical levels
- Period: 2026-03-15 00:00Z to 2026-03-17 00:00Z (48h)
- Key parameters: CCN=1500, scheme=spectral_bin
- Code: branch `feature/spectral-bin` @ commit f7a2c1d

## Results
What happened. Numbers, not narratives.
- Precipitation enhancement: 5.8% (vs 13.6% with bulk at same CCN)
- Domain-mean temperature bias: -0.3K
- Spinup time: 6h

## Interpretation
What it means. Connect to prior work.
Does it support, contradict, or extend prior findings?

## Data
Where the output lives:
- S3: `s3://aeolus-data/experiments/EXP-XXXX/output.zarr`
- STAC: `nwp-simulations/EXP-XXXX-output`
- Load: `xr.open_zarr("s3://aeolus-data/experiments/EXP-XXXX/output.zarr")`
```

**The first line of content matters most.** It is what appears in `sonde list`, `sonde search`, and `sonde brief`. A first line like "Spectral bin CCN=1500, 8% less enhancement than bulk" is findable. A first line like "Run 3" is not.

### 4. Set structured metadata fields

These fields live in the experiment's metadata dict and power specific workflows:

```bash
# Reproducibility — exact command to re-run
sonde update EXP-0001 --repro "python run_sim.py --config configs/spectral_1500.yaml"

# Evidence — supporting files or experiment IDs
sonde update EXP-0001 --evidence EXP-0002 --evidence EXP-0003

# Blockers — what is preventing progress
sonde update EXP-0001 --blocker "waiting for GPU allocation"

# Environment capture — key env vars for reproducibility
sonde update EXP-0001 --env CUDA_VERSION=12.0 --env NCCL_VERSION=2.18.1
```

When to use each:
- `--repro`: Always, if there is a single command that reproduces the experiment. Agents use this for re-runs.
- `--evidence`: When results depend on or reference other experiments. Builds the evidence graph.
- `--blocker`: For open/running experiments that are stuck. Shows up in `sonde brief` so the team sees bottlenecks.
- `--env`: When the runtime environment matters for reproducibility (GPU driver, library version, etc.).

### 5. Set tags

Tags power filtering and discovery. Check what exists first:

```bash
sonde tags -p <program>
```

Apply tags from these categories:
- **Domain:** `north-atlantic`, `subtropical`, `pacific`, `gulf-of-mexico`, `global`
- **Method:** `cloud-seeding`, `bl-heating`, `ice-nucleation`, `sensitivity-study`
- **Scheme:** `bulk-2moment`, `spectral-bin`, `morrison`, `thompson`
- **Scale:** `3km`, `10km`, `25km`
- **Data:** `has-data` (if output is registered in STAC)
- **Quality:** `baseline` (reference run), `needs-review`
- **Status:** `stale` (no activity, needs attention)

```bash
# Replace all tags at once (overwrites existing tags):
sonde update EXP-XXXX --tag cloud-seeding --tag spectral-bin --tag north-atlantic --tag 25km

# Or add/remove tags incrementally (preserves existing tags):
sonde tag add EXP-XXXX cloud-seeding
sonde tag add EXP-XXXX spectral-bin
sonde tag remove EXP-XXXX draft
```

### 6. Record the finding

If the experiment is complete, extract the key insight as a single sentence:

```bash
sonde update EXP-XXXX --finding "Spectral bin produces 8% less precipitation enhancement than bulk at CCN=1200 over maritime Cu domain"
```

**Quality matters.** The finding field is indexed separately and appears in briefs and search results. Vague findings waste everyone's time:

```
Bad:   "CCN affects precipitation"
Good:  "CCN=1500 shows 8.2% less precipitation enhancement (5.8% vs 13.6%)"

Bad:   "Model runs faster"
Good:  "60% of wall time is host-side compile; GPU utilization peaks at 34%"

Bad:   "Results are inconclusive"
Good:  "No significant difference at CCN=1200 (p=0.23); need CCN>1500 to separate signals"
```

A good finding is:
- One sentence, self-contained (makes sense without reading the full experiment)
- Quantitative when possible ("8% less" not "less")
- Specific about conditions ("at CCN=1200 over maritime Cu" not "in some cases")
- Honest about negative or inconclusive results

### 7. Close the experiment

Use `sonde close` when the experiment is done. Include the finding and a takeaway in one step:

```bash
# Simple close
sonde close EXP-0001

# Close with finding
sonde close EXP-0001 --finding "CCN saturates at 1500"

# Close with finding + program-level takeaway
sonde close EXP-0001 \
  --finding "60% host compile" \
  --takeaway "Host dominates wall time; next: warm cache."
```

The `--takeaway` flag appends to `.sonde/takeaways.md`, the program-level synthesis that appears in `sonde brief`. Takeaways connect individual findings into a narrative:

```
Finding:  "CCN=1500 shows 8.2% less enhancement"
Takeaway: "Enhancement saturates around CCN=1500. Spectral bin confirms this.
           Next: test BL heating as an alternative forcing mechanism."
```

After close, `sonde close` will suggest promoting the finding to a curated Finding record:

```bash
sonde finding extract EXP-0001 --topic "CCN saturation"
```

### 8. Link to data

If the experiment produced geospatial output (NetCDF, Zarr):

1. Upload to S3 following the path convention:
   ```bash
   aws s3 cp output/ s3://aeolus-data/experiments/EXP-XXXX/ --recursive
   ```

2. Register in STAC (see `stac-data-workflow` skill for the full process)

3. Tag the experiment and update metadata:
   ```bash
   sonde tag add EXP-XXXX has-data
   ```

4. Add the S3 path and load snippet to the content's Data section so future agents can find and load it without querying STAC.

If the experiment produced small files (figures, CSVs, PDFs):

```bash
sonde attach EXP-XXXX figures/precip_map.png
sonde attach EXP-XXXX diagnostics/timeseries.csv
```

### 9. Link to related records

Connect the experiment to the knowledge graph:

```bash
# Link to related experiments
sonde update EXP-XXXX --related EXP-0039,EXP-0041

# Fork a new experiment from an existing one
sonde fork EXP-0001 --type refinement "Increase CCN to 1800"
sonde fork EXP-0001 --params '{"ccn": 1800}'

# Add a note (timestamped annotation)
sonde note EXP-XXXX "Motivated by Q-003: does spectral bin change CCN response?"
sonde note EXP-XXXX "Supports FIND-001 (CCN saturation) — consistent threshold at 1200-1500"
```

### 10. Verify the record

After formatting, verify everything looks right:

```bash
sonde show EXP-XXXX
```

Check:
- Content body is clear and searchable (Objective, Method, Results, Interpretation)
- Tags cover domain, method, scheme, scale
- Finding is a self-contained sentence (if complete)
- Structured metadata is set (repro, evidence, env where applicable)
- Data is linked (has-data tag, S3 paths in content)
- Related experiments are connected
- Status matches reality

## Batch formatting

When formatting multiple experiments (e.g., after a parameter sweep):

```bash
# List recent complete experiments that might need formatting
sonde list --complete -p <program> -n 10

# Check each one
sonde show EXP-XXXX --json | python -c "
import json, sys
e = json.load(sys.stdin)
issues = []
if not e.get('content'): issues.append('no content')
if not e.get('tags'): issues.append('no tags')
if not e.get('finding') and e['status'] == 'complete': issues.append('no finding')
if 'has-data' not in (e.get('tags') or []): issues.append('no data linked')
meta = e.get('metadata', {})
if not meta.get('repro_command'): issues.append('no repro')
if issues: print(f\"{e['id']}: {', '.join(issues)}\")
else: print(f\"{e['id']}: OK\")
"
```

For each experiment with issues, apply the formatting workflow above. Use `sonde update` for each fix — do not batch unrelated changes into one call.

## Complete example: formatting a raw experiment

Before (experiment logged quickly during a run):

```bash
sonde log -p weather-intervention "Ran spectral bin at CCN=1200"
# Creates EXP-0042 with minimal content
```

After (properly formatted with `sonde update`):

```bash
# 1. Add structured content
sonde update EXP-0042 --content-file - <<'EOF'
## Objective
Test whether spectral bin microphysics changes CCN sensitivity
relative to bulk 2-moment at CCN=1200. Motivated by FIND-001
(CCN saturation with bulk scheme).

## Method
- Model: WRF 4.5, spectral bin microphysics
- Domain: North Atlantic, 25km horizontal, 50 vertical levels
- Period: 2026-03-15 00:00Z to 2026-03-17 00:00Z (48h)
- CCN: 1200 cm-3
- Baseline: EXP-0039 (bulk 2-moment, same domain/period/CCN)

## Results
- Precipitation enhancement: 5.8% (vs 13.6% with bulk at same CCN)
- Domain-mean temperature bias: -0.3K
- Spinup time: 6h (same as bulk)

## Interpretation
Spectral bin produces substantially less enhancement (8% less) than
bulk at the same CCN. Consistent with FIND-001 saturation hypothesis
but the threshold appears lower with spectral bin. Need to test
CCN=1500 with spectral bin to confirm.

## Data
- S3: `s3://aeolus-data/experiments/EXP-0042/output.zarr`
- Load: `xr.open_zarr("s3://aeolus-data/experiments/EXP-0042/output.zarr")`
EOF

# 2. Set structured fields
sonde update EXP-0042 \
  --finding "Spectral bin produces 8% less precipitation enhancement than bulk at CCN=1200 over maritime Cu domain" \
  --params '{"ccn": 1200, "scheme": "spectral_bin", "resolution_km": 25}' \
  --tag spectral-bin --tag north-atlantic --tag 25km --tag has-data \
  --repro "python run_sim.py --config configs/spectral_1200.yaml" \
  --evidence EXP-0039 \
  --env CUDA_VERSION=12.0

# 3. Close with takeaway
sonde close EXP-0042 \
  --takeaway "Spectral bin confirms CCN saturation but at lower threshold. Next: test CCN=1500 with spectral bin."
```

## What NOT to do

- **Don't fabricate results.** If the experiment content doesn't mention a specific number, don't invent one for the finding. Use what's there.
- **Don't change scientific meaning.** Restructure and clarify, but don't reinterpret results. If the author said "inconclusive," don't upgrade that to a positive finding.
- **Don't merge experiments.** Each experiment is its own record. If two experiments are related, link them with `--related` or `sonde fork`, don't combine their content.
- **Don't delete content.** Add structure (headings, lists), but keep all original information. It's fine to reorganize; it's not fine to drop details.
- **Don't guess the program.** If `.aeolus.yaml` has a program, use it. If not, ask.
- **Don't skip the finding.** Every completed experiment should have a finding, even if it's a negative result.

## Full-text search and why structure matters

Postgres full-text search indexes the content body. When someone runs `sonde search --text "spectral bin CCN"`, the search hits:
- The content body (most weight — Objective, Method, Results, Interpretation)
- The finding field (separate indexed column)

Structured content with clear sections makes search more precise. An experiment with "CCN=1200" in a Method section and "8% less enhancement" in a Results section is more findable than one that buries both in a paragraph.

Tags add another discovery axis. An agent running `sonde list --tag spectral-bin --complete` finds all completed spectral bin experiments instantly — no text search needed.

Parameters add a third axis. `sonde search --param ccn=1200` finds experiments by structured parameter values, regardless of how the content is written.

## STAC metadata quality

When registering data in STAC, get these right — they power spatial and temporal discovery:

- **geometry:** Accurate domain polygon, not a rough guess. Extract from the model config or coordinate arrays.
- **datetime:** Use the actual simulation period, not the run date. Format as ISO 8601 range: `"2026-03-15T00:00:00Z/2026-03-17T00:00:00Z"`
- **properties.experiment_id:** Must match the sonde experiment ID exactly.
- **properties.model:** The model name and version (e.g., `breeze-v2.1`).
- **properties.resolution:** Horizontal resolution as a string (e.g., `25km`).
- **assets:** One entry per distinct output file. Use descriptive titles, not filenames.

Bad STAC metadata is worse than no STAC metadata — it makes people find the wrong data.
