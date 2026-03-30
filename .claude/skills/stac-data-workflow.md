# STAC Data Workflow

When an experiment produces geospatial output (NetCDF, Zarr, GeoTIFF), follow this workflow to register it in the data catalog and link it to the sonde experiment.

For non-geospatial files (figures, CSVs, PDFs, notebooks), skip this and use `sonde experiment attach` instead.

## When to use STAC

Use STAC when your output has **spatial coordinates** and **temporal extent**:
- NWP simulation output (precipitation grids, temperature fields)
- Satellite retrievals (cloud properties, radiation)
- Reanalysis data (ERA5 subsets, GFS forecasts)

Do NOT use STAC for:
- Figures and plots → `sonde experiment attach`
- CSVs of parameter sweeps → `sonde experiment attach`
- PDFs and notebooks → `sonde experiment attach`
- Agent progress files → just leave them in the experiment directory

## The workflow (5 steps)

### 1. Upload output files to S3

```bash
aws s3 cp output/ s3://aeolus-data/experiments/EXP-XXXX/ --recursive
```

Path convention: `s3://aeolus-data/experiments/{experiment-id}/{filename}`

### 2. Construct a STAC Item

Use this template. Fill in the placeholders:

```json
{
  "id": "EXP-XXXX-output",
  "type": "Feature",
  "stac_version": "1.0.0",
  "collection": "nwp-simulations",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [-60, 30], [-10, 30], [-10, 70], [-60, 70], [-60, 30]
    ]]
  },
  "bbox": [-60, 30, -10, 70],
  "properties": {
    "datetime": "2025-03-15T00:00:00Z/2025-03-17T00:00:00Z",
    "experiment_id": "EXP-XXXX",
    "model": "breeze",
    "resolution": "25km"
  },
  "assets": {
    "precipitation": {
      "href": "s3://aeolus-data/experiments/EXP-XXXX/precip.nc",
      "type": "application/x-netcdf",
      "title": "Precipitation output"
    },
    "temperature": {
      "href": "s3://aeolus-data/experiments/EXP-XXXX/temp.nc",
      "type": "application/x-netcdf",
      "title": "Temperature fields"
    }
  },
  "links": []
}
```

**Required fields:**
- `id`: Use `{experiment-id}-output` to link back to sonde
- `collection`: One of `nwp-simulations`, `observations`, `reanalysis`
- `geometry`: GeoJSON polygon of the spatial domain
- `bbox`: Bounding box [west, south, east, north]
- `properties.datetime`: ISO 8601 timestamp or range
- `properties.experiment_id`: The sonde experiment ID
- `assets`: One entry per output file, with S3 href

### 3. Register in STAC

Use the `stac_register_item` MCP tool:

```
Tool: stac_register_item
Arguments:
  collection: "nwp-simulations"
  item: <the JSON from step 2>
```

### 4. Link back to sonde

Add the `has-data` tag and STAC reference to the experiment:

```bash
sonde experiment tag add EXP-XXXX has-data
```

Also update the experiment's metadata frontmatter to include:

```yaml
metadata:
  stac_items:
    - nwp-simulations/EXP-XXXX-output
```

Then push: `sonde experiment push EXP-XXXX`

### 5. Verify

Search for the registered data:

```
Tool: stac_search
Arguments:
  collections: ["nwp-simulations"]
  query: {"experiment_id": {"eq": "EXP-XXXX"}}
```

## Searching for existing data

Before running a new experiment, check what data already exists:

```
Tool: stac_search
Arguments:
  bbox: [-60, 30, -10, 70]
  datetime: "2025-03-01/2025-03-31"
  collections: ["nwp-simulations"]
```

```
Tool: stac_list_collections
```

## Downloading data

STAC items contain asset URLs (S3 paths). Download with:

```bash
aws s3 cp s3://aeolus-data/experiments/EXP-XXXX/precip.nc ./local-data/
```

Or use the href from the STAC item's assets directly.
