# Obsidian as a Living Knowledge Base for Aeolus

## The core idea

The knowledge base is the sleeper. Everyone focuses on the agent stuff because it's flashy, but the accumulated knowledge base — every simulation, every analysis, every finding, indexed and queryable — might be the most valuable thing Sonde produces. That's the thing that compounds. Simulation number 10,000 is informed by the 9,999 before it. That's a genuine moat.

But it only works if you design the data model early. Every agent action needs structured metadata: what simulation was analyzed, what question was asked, what was found, what figures were produced. Bolt this on later and it's a mess. Design it in from the start and it becomes the foundation.

## Why Obsidian

Obsidian vaults are just folders of markdown files. No proprietary database, no vendor lock-in, no server. Git-friendly. Human-readable. And as of 1.12.4+, there's a full CLI that lets you do everything from the terminal that you can do in the app — which means agents can read, write, search, tag, and link notes programmatically.

The key properties that matter for this use case:

- **Local-first, plain markdown.** Every note is a `.md` file. Grep works. Git works. Agents can read/write with standard file tools even without the CLI.
- **Structured frontmatter properties.** YAML frontmatter on every note = structured metadata that Obsidian indexes and the CLI can get/set.
- **Bidirectional links + backlinks.** `[[run-2026-03-15-hurricane-ida]]` in an analysis note automatically creates a backlink from the run note. The knowledge graph builds itself.
- **Tags as a first-class taxonomy.** `#breeze/compressible`, `#flood/coastal`, `#verification/passed` — hierarchical, searchable, countable.
- **Full-text search from CLI.** `obsidian search query="hurricane convective parameterization" format=json` — agents can query the entire knowledge base.
- **Dataview plugin (community).** SQL-like queries over frontmatter properties across all notes. "Show me every run where `grid_resolution < 1km` and `verification_status = passed`" — without a database.

## What the CLI gives us for automation

The Obsidian CLI (requires 1.12.4+, app running) exposes everything an agent needs:

### Creating and writing notes
```bash
# Create a new run log from a template
obsidian create name="run-2026-03-15-hurricane-ida" template=SimulationRun

# Append findings to an existing analysis
obsidian append file="run-2026-03-15-hurricane-ida" content="## Agent analysis (2026-03-26)\n\nPeak surge 3.2m at gauge TX-042..."

# Prepend a status update
obsidian prepend file="run-2026-03-15-hurricane-ida" content="> [!warning] Re-analyzed: CFL violation detected at t=14400s"
```

### Structured metadata via properties
```bash
# Set structured frontmatter on a run note
obsidian property:set name=model value=Flood.jl file="run-2026-03-15-hurricane-ida"
obsidian property:set name=git_sha value=a3f7c21 file="run-2026-03-15-hurricane-ida"
obsidian property:set name=git_tag value=v0.3.1 file="run-2026-03-15-hurricane-ida"
obsidian property:set name=grid_resolution value=500m file="run-2026-03-15-hurricane-ida"
obsidian property:set name=verification_status value=passed file="run-2026-03-15-hurricane-ida"
obsidian property:set name=cloud_job_id value=aeolus-job-8832 file="run-2026-03-15-hurricane-ida"
obsidian property:set name=zarr_path value="s3://aeolus-runs/2026-03-15/hurricane-ida.zarr" file="run-2026-03-15-hurricane-ida"

# Read a property back
obsidian property:read name=zarr_path file="run-2026-03-15-hurricane-ida"
```

### Search and discovery
```bash
# Full-text search across all notes
obsidian search query="coastal boundary surge" format=json

# Search with context around matches
obsidian search:context query="Green-Ampt infiltration" limit=10

# List all tags with counts
obsidian tags counts

# Find all notes with a specific tag
obsidian tag name="verification/failed" verbose
```

### Reading content back (agent can query the KB)
```bash
# Read a note's content
obsidian read file="run-2026-03-15-hurricane-ida"

# Get file metadata
obsidian file file="run-2026-03-15-hurricane-ida"

# See what links to a note (what analyses reference this run?)
obsidian backlinks file="run-2026-03-15-hurricane-ida" format=json

# Find orphan notes (runs nobody has analyzed)
obsidian orphans
```

### Daily log for agent activity
```bash
# Append to today's daily note — automatic activity log
obsidian daily:append content="- 14:32 — Ran verification on [[run-2026-03-15-hurricane-ida]], surge RMSE 0.42m #verification/passed"
```

## Proposed data model

### Note types (use templates)

