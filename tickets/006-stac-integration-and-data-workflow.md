# 006: STAC Integration and Data Workflow

## Problem

Aeolus has a running STAC API (`vendor/stac-db/`) that catalogs geospatial data — NWP simulation output, ERA5 reanalysis, satellite products. Sonde tracks research knowledge — experiments, findings, questions. These are separate systems that need to work together seamlessly.

Right now there's no connection between them. An agent that runs a simulation has no easy way to register the output in STAC and link it to their sonde experiment. A researcher looking at an experiment has no way to find the associated data files. The two systems are invisible to each other.

## Principles

**Sonde does not wrap STAC.** They're independent services. Sonde talks to Supabase. STAC is its own API on its own database (pgSTAC). The coupling is:

1. A string reference (sonde experiment → STAC item ID)
2. A skill that teaches agents the workflow
3. `sonde setup` that ensures both tools are configured

**Sonde does not proxy STAC API calls.** Claude Code (or any agent) talks to the STAC API directly. STAC has a well-designed REST interface. The agent doesn't need a middleman.

**STAC is for geospatial data. Sonde is for everything else.**

| | Sonde | STAC |
|---|---|---|
| **Stores** | Research: experiments, findings, notes, figures, PDFs, notebooks | Geospatial assets: NetCDF, Zarr, COGs with spatial coordinates |
| **Search by** | Full-text, tags, metadata, program, author, date | Bounding box, datetime range, collection, CQL2 |
| **Content** | The experiment IS the document | The catalog POINTS to files in S3 |
| **Schema** | Freeform markdown + minimal metadata | GeoJSON + required geometry + temporal extent |

## Responsibility matrix

| Responsibility | Owner |
|---|---|
| Experiment tracking (log, search, brief, lifecycle) | **Sonde** |
| Research content (markdown, findings, questions, notes) | **Sonde** |
| Non-geospatial files (figures, PDFs, CSVs, notebooks) | **Sonde** (Supabase Storage) |
| Activity log (who did what when) | **Sonde** |
| Auth (Google SSO, agent tokens, program scoping) | **Sonde** |
| Local workspace (pull/push, .sonde/ directory) | **Sonde** |
| Geospatial data catalog (search by bbox, datetime) | **STAC MCP** |
| Data registration (create STAC Items) | **STAC MCP** |
| Data health (API status, collection stats) | **STAC MCP** |
| S3 file upload | **aws cli / boto3** (neither sonde nor STAC) |
| Workflow orchestration (sonde + STAC + S3 together) | **Skills** (teach agents the pattern) |
| S3 path conventions, STAC collection definitions | **Skills** (document conventions) |
| Linking experiment ↔ STAC item | Sonde stores the ref, STAC stores the item, **skill teaches the pattern** |
| MCP server registration (both sonde + stac) | **`sonde setup`** |
| STAC MCP installation (ensure binary available) | **`sonde setup`** |
| Dependency/health checks (STAC reachable, S3 creds) | **`sonde setup`** |
| Credential guidance (STAC API key, S3 profile) | **`sonde setup`** |

## What to build

### 1. STAC MCP server (~150 lines)

A thin standalone MCP server that wraps the STAC API. Lives in `vendor/stac-db/mcp/` or a small separate package. Not part of sonde.

**Tools exposed:**

| Tool | What it does |
|---|---|
| `search` | POST /search with bbox, datetime, collections, CQL2 filters |
| `get_item` | GET /collections/{id}/items/{item_id} |
| `register_item` | POST /collections/{id}/items (create a STAC Item) |
| `list_collections` | GET /collections |
| `get_collection` | GET /collections/{id} |

**Config:** STAC API URL passed as arg or env var. No Supabase dependency. No sonde dependency. Pure HTTP client.

### 2. Update `sonde setup` to configure the full environment

Currently setup does: auth check → install skills → configure sonde MCP → verify connectivity.

Add:

```
[3/5] STAC MCP
      ✓ stac-mcp found at /usr/local/bin/stac-mcp
      ✓ Registered in .claude/settings.json
      ✓ STAC API reachable at https://stac.aeolus.earth
      ✓ 3 collections: nwp-simulations, observations, market-data

[4/5] S3 Access
      ✓ AWS credentials found (profile: aeolus)
      ✓ Bucket aeolus-data accessible
```

Setup checks:
- Is `stac-mcp` binary installed? If not, print install instructions.
- Is the STAC API reachable? If not, warn (non-blocking — sonde works without STAC).
- Are AWS credentials configured? If not, guide the user.
- Register STAC MCP in `.claude/settings.json` alongside sonde MCP.

The resulting settings.json:
```json
{
  "mcpServers": {
    "sonde": {
      "command": "sonde",
      "args": ["mcp", "serve"]
    },
    "stac": {
      "command": "stac-mcp",
      "args": ["--api-url", "https://stac.aeolus.earth"]
    }
  }
}
```

### 3. Skills that teach the full workflow

**`stac-data-workflow.md`** — teaches agents how to:

