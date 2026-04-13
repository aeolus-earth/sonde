# Aeolus Conventions

Standard naming, paths, and patterns used across the Aeolus research platform.

## S3 Storage

**Bucket:** `s3://aeolus-data/`

| Path pattern | What goes here |
|---|---|
| `experiments/{EXP-ID}/{filename}` | Simulation output linked to an experiment |
| `datasets/{collection}/{item-id}/{filename}` | Standalone datasets not tied to one experiment |

## STAC Collections

| Collection | Contains | STAC API |
|---|---|---|
| `nwp-simulations` | Breeze.jl, WRF, MPAS output | `https://stac.aeolus.earth` |
| `observations` | Radiosondes, satellite, radar | `https://stac.aeolus.earth` |
| `reanalysis` | ERA5, GFS, HRRR | `https://stac.aeolus.earth` |

**STAC API URL:** `https://stac.aeolus.earth` (or env var `STAC_API_URL`)

## Linking sonde ↔ STAC

**STAC → sonde:** Every STAC Item for experiment output has `properties.experiment_id` set to the sonde experiment ID (e.g., `EXP-0003`).

**Sonde → STAC:** Experiments with registered data have:
- Tag: `has-data`
- Metadata: `stac_items: ["nwp-simulations/EXP-0003-output"]`

**STAC Item ID convention:** `{EXP-ID}-output` (e.g., `EXP-0003-output`)

## Sonde Programs

| Program | Research area |
|---|---|
| `weather-intervention` | NWP simulations, cloud seeding, boundary layer experiments |
| `energy-trading` | Market signals, weather-to-energy, agent performance |
| `nwp-development` | Breeze.jl development, model validation |
| `shared` | Cross-cutting knowledge, methods, tools |

## File types

| File type | Where it goes |
|---|---|
| NetCDF, Zarr, GeoTIFF (geospatial) | S3 + STAC catalog |
| Figures, plots, GIFs (.png, .svg, .gif) | `sonde experiment attach` / `sonde artifact update` |
| CSVs, Parquet (tabular) | `sonde experiment attach` when the table is itself a result |
| PDFs | `sonde experiment attach` or `sonde project report` for canonical project reports |
| Notebooks, configs (.ipynb, .yaml, .toml) | Prefer git provenance; attach only when the file itself is the reviewed output |

## Artifact quality bar

Attach artifacts that are easy to interpret quickly:

- Prefer result artifacts over raw source files.
- Every attachment should have a caption/description explaining the takeaway.
- A polished PNG, GIF, PDF, or concise CSV summary is usually better than a raw
  notebook or config dump.
- If you must attach a raw notebook or config, pair it with a readable summary
  figure or memo.
- Use `sonde artifact update ART-XXXX -d "..."` to tighten captions after upload.

## Tags

Use consistent tags across experiments. Check existing tags with `sonde tags`.

Common vocabulary:
- Domain: `north-atlantic`, `subtropical`, `pacific`, `global`
- Method: `cloud-seeding`, `bl-heating`, `ice-nucleation`
- Scheme: `bulk-2moment`, `spectral-bin`, `morrison`
- Data: `has-data` (experiment has STAC-registered output)
- Status-related: `needs-review`, `baseline`, `superseded`