**Simulation Run** (`runs/`)
```yaml
---
type: run
model: Flood.jl          # or Breeze.jl, Danger.jl
version: v0.3.1
git_sha: a3f7c21
git_tag: v0.3.1
repo: NumericalEarth/Flood.jl
cloud_job_id: aeolus-job-8832
cloud_provider: AWS
instance_type: g5.xlarge
started: 2026-03-15T08:00:00Z
completed: 2026-03-15T09:42:00Z
wall_time_s: 6120
grid_resolution: 500m
domain_bbox: [-95.5, 28.5, -93.0, 30.5]
zarr_path: s3://aeolus-runs/2026-03-15/hurricane-ida.zarr
config_path: configs/hurricane-ida-500m.toml
verification_status: passed
tags: [flood, coastal, hurricane, gpu]
---
```

**Analysis** (`analyses/`)
```yaml
---
type: analysis
run: "[[run-2026-03-15-hurricane-ida]]"
question: "How does peak surge compare to ADCIRC hindcast?"
agent: claude-opus-4
figures: [fig-surge-comparison.png, fig-timeseries-tx042.png]
finding: "Peak surge within 0.3m of ADCIRC at all coastal gauges"
created: 2026-03-26
tags: [verification, surge, adcirc-comparison]
---
```

**Experiment** (`experiments/`)
```yaml
---
type: experiment
runs: ["[[run-001]]", "[[run-002]]", "[[run-003]]"]
hypothesis: "Doubling grid resolution reduces surge RMSE by >30%"
result: confirmed
metric: surge_rmse
baseline_value: 0.62
best_value: 0.28
tags: [resolution-study, surge]
---
```

**Literature note** (`literature/`)
```yaml
---
type: literature
doi: 10.1016/j.jcp.2010.04.016
authors: [Bates, Horritt, Fewtrell]
year: 2010
relevant_to: ["[[Flood.jl]]", "[[SWE]]"]
key_equation: "local inertial approximation eq. 7"
tags: [shallow-water, local-inertial, foundational]
---
```

### Folder structure
```
aeolus-vault/
├── runs/              # One note per cloud simulation
├── analyses/          # Agent-generated analysis notes
├── experiments/       # Multi-run comparisons and studies
├── literature/        # Paper notes linked to code
├── models/            # Notes on Breeze.jl, Flood.jl, Danger.jl
├── daily/             # Auto-populated activity log
├── templates/         # SimulationRun, Analysis, Experiment, Literature
└── agents/            # Agent session logs (optional)
```

### Link conventions

Use `[[wikilinks]]` everywhere so Obsidian builds the graph automatically:

- Run notes link to their config, model version, and any literature that informed the setup
- Analysis notes link to the run(s) they analyze
- Experiment notes link to all runs in the study
- Literature notes link to the model code that implements the paper's equations

The backlinks are the magic — open any run note and immediately see every analysis, experiment, and paper that references it.

## How agents interact with the vault

### Post-simulation hook
After every cloud job completes, an agent (or a simple script) should:

1. `obsidian create` a run note from the SimulationRun template
2. `obsidian property:set` all structured metadata (git SHA, tag, job ID, Zarr path, wall time, etc.)
3. `obsidian daily:append` a one-liner to the activity log
4. `obsidian append` the run config and any stdout/stderr summary

### Agent research session
When an agent is asked to analyze a run or investigate a question:

1. `obsidian search` the vault for prior work on the same topic
2. `obsidian backlinks` on the run note to see what's already been done
3. Do the analysis
4. `obsidian create` an analysis note with findings, figures, linked runs
5. `obsidian append` to the run note with a summary and link back to the analysis

