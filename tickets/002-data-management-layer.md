# TICKET-002: Data Management Layer — Store, Tag, Find, Retrieve

**Status:** Proposed
**Author:** Mason
**Created:** 2026-03-29
**Priority:** High
**Phase:** Phase 1 foundations, full scope spans Phases 1–5
**Related:** TICKET-001 (knowledge graph layer), PRD Phase 5 (STAC + data catalog)

---

## Motivation

The hardest part of research at Aeolus isn't running simulations — it's what happens after. A scientist finishes a 48-hour Breeze run on the HPC cluster. The output is sitting in `/scratch/mlee/breeze-run-0329/`. Now what?

Today, the answer is a series of manual decisions that nobody makes consistently:

1. **Where do I put this?** S3? Which bucket? What path structure? Do I use the date? The experiment name? The domain?
2. **What metadata do I attach?** The git commit that produced it, the parameters, the resolution, the domain bounds — all of this matters for later retrieval, but there's no enforced convention.
3. **How do I tell the team?** Slack a link? Update a spreadsheet? Hope someone finds it in S3?
4. **How does anyone find it later?** An agent running `aeolus gaps` needs to know what data exists. A scientist starting a new experiment needs to know what's already been simulated. A trading analyst needs to know which forecast cycles have been archived.

Every research team hits this wall. The data exists, but it's scattered, inconsistently named, poorly tagged, and effectively invisible to anyone who wasn't the person who produced it. The knowledge base becomes disconnected from the data it describes — experiments reference S3 paths that may or may not exist, with metadata that may or may not be accurate.

The Aeolus CLI should make data management as frictionless as experiment logging. One command to store data in the right place with the right metadata. One command to find it later. No decisions about path structure, no manual metadata entry, no hoping someone remembers where they put things.

---

## The developer experience we want

### Storing data (the critical moment)

The scientist is on the HPC cluster. The simulation just finished. They're in a terminal, probably with Claude Code.

**What it should feel like:**

```bash
# Simplest case — CLI figures out everything from context
$ aeolus store ./output/
→ Detected: Zarr store, 12 variables, 48 timesteps
  Domain: North Atlantic (25km), 2026-03-28T00:00Z to 2026-03-30T00:00Z
  Git: aeolus/breeze-experiments @ f7a2c1d (branch: feature/spectral-bin)
  Size: 3.2 GB (47 chunks)

  Uploading to: s3://aeolus-data/runs/2026-03-28/north-atlantic-25km/f7a2c1d/
  Registering in STAC catalog: breeze-runs/2026-03-28-north-atlantic-25km

  [████████████████████████████████████] 100% (3.2 GB)

  Stored: DATA-0147
  STAC Item: stac://breeze-runs/2026-03-28-north-atlantic-25km
  S3: s3://aeolus-data/runs/2026-03-28/north-atlantic-25km/f7a2c1d/

  Tip: link to an experiment with `aeolus update EXP-0082 --data DATA-0147`
```

**What happened behind the scenes:**

1. CLI inspected the directory — detected Zarr, read `.zmetadata` for variable names, chunking, dimensions
2. CLI read the coordinate arrays to extract spatial bounds and time range
3. CLI read git context from the working directory (commit SHA, remote, branch)
4. CLI generated a deterministic S3 path from the metadata (date + domain + resolution + commit)
5. CLI uploaded to S3 with parallel chunk transfers
6. CLI created a STAC Item with all extracted metadata
7. CLI registered the dataset in the Aeolus catalog (Postgres row in `datasets` table)
8. CLI printed the dataset ID, STAC reference, and S3 path

**The scientist's total effort:** `aeolus store ./output/`. One command. Everything else is automatic.

### Storing with explicit metadata (when auto-detection isn't enough)

```bash
# Override or supplement auto-detected metadata
$ aeolus store ./output/ \
    --program weather-intervention \
    --experiment EXP-0082 \
    --tags "spectral-bin,ccn-sweep,maritime-cu" \
    --description "Spectral bin microphysics CCN=1200, maritime Cu domain" \
    --resolution 3km \
    --model breeze-v2.1

# Store non-Zarr data (figures, CSVs, notebooks)
$ aeolus store ./figures/ --type figures --experiment EXP-0082
$ aeolus store analysis.ipynb --type notebook --experiment EXP-0082
$ aeolus store era5_sst_march.nc --type reference-data --description "ERA5 SST forcing"
```

