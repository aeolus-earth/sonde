# TICKET-004: Agent Data Retrieval & Experiment-Catalog Sync

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** High
**Phase:** Spans TICKET-002 Phases 1–4
**Related:** TICKET-002 (data management layer), TICKET-001 (knowledge graph), TICKET-003 (agent identity)

---

## The problem

An agent (Claude Code, Codex, a SLURM post-processing script) is working on a research program. It has full access to the knowledge layer — experiments, findings, questions, directions — via the sonde CLI. It pulls down `.sonde/` and reads the markdown. It can see that EXP-0082 ran spectral-bin microphysics over the North Atlantic at 25km with CCN=1200, and that the finding was "8% less enhancement than bulk at same CCN."

Now it wants to actually look at the data.

Today, that's where the trail goes cold. The experiment record says what happened. But the agent has no programmatic way to:

1. **Discover** what datasets exist for that experiment (or for similar experiments)
2. **Locate** the data — is it on S3? What's the path? Is there a Zarr store or NetCDF files? What Icechunk repo? What branch/commit?
3. **Know enough to write its own loading code** — what variables are in the store, what's the spatial/temporal extent, what format is it in?

The experiment markdown might mention an S3 path in the notes, or it might not. There's no structured link between the experiment record and the actual output. An agent can't reliably go from "I know about this experiment" to "I know where the data is and can write a script to load it."

This is the gap between the knowledge layer and the data layer. **Sonde should close this gap by being a rich catalog, not by wrapping data access.** Agents already know how to use xarray, zarr, and icechunk — they don't need a CLI abstraction over `xr.open_zarr()`. What they need is a reliable way to find out what exists, where it lives, and what's in it. Then they write their own scripts.

---

## Why this matters for agents specifically

A human scientist can fill the gap with tribal knowledge — "oh, Mason's runs are in `/scratch/mlee/` and he usually uploads to `s3://aeolus-data/runs/`." An agent can't. For agents to be autonomous research participants, the path from experiment record to loadable data must be fully machine-navigable.

Consider the workflows agents need:

### 1. "What data exists for this experiment?"

An agent is reviewing EXP-0082. It wants to reproduce or extend the analysis. It needs to know: is there output data? Where? What variables? What resolution? Is it the raw model output or a post-processed product?

```bash
# What the agent needs to be able to do:
sonde data list --experiment EXP-0082 --format json
# → [{"id": "DATA-0147", "storage_uri": "s3://...", "variables": [...], ...}]
```

### 2. "What simulations have already covered this domain/resolution/timeframe?"

An agent is planning a new experiment. Before proposing a 25km North Atlantic run, it should check what already exists. This requires querying the data catalog by spatial extent, resolution, and time range — not the experiment records, which don't have this structure.

```bash
# What the agent needs to be able to do:
sonde data list --domain north-atlantic --resolution "<=25km" --after 2026-03-01 --format json
```

### 3. "Write a script to verify a finding"

An agent wants to check whether EXP-0082's finding (8% less precipitation enhancement) holds. It doesn't need the CLI to load data for it — it knows how to use xarray and zarr. What it needs is enough metadata to write its own script: the S3 URI, the variable names, the coordinate dimensions, the Icechunk commit if versioned.

```bash
# Agent queries the catalog:
sonde data list --experiment EXP-0082 --format json
# → [{"id": "DATA-0147", "storage_uri": "s3://aeolus-data/runs/...",
#     "data_type": "zarr", "variables": ["temperature", "precipitation", ...],
#     "dimensions": {"time": 48, "level": 50, "lat": 360, "lon": 720},
#     "icechunk_repo": "s3://aeolus-icechunk/breeze-runs", "icechunk_branch": "main",
#     ...}]

# Agent writes its own analysis script using that metadata — no CLI wrapper needed:
import xarray as xr
ds = xr.open_zarr("s3://aeolus-data/runs/2026-03-28/north-atlantic-25km/f7a2c1d/")
precip_082 = ds["precipitation"].mean(dim="time")
```

The CLI's job ended at the JSON response. The agent takes it from there.

### 4. "What data is the STAC catalog aware of that the experiment records don't mention?"

If someone stores data via S3 directly (bypassing `sonde store`), or if an external dataset gets registered in STAC but not linked to an experiment, the knowledge layer and data catalog can drift. An agent looking at the full picture needs both views to be consistent — or at least know where they disagree.

---

## The sync problem

There are two sources of truth for "what data exists":