### Periodic maintenance
- `obsidian orphans` — find runs that nobody has analyzed
- `obsidian tag name="verification/failed"` — find broken runs
- `obsidian unresolved` — find broken links (references to runs or notes that don't exist)
- `obsidian deadends` — find notes that link to nothing (isolated knowledge)

## What this gets you over time

**Month 1:** A few dozen run notes with metadata. Mildly useful.

**Month 6:** Hundreds of runs, cross-linked analyses, resolution studies, verification campaigns. An agent asked "what do we know about coastal surge accuracy?" can search the vault and find every relevant run, analysis, and experiment — with Zarr paths to pull the actual data.

**Year 1:** Thousands of runs. The vault is a queryable history of every simulation Aeolus has ever produced. New experiments are designed by agents that first search for what's already been tried. Literature notes connect papers to the code that implements them. The knowledge graph in Obsidian's graph view is a literal map of everything the team knows.

**The compounding effect:** Every new run is cheaper to analyze because the agent has context from all prior runs. Every new experiment is better designed because the agent knows what's been tried. Every new team member (human or agent) can cold-start from the vault instead of asking "has anyone ever run this before?"

## What to build first

1. **Templates** for the four note types (run, analysis, experiment, literature)
2. **Post-simulation hook** that auto-creates run notes with metadata after every cloud job
3. **Tag taxonomy** — decide the top-level tags now (`#breeze`, `#flood`, `#danger`, `#verification`, `#experiment`, etc.)
4. **Property schema** — decide the required frontmatter fields per note type now; adding them later across hundreds of notes is painful

The Obsidian CLI + Dataview plugin + agents that read/write the vault = a living knowledge base that grows with every simulation. The orchestration framework might change. The models will improve. But the knowledge base compounds forever.

## STAC + Obsidian: catalog of data meets catalog of knowledge

The STAC thing is big. Possibly the most important infrastructure decision in the whole project.

Think about what STAC gives an agent. Right now the hardest part of the research loop isn't the analysis — it's finding the right data. Which simulation run, which output file, what time range, what spatial extent, what variables are available. STAC is literally a searchable API that answers all of those questions. An agent that can query your STAC catalog can go from "show me yesterday's ERCOT wind forecast" to the exact Zarr asset URL without any hardcoded path logic, without knowing your storage hierarchy, without anyone maintaining a lookup table. The agent just searches the catalog the same way a scientist would browse it — except it does it in milliseconds. That's the difference between an agent that breaks every time you reorganize your storage and one that's robust to infrastructure changes because it discovers data through metadata rather than paths.

And STAC items carry their spatial and temporal extent, their coordinate reference system, available variables, resolution — all the information an agent needs to do smart subsetting through Icechunk without anyone teaching it the structure of each dataset. The agent reads the STAC metadata and knows what it's working with. That's half the "data retrieval" capability in the PRD solved by infrastructure you already have.

### The two-catalog insight

**STAC is the catalog of data. Obsidian is the catalog of knowledge.**

STAC answers "where is the simulation output and what does it contain." Obsidian answers "what did we learn from it." Those are two fundamentally different things and you need both.

### Why the graph structure matters

What makes Obsidian specifically interesting rather than, say, a Postgres database of findings:

The graph structure maps naturally to how atmospheric science knowledge actually connects. A note on a specific simulation result links to the experiment design that motivated it, which links to the hypothesis it was testing, which links to the prior finding that generated that hypothesis, which links to the three other experiments that tested related hypotheses. That's a knowledge graph, and Obsidian gives you one for free with bidirectional links. An agent that can traverse those links can answer "what do we know about CCN sensitivity in outer rainbands" not by doing a keyword search but by following the actual chain of reasoning across experiments.

### Why markdown is underrated

The fact that it's markdown is underrated. Every note is human-readable and human-editable. Scientists can browse the knowledge base in Obsidian's UI, add their own annotations, correct the agent's interpretations, draw connections the agent missed. It's a shared workspace between the AI and the humans. If you used a database, the knowledge base would be opaque to everyone except the agent. With Obsidian, Danny can open the vault, see what Sonde concluded about a seeding experiment, disagree with the interpretation, edit the note, and the agent picks up the correction next time it references that finding. That's the human-in-the-loop for knowledge, not just for execution.

### How the two catalogs connect

Run notes in Obsidian should carry the STAC item ID (or collection + item) as a frontmatter property. That's the bridge:

```yaml
---
type: run
stac_collection: aeolus-flood-runs
stac_item_id: run-2026-03-15-hurricane-ida
# ... other properties
---
```

An agent doing research:
1. Searches **Obsidian** for prior knowledge ("what do we know about surge accuracy at this resolution?")
2. Finds linked run notes with STAC IDs
3. Queries **STAC** for the actual data assets (Zarr paths, extents, variables)
4. Loads data through **Icechunk** using STAC-provided metadata
5. Writes findings back to **Obsidian** with links to the runs

The knowledge compounds in Obsidian. The data stays discoverable through STAC. Neither replaces the other.

## Open questions

- **Sync:** Obsidian Sync (paid) vs git-backed vault? Git is more natural for the team but Obsidian Sync handles conflicts better for concurrent writes.
- **Multi-user:** If multiple agents write to the vault concurrently, need a locking strategy or append-only pattern to avoid conflicts.
- **Binary assets:** Figures and plots — store in vault (bloats git) or store in S3 with links in notes?
- **Dataview vs native search:** Dataview plugin is powerful but community-maintained. How much to depend on it vs. native CLI search + properties?
- **Obsidian app required:** The CLI requires the Obsidian app to be running. For headless CI/server environments, fall back to direct file I/O on the markdown files (they're just files). The CLI is a convenience layer, not a dependency.
