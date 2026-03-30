# Sonde Formatter — Structure, Enrich, and Sync Experiment Records

Use this skill when experiment results need to be properly formatted, linked to data, and synced with the knowledge base. This covers the gap between "the run finished" and "the knowledge base accurately reflects what happened."

Typical triggers:
- "Format my recent experiments"
- "Sync these results with the knowledge base"
- "Clean up EXP-0042"
- "Make sure the metadata is right on my latest runs"
- "Link my output data to the experiment"

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

### 2. Structure the content

Good experiment content follows this pattern. Not rigidly — adapt to what's relevant — but these sections make experiments searchable and useful to future agents:

```markdown
# Clear one-line title describing what was tested

## Objective
What question this experiment answers and why it matters.
Reference the finding or question that motivated it.

## Method
- Model: Breeze v2.1 / WRF 4.5 / etc.
- Domain: North Atlantic, 25km horizontal, 50 vertical levels
- Period: 2026-03-15 00:00Z to 2026-03-17 00:00Z (48h)
- Key parameters: CCN=1200, scheme=spectral_bin, ...
- Code: branch `feature/spectral-bin` @ commit f7a2c1d

## Results
What happened. Include quantitative results:
- Precipitation enhancement: 5.8% (vs 13.6% with bulk at same CCN)
- Domain-mean temperature bias: -0.3K
- Spinup time: 6h

## Interpretation
What this means. How it relates to existing findings.
Does it support, contradict, or extend prior work?

## Data
Where the output lives:
- S3: `s3://aeolus-data/experiments/EXP-XXXX/output.zarr`
- STAC: `nwp-simulations/EXP-XXXX-output`
- Load: `xr.open_zarr("s3://aeolus-data/experiments/EXP-XXXX/output.zarr")`
```

**The title matters most.** It's what appears in `sonde list`, `sonde search`, and `sonde brief`. A title like "Spectral bin CCN=1200, 8% less enhancement than bulk" is findable. A title like "Run 3" is not.

### 3. Set the structured metadata

These fields power search, filtering, and the brief. Get them right:

**Tags** — use the canonical vocabulary. Check what exists first:

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

```bash
sonde update EXP-XXXX --tag cloud-seeding --tag spectral-bin --tag north-atlantic --tag 25km
```

**Finding** — if the experiment is complete, extract the key insight as a single sentence:

```bash
sonde update EXP-XXXX --finding "Spectral bin produces 8% less precipitation enhancement than bulk at CCN=1200 over maritime Cu domain"
```

A good finding is:
- One sentence, self-contained (makes sense without reading the full experiment)
- Quantitative when possible ("8% less" not "less")
- Specific about conditions ("at CCN=1200 over maritime Cu" not "in some cases")

**Parameters** — if the experiment used specific configuration values, capture them as structured data so `sonde search --param` works:

```bash
sonde update EXP-XXXX --params '{"ccn": 1200, "scheme": "spectral_bin", "resolution_km": 25}'
```

Or from a config file:

```bash
sonde update EXP-XXXX --params-file run_config.yaml
```

**Status** — make sure it matches reality:

```bash
sonde close EXP-XXXX                          # if done
sonde close EXP-XXXX --finding "key result"   # done + finding in one step
sonde start EXP-XXXX                          # if running
```

### 4. Link to data

If the experiment produced geospatial output (NetCDF, Zarr):

1. Upload to S3 following the path convention:
   ```bash
   aws s3 cp output/ s3://aeolus-data/experiments/EXP-XXXX/ --recursive
   ```

2. Register in STAC (see `stac-data-workflow` skill for the full process)

3. Tag the experiment and update metadata:
   ```bash
   sonde update EXP-XXXX --tag has-data
   ```

4. Add the S3 path and load snippet to the content's Data section so future agents can find and load it without querying STAC.

If the experiment produced small files (figures, CSVs, PDFs):

```bash
sonde attach EXP-XXXX figures/precip_map.png
sonde attach EXP-XXXX diagnostics/timeseries.csv
```

### 5. Link to related records

Connect the experiment to the knowledge graph:

```bash
# Link to related experiments
sonde update EXP-XXXX --related EXP-0039,EXP-0041

# If this experiment was motivated by a question
sonde note EXP-XXXX "Motivated by Q-003: does spectral bin change CCN response?"

# If results support or contradict a finding
sonde note EXP-XXXX "Supports FIND-001 (CCN saturation) — consistent threshold at 1200-1500"
```

### parent_id vs related

- **parent_id**: Set automatically by `sonde fork`. This experiment is a branch (variant/refinement/etc.) of the parent. Forms a navigable tree.
- **related**: Set manually via `--related`. A loose "see also" cross-reference. Flat, not hierarchical.

Don't set parent_id manually — use `sonde fork` to create branches.

### 6. Verify the record

After formatting, verify everything looks right:

```bash
sonde show EXP-XXXX
```

Check:
- Title is clear and searchable
- Tags cover domain, method, scheme, scale
- Finding is a self-contained sentence (if complete)
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
if issues: print(f\"{e['id']}: {', '.join(issues)}\")
else: print(f\"{e['id']}: OK\")
"
```

For each experiment with issues, apply the formatting workflow above.

## What NOT to do

- **Don't fabricate results.** If the experiment content doesn't mention a specific number, don't invent one for the finding. Use what's there.
- **Don't change scientific meaning.** Restructure and clarify, but don't reinterpret results. If the author said "inconclusive," don't upgrade that to a positive finding.
- **Don't merge experiments.** Each experiment is its own record. If two experiments are related, link them with `--related`, don't combine their content.
- **Don't delete content.** Add structure (headings, lists), but keep all original information. It's fine to reorganize; it's not fine to drop details.
- **Don't guess the program.** If `.aeolus.yaml` has a program, use it. If not, ask.

## Full-text search and why structure matters

Postgres full-text search indexes the content body. When someone runs `sonde search --text "spectral bin CCN"`, the search hits:
- The title (most weight — it's the first line)
- The content body (method, results, interpretation)
- The finding field (separate indexed column)

Structured content with clear sections makes search more precise. An experiment with "CCN=1200" in a Method section and "8% less enhancement" in a Results section is more findable than one that buries both in a paragraph.

Tags add another discovery axis. An agent running `sonde list --tag spectral-bin --complete` finds all completed spectral bin experiments instantly — no text search needed.

## STAC metadata quality

When registering data in STAC, get these right — they power spatial and temporal discovery:

- **geometry:** Accurate domain polygon, not a rough guess. Extract from the model config or coordinate arrays.
- **datetime:** Use the actual simulation period, not the run date. Format as ISO 8601 range: `"2026-03-15T00:00:00Z/2026-03-17T00:00:00Z"`
- **properties.experiment_id:** Must match the sonde experiment ID exactly.
- **properties.model:** The model name and version (e.g., `breeze-v2.1`).
- **properties.resolution:** Horizontal resolution as a string (e.g., `25km`).
- **assets:** One entry per distinct output file. Use descriptive titles, not filenames.

Bad STAC metadata is worse than no STAC metadata — it makes people find the wrong data.