### Finding data (the daily need)

```bash
# Natural language (agent-friendly)
$ aeolus data "north atlantic runs from last week"
→ DATA-0147  2026-03-28  north-atlantic-25km  spectral-bin  3.2 GB  EXP-0082
  DATA-0143  2026-03-27  north-atlantic-25km  bulk-2moment  3.1 GB  EXP-0079
  DATA-0139  2026-03-25  north-atlantic-10km  bulk-2moment  18 GB   EXP-0075

# Structured queries
$ aeolus data list --domain north-atlantic --after 2026-03-20
$ aeolus data list --program weather-intervention --type zarr
$ aeolus data list --experiment EXP-0082
$ aeolus data list --tag ccn-sweep
$ aeolus data list --resolution "<=10km"
$ aeolus data list --model breeze-v2.1 --recent 30d
$ aeolus data list --variable temperature --levels 500,850

# Where is a specific dataset?
$ aeolus data show DATA-0147
→ Dataset: DATA-0147
  Type: zarr
  S3: s3://aeolus-data/runs/2026-03-28/north-atlantic-25km/f7a2c1d/
  STAC: stac://breeze-runs/2026-03-28-north-atlantic-25km
  Size: 3.2 GB
  Variables: temperature, pressure, u_wind, v_wind, precipitation, ...
  Domain: North Atlantic, 25km, 20°N-55°N, 80°W-10°W
  Time: 2026-03-28T00:00Z to 2026-03-30T00:00Z (48 timesteps, 1h)
  Resolution: 25km horizontal, 50 vertical levels
  Model: breeze-v2.1
  Git: aeolus/breeze-experiments @ f7a2c1d
  Experiment: EXP-0082
  Program: weather-intervention
  Tags: spectral-bin, ccn-sweep, maritime-cu
  Created: 2026-03-28T22:15:00Z by human/mlee
  Icechunk: commit abc123 on branch main (latest)

  Open with:
    xarray:  xr.open_zarr("s3://aeolus-data/runs/2026-03-28/...")
    local:   aeolus data pull DATA-0147
```

### Retrieving data

```bash
# Pull to local filesystem (smart subsetting)
$ aeolus data pull DATA-0147                           # full dataset
$ aeolus data pull DATA-0147 --variable temperature    # one variable
$ aeolus data pull DATA-0147 --variable temperature --level 500 --time 0:12
$ aeolus data pull DATA-0147 --to ./local-copy/

# Generate a load snippet (for scripts/notebooks)
$ aeolus data open DATA-0147
→ import xarray as xr
  ds = xr.open_zarr("s3://aeolus-data/runs/2026-03-28/north-atlantic-25km/f7a2c1d/")

$ aeolus data open DATA-0147 --format python > load_data.py
$ aeolus data open DATA-0147 --format julia   # Zarr.jl snippet

# Compare two datasets
$ aeolus data diff DATA-0147 DATA-0143
→ Same domain, same resolution
  DATA-0147: spectral-bin microphysics, CCN=1200
  DATA-0143: bulk-2moment microphysics, CCN=1200
  Difference: microphysics scheme
  Common variables: temperature, pressure, u_wind, v_wind, precipitation
  Unique to DATA-0147: droplet_spectrum, aerosol_concentration
```

---

## What the CLI owns vs. doesn't own

This boundary matters. The CLI is a data management tool, not a data processing tool.

### The CLI owns

