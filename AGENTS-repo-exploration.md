# AGENTS.md — Sonde

This repository is an **experimental workspace** for exploring open-source numerical weather and atmosphere modeling codebases, with the long-term goal of designing **automatic research agents** that sit on top of our NWP stack: literature-to-code mapping, experiment orchestration, parameter and configuration search, and reproducible workflows tied to model APIs.

**Repo catalog and condensed summaries of every `notes/` deep dive:** [README.md](./README.md).

Agents working here should treat upstream code as **read-mostly reference material** unless a task explicitly says to patch a vendored tree for a local experiment.

---

## What we want to understand (each repository)

For **every** repo we study—not only NWP solvers—we want comparable answers so we can later **line patterns up side by side** and see **where the ecosystem is converging** (shared orchestration idioms, tool contracts, evaluation loops) versus where projects diverge.

| Lens | What to capture |
|------|------------------|
| **Tools** | Concrete **stack**: languages, dependency managers, frameworks, SDKs, and services the repo uses for automation, agents, CLIs, evaluation, or HPC (name + role; pin versions in notes when relevant). Include how humans or scripts are expected to invoke the system. |
| **Multi-agent coordination** | If the project implements or integrates **multi-agent** behavior: how **roles** are defined, how **control flow** works (sequential pipelines, graphs, debate, supervisor/worker, handoffs), how **state and artifacts** move between steps, and which **framework or library** (if any) coordinates agents. If there is **no** multi-agent layer—e.g. a pure numerical library—state that explicitly so we do not read coordination into it. |
| **Domain / model layer** (when applicable) | For physics and NWP code: how simulations are built and run, prognostic state, extension hooks—see [Success criteria](#success-criteria-for-understanding-a-new-vendored-model). |

**Cross-repo comparison (future):** Notes should use **consistent headings** (tools, coordination, domain) so we can **diff patterns across repos** and track **convergence**: e.g. many projects settling on similar graph-based orchestration, similar tool-calling boundaries, or similar eval harnesses. Occasional synthesis can live in `notes/` as `notes/pattern-synthesis-*.md` only when the team asks for a rollup.

**External compass for agent patterns:** [Tauric Research](https://github.com/TauricResearch) publishes multi-agent LLM-oriented work (e.g. **TradingAgents**—multi-agent LLM trading framework). We do **not** assume that stack matches our NWP product; we use orgs like this as **reference points** for how **multi-agent frameworks are coordinated in the wild**, to compare against patterns we extract from other repos.

---

## Repository layout (conventions)

| Path | Role |
|------|------|
| `vendor/` | Shallow clones or pinned snapshots of upstream repos for study and diffing. **Do not treat as the source of truth for our product code**—prefer linking to version pins (commit SHA, tag) in notes and experiments. |
| `repos/` | Same idea as `vendor/`, for **non-NWP** or **agent-framework** mirrors (e.g. orchestration reference code). Treat as read-mostly; analyze under `notes/<name>/`. |
| `experiments/` | (Optional) Small Julia/Python scripts or notebooks that *import* vendored or registered packages; keep these minimal and documented. |
| `notes/` | **Primary place we organize our thoughts** — see [Notes folder](#notes--how-we-organize-thoughts) below. |

If these folders do not exist yet, create them only when adding content that fits.

---

## `notes/` — how we organize thoughts

We use **`/notes`** to analyze **each vendored or referenced repository** in one place, aligned with [What we want to understand](#what-we-want-to-understand-each-repository): **tools**, **multi-agent coordination** (if any), and **domain/model** behavior when the repo is a simulator or library.

**Conventions:**

- **One focus per subtree** — e.g. `notes/breeze/`, `notes/<upstream-repo-name>/`, so analyses stay scoped and easy to diff over time.
- **Per-repo notes should cover (use these as section titles when possible):**
  - **Tools** — Stack, invocation paths, key dependencies; enough detail to reproduce or reason about automation.
  - **Multi-agent coordination** — Roles, control flow, handoffs, frameworks used to coordinate agents; or a one-line **“none”** for pure numerical / non-agent codebases.
  - **Domain / model** (if applicable) — Entry points, prognostics, extension hooks (as in [Success criteria](#success-criteria-for-understanding-a-new-vendored-model)).
  - **Pins** — Commit SHA or tag of the tree the note refers to, plus links to upstream docs/issues that informed the writeup.
  - **Comparison hooks** — Optional bullets: “**Similar to / unlike**” other repos we have notes for (e.g. orchestration style vs [Tauric Research](https://github.com/TauricResearch)-style multi-agent stacks)—helps future convergence analysis.
- **Goal** — These notes are working memory for building **our** research agents on top of the NWP model: they are not product docs, but they should be **accurate enough** that another agent or teammate can continue from them without re-reading all of `vendor/`.

When adding or editing notes, prefer **updating the existing repo-specific folder** over scattering one-off files at the root of `notes/`.

---

## Vendored reference: Breeze.jl (`vendor/Breeze.jl`)

**Upstream:** [NumericalEarth/Breeze.jl](https://github.com/NumericalEarth/Breeze.jl) — Julia library for atmospheric fluid dynamics (CPUs/GPUs), built on [Oceananigans.jl](https://github.com/CliMA/Oceananigans.jl).

**What it provides (high level):**

- **`AtmosphereModels/`** — Core `AtmosphereModel` type, interfaces for dynamics, thermodynamic formulations, microphysics, radiation hooks, diagnostics (potential temperature, static energy, precipitation-related fields).
- **`AnelasticEquations/`** — Anelastic dynamics, pressure Poisson solve, buoyancy.
- **`CompressibleEquations/`** — Compressible dynamics with split-explicit acoustic substepping.
- **`Thermodynamics/`** — Reference states, saturation, Clausius–Clapeyron, constants.
- **`PotentialTemperatureFormulations/`**, **`StaticEnergyFormulations/`** — Prognostic thermodynamic formulations and tendencies.
- **`Microphysics/`** — Saturation adjustment, Kessler-style schemes, bulk microphysics integration with CloudMicrophysics.jl patterns.
- **`BoundaryConditions/`** — Bulk drag, sensible/latent fluxes, thermodynamic BC helpers.
- **`KinematicDriver/`** — Prescribed flows for testing physics columns.
- **`ParcelModels/`** — Lagrangian parcel-style experiments.
- **`TimeSteppers/`** — SSP-RK3 and acoustic-related steppers used by compressible paths.
- **`Forcings/`**, **`TurbulenceClosures/`**, **`Advection.jl`**, **`VerticalGrids.jl`**, **`CelestialMechanics/`** — Supporting pieces.

**Dependency mental model:** Breeze re-exports many Oceananigans symbols (`RectilinearGrid`, `Simulation`, `run!`, `WENO`, fields, grids, writers). Understanding a feature often requires **both** Breeze’s `src/` and Oceananigans docs for the underlying grid/operator/advection machinery.

**Citing upstream:** Follow the citation block in the upstream README (Zenodo DOI) when publishing work that relies on Breeze.

---

## How agents should work in this repo

1. **Notes first for new repos** — When onboarding a vendored project or answering “how does X work / how is it orchestrated?”, **read or create** the matching material under `notes/<repo>/` so findings accumulate. Do not leave one-off conclusions only in chat.
2. **Scope** — Prefer small, reviewable changes. Do not refactor entire vendored trees; fork or branch upstream if a change belongs there.
3. **Truth source** — For behavior of Breeze/Oceananigans, trust the **checked-in `vendor/` snapshot** plus **upstream docs** for the matching version. If the snapshot is stale, update it with a recorded commit SHA in a note or `vendor/README` snippet (add only if the team wants version pins documented here).
4. **Research-agent directions** (for future tooling, not mandatory in every PR):
   - Map **paper equations / parameterizations** to **named types and functions** in Breeze (and later other vendored models).
   - Define **experiment templates**: grid, dynamics choice, microphysics, outputs, and success metrics.
   - Keep **reproducibility**: random seeds, package versions (`Project.toml`/`Manifest.toml` when Julia experiments appear), and explicit data paths.
5. **Licensing** — Respect each vendored project’s license. Do not merge incompatible licenses into a single binary artifact without review.
6. **Markdown policy** — Add or expand standalone `.md` files only when asked (this file is the exception as requested). **Exception:** team-authored analysis under `notes/` is encouraged when it follows the [notes conventions](#notes--how-we-organize-thoughts); avoid unrelated markdown elsewhere.

---

## Updating the Breeze.jl vendor copy

From the repo root (`Sonde`):

```bash
cd vendor/Breeze.jl && git fetch origin && git checkout main && git pull
```

For a **clean pinned snapshot** (recommended before locking an experiment):

```bash
cd vendor/Breeze.jl && git rev-parse HEAD
```

Record that SHA next to the experiment or in team notes.

---

## Related upstream reading

- Breeze docs: [BreezeDocumentation](https://numericalearth.github.io/BreezeDocumentation/dev/)
- Oceananigans docs (shared concepts): [OceananigansDocumentation](https://clima.github.io/OceananigansDocumentation/stable/)

---

## Success criteria for “understanding” a new vendored model

The [What we want to understand](#what-we-want-to-understand-each-repository) table applies to **all** repos (tools + coordination + domain). The checklist below is the **domain/model** slice for **numerical atmosphere and NWP** code. For repos that are primarily **agent frameworks**, prioritize **tools** and **multi-agent coordination** in notes; use this list only if they also embed a simulator or API you must call.

Before proposing agent automation on top of a new codebase, summarize:

1. **Entry point** — Main module and how a minimal simulation is constructed and run.
2. **Prognostic state** — What fields are stepped; what closures/physics plug in.
3. **Extension points** — Where new physics, forcings, or output hooks attach.
4. **Compute story** — CPU vs GPU, MPI/distributed if any, and typical dependencies.

This keeps agent design grounded in real APIs rather than hand-wavy “NWP in general.”