| Source | What it knows | Where it lives |
|---|---|---|
| **Experiment records** (Supabase `experiments` table + `.sonde/` markdown) | Hypothesis, parameters, findings, status, provenance. May reference data via `data_sources` field or freeform notes. | Supabase + local `.sonde/` files |
| **Data catalog** (Supabase `datasets` table + STAC + S3) | Storage URI, variables, spatial/temporal extent, file size, format. Linked to experiments via `experiment_id` FK. | Supabase + S3 + STAC catalog |

These two must stay in sync. The hard question is: **who is the source of truth for the link between them?**

### Scenario: experiment exists, data doesn't (yet)

Common on HPC. The experiment is logged (`sonde log`), the simulation runs, but the data hasn't been stored yet (or was stored with `--defer`). The experiment record exists in the knowledge layer but has no corresponding dataset entry.

**This is fine.** The `datasets` table has a `status` field concept (from TICKET-002's `--defer`). An experiment with no linked dataset is simply "results not yet stored." Agents should treat this as expected, not as an error.

### Scenario: data exists, experiment doesn't

Someone uploads data to S3 manually, or registers it in STAC via an external tool. The data catalog knows about it, but there's no experiment record. The knowledge layer can't explain why this data exists or what it means.

**This is the dangerous case.** Data without provenance is noise. The CLI should make it easy to retroactively link orphan datasets to experiments, and `sonde brief` should flag unlinked datasets.

### Scenario: experiment references data that's been moved or deleted

S3 paths change. Icechunk branches get rebased. Data gets archived to cold storage. The experiment record still references `s3://aeolus-data/runs/2026-03-28/...` but the data isn't there anymore, or it's been moved.

**This requires liveness checks.** The CLI should verify that referenced storage URIs are reachable when an agent asks for them, and update the catalog if they've moved.

### Scenario: multiple datasets per experiment

An experiment might produce raw output, post-processed diagnostics, verification plots, and a summary notebook. Each is a different dataset with a different type and different metadata, but they all belong to the same experiment.

**The `experiment_id` FK handles this.** But the CLI needs to surface this multiplicity clearly — `sonde data list --experiment EXP-0082` should show all associated datasets, grouped by type.

---

## What needs to be decided

### 1. Is `experiment_id` the canonical link, or do we also support reverse links?

TICKET-002 defines a `datasets.experiment_id` FK. This means the dataset knows which experiment produced it. But should the experiment record also explicitly list its datasets?

**Option A: FK only.** The `datasets` table links to experiments. To find data for an experiment, query `datasets WHERE experiment_id = X`. Experiment records don't change when data is added.

**Option B: Bidirectional.** Experiment records also have a `datasets` field (list of DATA-NNNN IDs). When `sonde store --experiment EXP-0082` runs, it updates both the dataset row and the experiment row.

**Recommendation:** Start with Option A (FK only) but ensure the CLI commands make the join feel seamless. `sonde show EXP-0082` should include a "Datasets" section by querying the datasets table. The experiment markdown rendered by `sonde pull` should include the linked datasets. No redundant state to sync.

### 2. How does the STAC catalog relate to the Supabase `datasets` table?

TICKET-002 describes both a Supabase `datasets` table and a STAC catalog. Are these:

**Option A: STAC is the source of truth.** The `datasets` table is a cache/index of STAC Items. `sonde store` writes a STAC Item and the Supabase row is derived from it.

**Option B: Supabase is the source of truth.** The `datasets` table is the primary record. STAC Items are generated from it for external discoverability. The CLI only queries Supabase.

**Option C: They're independent.** The `datasets` table tracks what the Aeolus team stored. STAC tracks what's publicly discoverable. They overlap but aren't identical.

**Recommendation:** Option B. Supabase is where the agent already authenticates and queries. STAC is an export format for interoperability with external tools (QGIS, STAC Browser, other STAC clients). The CLI generates STAC Items from the `datasets` table on `sonde store`, and can regenerate the STAC catalog from the database at any time. One source of truth, one sync direction.

### 3. What does `sonde pull` do for datasets?

Today `sonde pull` syncs experiment/finding/question records to local `.sonde/` markdown. Should it also pull dataset metadata?

**Recommendation:** Yes. `sonde pull` should write dataset records to `.sonde/datasets/DATA-0147.md` with metadata (URI, variables, extent, linked experiment) but **not** the actual data. The markdown is a catalog card, not a data download. Downloading data is `sonde data pull DATA-0147`.

This gives agents a complete local picture: experiment context + dataset metadata, all as markdown they can read.

### 4. How does an agent get from markdown to loaded data?

The critical path. An agent is in a repo with `.sonde/` pulled. It reads `EXP-0082.md`. Now it wants the data.

**Design principle: don't wrap what agents already know how to do.** Agents are fluent in xarray, zarr, icechunk, boto3. They don't need a CLI command that generates a Python snippet — they can write the script themselves. What they *can't* do is find out where the data is, what's in it, and whether they have access. That's what sonde should solve.

**The flow:**
1. Agent reads `.sonde/experiments/EXP-0082.md` — sees experiment context AND a "Datasets" section listing DATA-0147 with its storage URI, format, variables, dimensions, and Icechunk ref
2. Agent has everything it needs to write its own loading/analysis code — `xr.open_zarr(uri)`, `icechunk.Repository(repo_url)`, whatever the task requires
3. If the agent needs more detail (full variable list, exact spatial bounds, chunking info), it runs `sonde data show DATA-0147 --format json` — a catalog query, not a data operation

**What sonde does NOT do:**
- No `sonde data pull` that downloads datasets to local filesystem — agents can use `aws s3 cp`, `rclone`, or just open lazily with xarray
- No `sonde data open` that prints load snippets — agents write their own scripts
- No subsetting flags (`--variable`, `--level`, `--time`) — that's xarray's job
- No `sonde data diff` — agents can compare datasets however they want

**What sonde DOES do:**
- Rich catalog metadata in `sonde data list` and `sonde data show` (`--format json`)
- Dataset refs embedded in experiment markdown after `sonde pull`
- Enough information in the catalog that the agent can decide *whether* to load the data before loading it (variables, extent, resolution, size, format)

### 5. Credential handoff for S3 and Icechunk access

This is the real enabler. An agent can query the Supabase catalog via the sonde CLI's auth token. But actually loading data from S3 or opening an Icechunk repo requires separate credentials with **read/write access**. An agent that wants to write back corrected data, store derived products, or commit to an Icechunk branch needs write permissions, not just read.

**The agent needs:**
- **S3 read/write** — load Zarr stores, write derived datasets, upload new run output
- **Icechunk read/write** — open repos, read commits, create new commits/branches when storing results
- **These credentials must be available in the agent's environment** — the agent will use them directly from its own scripts, not through sonde

**Options:**
- **Environment variables:** Agent has `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or instance profile) in its environment. Works for HPC, CI, Claude Code on team machines. Simplest option.
- **STS assume-role:** The sonde CLI's Supabase token is exchanged for temporary AWS credentials via a Supabase Edge Function. Enables per-program scoping (agent for `weather-intervention` can only access that program's S3 prefix). More complex but necessary for multi-tenant.
- **Presigned URLs:** For read-only access in sandboxed environments where the agent can't have persistent AWS credentials.

**Recommendation:** Start with environment-based credentials. The agent runs where AWS is configured, and sonde tells it where to point those credentials. Add STS assume-role when we need per-program access scoping (TICKET-003 territory). Presigned URLs are a fallback for restricted environments, not the primary path.

**What sonde's role is here:** Sonde doesn't manage S3 credentials. Sonde tells you the URI and the metadata. Your environment gives you the credentials. Your script loads the data. Sonde is the catalog, not the data access layer.

---

## The boundary: sonde is a catalog, not a data access layer

This is the core design principle. Sonde tells you what exists and where it lives. It does not load, transform, subset, or transfer data. Agents and scientists use standard tools (xarray, zarr, icechunk, boto3, rclone) for data access — tools they already know, that have better documentation, more features, and more community support than anything we'd build.

**Why no wrappers:** Every CLI command that wraps `xr.open_zarr()` or `aws s3 cp` is a command we have to maintain, document, and debug — and it will always be worse than the tool it wraps. An agent that can write Python doesn't need us to generate a Python snippet. An agent that can call `boto3` doesn't need us to download files for it. The moment we start wrapping data access, we're competing with xarray's API surface. We lose.

| Sonde CLI owns | The agent's own scripts own |
|---|---|
| Catalog registration (which datasets exist, where, what metadata) | Data loading (xarray, zarr, netcdf4, icechunk) |
| Discovery (find datasets by experiment, domain, time, variables, tags) | Data processing (regridding, interpolation, analysis) |
| Provenance (who stored it, from which experiment, with which code) | Data transfer (boto3, rclone, aws s3 cp) |
| Metadata richness (variables, dimensions, extent, chunking, format) | Visualization (plotting, maps, animations) |
| Sync between experiment records and dataset catalog | Writing derived data back to S3/Icechunk |
| STAC export (make datasets findable by external tools) | Storage infrastructure (S3 bucket policies, lifecycle rules) |

**Sonde is the card catalog in the library. It doesn't check out the books for you.**

---

## Storage tiers: what lives where

Not all data is the same size, and the storage strategy must reflect that. A 20 GB Zarr store from a 48-hour Breeze run and a 200 KB verification plot are fundamentally different artifacts with different storage needs.

### S3: large run output (Zarr, NetCDF, large datasets)

Simulation output is too large for Supabase Storage. A single Breeze run can be tens of GB; a parameter sweep campaign can be TB. This data **must** live in S3 (or Icechunk-managed S3). The `datasets` table in Supabase holds the metadata and the storage URI — never the data itself.

For agents, this means: discovering and locating large datasets is fast (Supabase query via `sonde data list`). Actually loading the data is the agent's job — it writes its own xarray/zarr/icechunk scripts using the URIs and metadata from the catalog. The agent needs S3 credentials in its environment with read/write access.

### Supabase Storage: small artifacts (PNGs, PDFs, CSVs, notebooks)

Figures, summary CSVs, PDF reports, Jupyter notebooks — these are small enough to store directly in Supabase Storage and serve via the existing `sonde attach` / `sonde pull` flow. An agent can pull these down instantly without S3 credentials. A 500 KB PNG of a precipitation map or a 2 MB CSV of time-series diagnostics should be as easy to access as the experiment markdown itself.

This is the current `attach` model: artifacts are uploaded to Supabase Storage, linked to experiments, and pulled down with `sonde pull`. No S3 configuration needed. No xarray. Just files.

### The two tiers from the agent's perspective

```bash
# Small artifacts — already in Supabase Storage, pulled with the experiment
sonde pull experiment EXP-0082
# → .sonde/experiments/EXP-0082.md
# → .sonde/experiments/EXP-0082/precip_map.png      (from Supabase Storage)
# → .sonde/experiments/EXP-0082/diagnostics.csv      (from Supabase Storage)
# Agent can read these files directly. No S3 credentials needed.

# Large datasets — metadata in Supabase, data in S3
sonde data show DATA-0147 --format json
# → {"storage_uri": "s3://aeolus-data/runs/2026-03-28/...",
#    "data_type": "zarr", "variables": [...], "size_bytes": 3400000000, ...}
# Agent uses the URI to write its own loading code:
#   ds = xr.open_zarr("s3://aeolus-data/runs/2026-03-28/...")
# Agent needs S3 credentials in its environment.
```

The rule of thumb: **if it fits comfortably in a git repo, it can go in Supabase Storage via `sonde attach`. If it doesn't, it goes to S3 via `sonde store` and gets a catalog entry in the `datasets` table.** The CLI should never try to push a 20 GB Zarr store through Supabase, and agents should never need S3 credentials just to look at a verification plot.

---

## Acceptance criteria

1. An agent can go from experiment ID to a storage URI + enough metadata to write its own loading script, in at most one CLI call (`sonde data list --experiment EXP-0082 --format json`)
2. `sonde pull` includes dataset catalog cards in `.sonde/datasets/` — metadata only, never the data itself
3. `sonde pull` embeds linked dataset refs (URI, format, variables, size) in experiment markdown so agents can read everything from `.sonde/` without additional CLI calls
4. `sonde show EXP-NNNN` displays linked datasets with URIs, variables, and extent
5. `sonde data list` supports filtering by experiment, domain, resolution, time range, variables, and tags
6. `sonde data show DATA-NNNN --format json` returns rich metadata: storage URI, format, variables, dimensions, chunking, spatial/temporal extent, Icechunk repo/branch/commit, size — everything an agent needs to write its own script
7. `sonde brief` includes a data inventory section showing what data exists per program
8. Orphan datasets (data without experiment links) are flagged in `sonde brief`
9. The STAC catalog is generated from the Supabase `datasets` table (one source of truth)
10. `--format json` on all data commands for machine consumption
11. **No CLI wrappers around data loading, downloading, or subsetting** — agents use xarray/zarr/icechunk/boto3 directly
12. Small artifacts (PNGs, PDFs, CSVs) live in Supabase Storage and come down with `sonde pull` — no S3 credentials needed
13. Large datasets (Zarr, NetCDF, multi-GB) live in S3 — agents need read/write S3 credentials in their environment to access them

---

## Out of scope (for this ticket)

- **CLI wrappers around data access** — no `sonde data pull` (use boto3/rclone), no `sonde data open` (agents write their own scripts), no subsetting flags (use xarray). Sonde is a catalog, not a data access layer.
- Data processing, regridding, analysis — these are downstream of retrieval
- STAC API server deployment — STAC is an export format first
- Icechunk branch/commit management — record refs, don't manage repos
- Cross-program data sharing — RLS scoping is sufficient for now
- Real-time data streams — separate problem from historical retrieval

---

*Related:*
- *tickets/002-data-management-layer.md — full data management scope, implementation phases*
- *tickets/001-knowledge-graph-layer.md — entity/edge model that can link to datasets*
- *tickets/003-identity-and-agent-tracking.md — agent auth and credential handoff*