| Responsibility | What it does |
|---|---|
| **Path generation** | Deterministic S3 paths from metadata. Scientists never decide where to put things. Convention: `s3://aeolus-data/{category}/{date}/{domain}-{resolution}/{git-sha}/` |
| **Upload orchestration** | Parallel chunk upload to S3. Progress bar. Resume on failure. Handles HPC network constraints (bandwidth limiting, retry). |
| **Metadata extraction** | Auto-reads Zarr metadata (variables, dimensions, chunking), coordinate arrays (spatial bounds, time range), git context. Fills in what it can, asks for what it can't. |
| **STAC registration** | Creates STAC Items with proper extensions (forecast, scientific). Links assets to S3 locations. Maintains the STAC catalog. |
| **Catalog registration** | Writes a row to the `datasets` table in Postgres with all metadata, searchable via `aeolus data list/search`. |
| **Icechunk integration** | When storing to an Icechunk-managed repo, creates a commit with a message linking to the experiment. Supports branches and tags. |
| **Provenance tracking** | Records git commit, branch, remote, experiment ID, source (human/agent), timestamp. Links datasets to experiments bidirectionally. |
| **Discovery** | Full-text search, structured filters, spatial/temporal queries, tag-based filtering. The `aeolus data` command surface. |
| **Retrieval helpers** | `aeolus data pull` for local copies, `aeolus data open` for load snippets. Smart subsetting by variable/level/time. |
| **Access control** | Datasets inherit program scoping from experiments. RLS ensures agents only see datasets in their authorized programs. |

### The CLI does NOT own

| Not our problem | Why | Who owns it |
|---|---|---|
| **Data processing** | Converting NetCDF to Zarr, regridding, bias correction — these are analysis tasks | Scientists, xarray, Breeze post-processing |
| **Compute orchestration** | Submitting SLURM jobs, monitoring HPC runs | Sonde (Phase 1 of main PRD), SLURM |
| **Data format enforcement** | We accept what scientists produce (Zarr, NetCDF, CSV, figures). We don't dictate output formats. | Research repos, Breeze config |
| **Long-term archival policy** | Lifecycle rules, cold storage tiers, deletion policies | Infra/DevOps, S3 lifecycle policies |
| **Real-time data streams** | Live observation feeds, streaming forecast updates | Sonde's data retrieval capability |

### Gray areas (decide during implementation)

| Question | Options |
|---|---|
| **Should `aeolus store` convert NetCDF to Zarr?** | Option A: Yes, for convenience — scientists hand us whatever they have. Option B: No, require Zarr — keeps the CLI simple, conversion is a known step. **Recommendation:** Accept both, convert on upload if `--convert` flag is passed. Don't make it the default — scientists should know what format their data is in. |
| **Should the CLI manage Icechunk repos directly?** | Option A: Yes, `aeolus data branch/commit/tag` commands. Option B: No, scientists use Icechunk's own API — the CLI just records which commit a dataset points to. **Recommendation:** Start with B. Record the Icechunk commit reference. Add management commands only if the team asks for them. |
| **Should `aeolus data pull` handle multi-GB downloads?** | Option A: Full download with progress bar and resume. Option B: Just print the S3 path and let the scientist use their preferred tool (rclone, aws s3 cp, xarray lazy load). **Recommendation:** Both. `aeolus data pull` does the download for convenience. `aeolus data show` always prints the raw path for power users. Default to lazy access (print the xarray snippet) — most analysis doesn't need a full local copy. |

---

## Schema

```sql
create table datasets (
    id uuid primary key default gen_random_uuid(),
    short_id text unique not null,          -- DATA-0147
    program text not null,
    experiment_id uuid references experiments(id),

    -- Storage location
    storage_uri text not null,              -- s3://aeolus-data/runs/...
    stac_item_id text,                      -- STAC Item reference
    icechunk_commit text,                   -- Icechunk commit hash (if applicable)
    icechunk_branch text,                   -- Icechunk branch name

    -- What's in it
    data_type text not null,                -- 'zarr', 'netcdf', 'csv', 'figure', 'notebook', 'other'
    variables text[],                       -- ['temperature', 'pressure', 'u_wind', ...]
    dimensions jsonb,                       -- {"time": 48, "level": 50, "lat": 360, "lon": 720}
    chunking jsonb,                         -- {"time": 12, "level": 50, "lat": 180, "lon": 180}
    size_bytes bigint,
    file_count int,

    -- Where and when (spatial/temporal extent)
    spatial_bounds geometry(Polygon, 4326), -- PostGIS for spatial queries
    time_start timestamptz,
    time_end timestamptz,
    time_step_seconds int,                  -- temporal resolution
    spatial_resolution_m real,              -- horizontal grid spacing in meters

    -- What produced it
    model text,                             -- 'breeze-v2.1', 'wrf-4.5', etc.
    model_config jsonb,                     -- model-specific config (microphysics scheme, etc.)
    git_repo text,
    git_commit text,
    git_branch text,

    -- Discoverability
    description text,
    tags text[],
    properties jsonb default '{}',          -- flexible key-value metadata

    -- Provenance
    source text not null,                   -- 'human/mlee', 'sonde/ingest', 'codex/task-abc'
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Indexes for every access pattern
create index idx_datasets_program on datasets(program);
create index idx_datasets_experiment on datasets(experiment_id);
create index idx_datasets_type on datasets(data_type);
create index idx_datasets_model on datasets(model);
create index idx_datasets_tags on datasets using gin (tags);
create index idx_datasets_variables on datasets using gin (variables);
create index idx_datasets_properties on datasets using gin (properties);
create index idx_datasets_time on datasets(time_start, time_end);
create index idx_datasets_spatial on datasets using gist (spatial_bounds);
create index idx_datasets_text on datasets using gin (
    to_tsvector('english', coalesce(description, '') || ' ' || coalesce(short_id, ''))
);
create index idx_datasets_created on datasets(created_at desc);
create index idx_datasets_git on datasets(git_commit);

-- RLS: same program-scoping as experiments
alter table datasets enable row level security;
```