- Upload simulation output to S3 (`aws s3 cp`)
- Register data in STAC (construct a STAC Item JSON, POST to API)
- Link the STAC item back to the sonde experiment (add `stac_items` to frontmatter metadata)
- Search for data by region/time (POST /search)
- Download data from S3 using STAC asset URLs

**`aeolus-conventions.md`** — documents:

- S3 bucket: `s3://aeolus-data/`
- S3 path convention: `experiments/{EXP-ID}/{filename}` for experiment output, `datasets/{collection}/{item-id}/` for standalone datasets
- STAC collections: `nwp-simulations` (Breeze.jl output), `observations` (radiosonde, satellite), `market-data` (energy feeds)
- STAC Item `properties.experiment_id` field links back to sonde
- Sonde experiment `metadata.stac_items` field links to STAC
- The `has-data` tag convention on sonde experiments that have registered STAC data

**Updated `sonde-research.md`** — references the data workflow:

> When your experiment produces geospatial output (NetCDF, Zarr), follow the data workflow in `stac-data-workflow.md` to register it. For non-geospatial files (figures, CSVs, PDFs), use `sonde attach`.

### 4. STAC collections for Aeolus data types

Define and create the initial collections in the STAC API:

**`nwp-simulations`** — Breeze.jl and other NWP model output
- Required properties: `model`, `resolution`, `experiment_id`
- Spatial extent: global (varies by experiment)
- Temporal extent: per-simulation

**`observations`** — radiosonde, satellite, radar
- Required properties: `instrument`, `platform`
- Standard EO extensions

**`reanalysis`** — ERA5, GFS, HRRR (input data)
- Required properties: `product`, `level_type`
- These may already exist if other Aeolus services populate them

**`market-data`** — energy prices, grid load (non-geospatial)
- This one is questionable for STAC (no spatial extent)
- May be better as sonde artifacts with metadata
- Decision: only put it in STAC if it has grid-level spatial resolution

## What NOT to build

- `sonde register` command — agents use the STAC MCP directly
- `sonde data list/pull` commands — agents query STAC MCP directly
- STAC proxy in sonde — no wrapping, no middleman
- Automatic sync between sonde and STAC — the skill teaches the pattern, agents execute it
- Data processing or transformation — out of scope for both sonde and STAC

## Agent experience (end state)

A researcher says: "Run the CCN sensitivity experiment and upload all the results."

The agent (Claude Code with both MCP servers + skills):

```bash
# 1. Set up the experiment in sonde
sonde experiment new --title "CCN 1500 spectral bin"
# writes the research document...
sonde experiment push ccn-1500-spectral-bin
# → EXP-0003 created, git provenance captured

# 2. Run the simulation
julia run_breeze.jl --config configs/ccn-1500.yaml
# → produces output/precip.nc, output/cloud.nc

# 3. Upload output to S3
aws s3 cp output/ s3://aeolus-data/experiments/EXP-0003/ --recursive

# 4. Register in STAC (via STAC MCP tool)
# Agent constructs STAC Item JSON and calls register_item tool:
{
  "id": "EXP-0003-output",
  "collection": "nwp-simulations",
  "geometry": {"type": "Polygon", "coordinates": [[-60,30],[-10,30],[-10,70],[-60,70],[-60,30]]},
  "properties": {
    "datetime": "2025-03-15T00:00:00Z/2025-03-17T00:00:00Z",
    "experiment_id": "EXP-0003",
    "model": "breeze",
    "resolution": "25km"
  },
  "assets": {
    "precipitation": {"href": "s3://aeolus-data/experiments/EXP-0003/precip.nc"},
    "cloud": {"href": "s3://aeolus-data/experiments/EXP-0003/cloud.nc"}
  }
}

# 5. Link STAC item back to sonde experiment
sonde experiment tag add EXP-0003 has-data
# update frontmatter with stac ref...
sonde experiment push EXP-0003

# 6. Attach non-geospatial files to sonde directly
sonde experiment attach EXP-0003 figures/comparison.png
```

The researcher said one thing. The agent did 6 steps. The skill taught the pattern. Sonde and STAC each did their job. Everything is linked and discoverable.

## Build order

1. **STAC MCP server** — standalone, ~150 lines, 5 tools
2. **STAC collections** — define and create nwp-simulations, observations, reanalysis
3. **Skills** — stac-data-workflow.md, aeolus-conventions.md, update sonde-research.md
4. **Update `sonde setup`** — STAC MCP registration, health check, S3 credential check
5. **Test end-to-end** — agent runs full workflow with both MCP servers

## Acceptance criteria

- `sonde setup` configures both MCP servers in one command
- `sonde setup` warns (but doesn't fail) if STAC API is unreachable
- `sonde setup` checks for AWS credentials and guides if missing
- Claude Code can call both `sonde` and `stac` MCP tools in one session
- The skill teaches a complete upload + register + link workflow
- STAC items have `experiment_id` linking back to sonde
- Sonde experiments have `has-data` tag and `stac_items` in metadata linking to STAC
- Geospatial data goes to STAC. Everything else goes to sonde attach. No ambiguity.