---

## S3 path convention

The CLI generates deterministic paths. Scientists never make this decision.

```
s3://aeolus-data/
├── runs/                                    # simulation output
│   └── {YYYY-MM-DD}/                        # initialization date
│       └── {domain}-{resolution}/           # e.g., north-atlantic-25km
│           └── {git-sha-short}/             # code version that produced it
│               └── output.zarr/             # the actual data
│
├── reference/                               # external/forcing data
│   └── {source}/                            # e.g., era5, gfs, hrrr
│       └── {YYYY-MM-DD}/                    # valid date
│           └── {product}/                   # e.g., pressure-levels, surface
│
├── analysis/                                # post-processing output
│   └── {experiment-id}/                     # e.g., EXP-0082
│       └── {analysis-type}/                 # e.g., verification, diagnostics
│
├── figures/                                 # publication figures
│   └── {experiment-id}/
│
└── papers/                                  # manuscripts, reports
    └── {paper-slug}/
```

**Why this structure:**

- **Date-first** for runs — matches how scientists think ("the run from Tuesday")
- **Domain + resolution** in the path — the two most common filters
- **Git SHA** prevents collisions when the same config runs twice with different code
- **Deterministic** — given the metadata, you can reconstruct the path without querying the catalog. This is a fallback when the CLI isn't available (e.g., debugging on the HPC with just `aws s3 ls`).

---

## STAC catalog structure

```
aeolus-stac/
├── breeze-runs/                  # Collection: all Breeze simulation output
│   ├── 2026-03-28-north-atlantic-25km    # Item: one run
│   ├── 2026-03-27-north-atlantic-25km
│   └── ...
│
├── reference-data/               # Collection: external data we archive
│   ├── era5-2026-03-28-plevels
│   └── ...
│
├── analysis-products/            # Collection: derived products
│   └── ...
│
└── catalog.json                  # Root catalog
```

Each STAC Item includes:

- **Geometry:** spatial bounds from the dataset's coordinate arrays
- **Datetime:** time range of the data
- **Properties:** model, resolution, variables, git commit, experiment ID, program, tags
- **Assets:** links to S3 locations (the Zarr store, individual variables if useful)
- **Extensions:** `forecast` (reference datetime, lead time), `scientific` (DOI if published)

**The CLI manages this catalog automatically.** `aeolus store` creates Items. `aeolus data list` queries them. Scientists never edit STAC JSON directly.

---

## HPC workflow integration

The HPC is where data is born. The CLI must work well in this environment.

### Constraints on HPC

- **Network:** Compute nodes may have limited or no internet. Data transfer happens from login/transfer nodes.
- **Filesystem:** Output lives in `/scratch/` (fast, temporary) or `/work/` (persistent). Neither is S3.
- **Authentication:** S3 credentials may need to be configured per-session.
- **Size:** Single runs can be tens of GB. Full campaigns can be TB.
- **Bandwidth:** Shared with other users. Can't saturate the pipe.

### How the CLI handles this

```bash
# On the HPC after a simulation finishes:

# Option 1: Store directly (if login node has S3 access)
$ aeolus store /scratch/mlee/breeze-run-0329/output.zarr \
    --program weather-intervention \
    --experiment EXP-0082
→ Uploading... (parallel, resumable, bandwidth-aware)

# Option 2: Register now, upload later (compute node, no S3)
$ aeolus store --defer /scratch/mlee/breeze-run-0329/output.zarr \
    --program weather-intervention \
    --experiment EXP-0082
→ Registered: DATA-0147 (pending upload)
  Metadata extracted and saved to catalog.
  Upload when ready: aeolus data upload DATA-0147

# Later, from a transfer node:
$ aeolus data upload DATA-0147
→ Uploading /scratch/mlee/breeze-run-0329/output.zarr
  to s3://aeolus-data/runs/2026-03-28/north-atlantic-25km/f7a2c1d/
  [████████████████████████████████████] 100%
  Status: DATA-0147 → uploaded

# Option 3: Post-processing script (automated in SLURM)
#!/bin/bash
#SBATCH --job-name=aeolus-store
#SBATCH --dependency=afterok:${BREEZE_JOB_ID}

aeolus store ${SCRATCH}/output.zarr \
    --program weather-intervention \
    --experiment ${EXPERIMENT_ID} \
    --source "slurm/job-${SLURM_JOB_ID}"
```

**`--defer`** is the key feature for HPC. It extracts metadata and registers the dataset in the catalog immediately (so queries work, so agents can see what exists), but defers the S3 upload to when the scientist is on a node with network access. The catalog entry shows `status: pending-upload` until the upload completes.

### Upload mechanics

- **Parallel chunk uploads** — Zarr stores are naturally parallelizable (each chunk is an independent file). Upload N chunks simultaneously.
- **Resume on failure** — Track which chunks uploaded successfully. Resume from where we left off.
- **Bandwidth limiting** — `--bandwidth 100MB/s` to be a good neighbor on shared HPC networks.
- **Checksum verification** — Verify integrity after upload. Store checksums in the catalog.
- **Progress reporting** — Real-time progress bar in the terminal. `--quiet` for scripts.

---

## Agent experience

Agents are first-class users of the data layer. An agent running an experiment should be able to store and find data with the same commands a human uses.

```bash
# Agent stores results after a simulation
$ aeolus store ./output.zarr \
    --program weather-intervention \
    --experiment EXP-0090 \
    --source "codex/task-abc"

# Agent discovers what data exists before planning an experiment
$ aeolus data list --program weather-intervention --domain north-atlantic --format json
→ [{"id": "DATA-0147", "time_start": "2026-03-28", ...}, ...]

# Agent checks if a specific simulation has already been run
$ aeolus data list --model breeze-v2.1 \
    --variable temperature \
    --domain north-atlantic \
    --resolution "<=25km" \
    --after 2026-03-01 \
    --format json

# Agent generates a data loading snippet for its analysis code
$ aeolus data open DATA-0147 --format python
→ import xarray as xr
  ds = xr.open_zarr("s3://aeolus-data/runs/2026-03-28/...")

# In the brief, agents see what data is available
$ aeolus brief --program weather-intervention
→ ...
  DATA INVENTORY:
    Breeze runs: 47 datasets, 2026-02-15 to 2026-03-28
    Domains: north-atlantic (32), gulf-of-mexico (10), ercot (5)
    Resolutions: 3km (8), 10km (15), 25km (24)
    Total: 142 GB across 47 datasets
    Pending upload: 2 datasets (DATA-0151, DATA-0152)
  ...
```

The `aeolus brief` data inventory is what prevents duplicate work. Before an agent proposes "run a 25km North Atlantic simulation," it can check whether that's already been done.

---

## Implementation phases

### Phase 1: Store + catalog + find (weeks 1–2)

The minimum viable data layer. Scientists can store data and find it later.

- `datasets` table in Supabase with indexes
- `aeolus store` — upload to S3, extract metadata, register in catalog
- `aeolus data list` — filtered queries against the catalog
- `aeolus data show` — full dataset detail
- S3 path convention (deterministic, no decisions)
- Git provenance auto-detection
- Parallel upload with progress bar
- `--format json` for agent consumption

**Exit criteria:** A scientist runs `aeolus store ./output/` on the HPC and a teammate finds it with `aeolus data list` on their laptop.

### Phase 2: HPC workflow + deferred upload (week 3)

- `aeolus store --defer` — register metadata without uploading
- `aeolus data upload` — upload a deferred dataset
- Resume-on-failure for uploads
- Bandwidth limiting
- Checksum verification
- SLURM integration example script

**Exit criteria:** A SLURM post-processing job can register data from a compute node without S3 access, and the upload happens later from a transfer node.

### Phase 3: Smart metadata + retrieval (weeks 4–5)

- Auto-detection of Zarr metadata (variables, dimensions, spatial/temporal bounds)
- `aeolus data pull` — smart subsetting by variable/level/time
- `aeolus data open` — generate load snippets (Python, Julia)
- `aeolus data diff` — compare two datasets
- Data inventory in `aeolus brief`
- Link datasets to experiments bidirectionally

**Exit criteria:** An agent can discover available data, generate loading code, and include the data inventory in its experiment planning.

### Phase 4: STAC catalog (weeks 6–7)

- STAC Item creation on `aeolus store`
- STAC Collection management
- `aeolus data search` with spatial/temporal STAC queries
- STAC API server (stac-fastapi) or static catalog — decide based on scale
- External data registration (ERA5, GFS references)

**Exit criteria:** Datasets are discoverable via standard STAC clients, not just the Aeolus CLI.

### Phase 5: Icechunk integration (week 8)

- Record Icechunk commit/branch/tag in dataset metadata
- `aeolus data history DATA-0147` — show version history via Icechunk
- `aeolus data checkout DATA-0147 --commit abc123` — access historical versions
- Time-travel queries: "load the version of this dataset from before the correction"

**Exit criteria:** A scientist can store versioned data, and an agent can access any historical version of a dataset by commit reference.

---

## Tech dependencies

```
Python 3.12+
boto3 / s3fs          — S3 upload/download, parallel transfers
zarr                  — Zarr metadata reading
xarray                — coordinate extraction (spatial bounds, time range)
pystac                — STAC Item/Collection creation
pystac-client         — STAC API queries (Phase 4)
icechunk              — version tracking (Phase 5)
PostGIS               — spatial queries on dataset bounds (already in Supabase)
click + rich          — CLI framework (already in pyproject.toml)
```

No new infrastructure. S3, Supabase Postgres (with PostGIS), and the STAC catalog are the storage layer. The CLI is the interface.

---

## What makes this world-class

Most scientific data management tools force you into one of two bad choices:

1. **Heavyweight catalog systems** (CKAN, OpenMetadata) — powerful but require separate infrastructure, web UIs, admin setup. Scientists don't adopt them because the overhead doesn't fit their workflow.
2. **Ad-hoc conventions** (naming schemes, README files, Slack messages) — zero overhead but zero discoverability. The scientist who produced the data is the only one who can find it.

The Aeolus CLI sits in the sweet spot:

- **Zero-decision storage.** `aeolus store` generates the path, extracts the metadata, uploads the data, and registers it in the catalog. The scientist makes no decisions about organization.
- **Instant discoverability.** The moment data is stored, it's findable by any query: program, domain, resolution, variable, time range, tag, experiment, or free text.
- **Agent-native.** `--format json` on every command. Data inventory in `aeolus brief`. Agents can plan experiments by checking what data already exists.
- **HPC-native.** Deferred upload, bandwidth limiting, SLURM integration. Works where scientists actually work, not just on their laptops.
- **Git-linked.** Every dataset traces back to the exact code that produced it. Reproducibility is automatic, not aspirational.
- **One tool.** The same CLI that logs experiments, records findings, and manages the knowledge graph also manages the data. No context switching between tools.

The compound effect: as the team stores more data through the CLI, `aeolus brief` gets richer, `aeolus gaps` gets smarter, and agents make better decisions about what to simulate next. The data layer feeds the knowledge layer feeds the research loop.

---

*Related:*
- *tickets/001-knowledge-graph-layer.md — entity/edge model that links to datasets*
- *prd/cli/README.md — main CLI PRD (artifact storage, STAC phase 5)*
- *prd/cli/github-integration.md — git provenance model*
- *prd/north-star-vision.md — data as the moat*
