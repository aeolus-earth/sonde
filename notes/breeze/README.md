# Breeze.jl

Upstream: [NumericalEarth/Breeze.jl](https://github.com/NumericalEarth/Breeze.jl)  
Local mirror: `vendor/Breeze.jl`

## Pins

| | |
|---|---|
| **Commit (this clone)** | `f3536905d08b216543d991ab4ea537a0e10523ce` |
| **Package version** (`Project.toml`) | `0.4.3` |
| **Julia compat** | `1.11.9` |
| **Oceananigans compat** | `0.106.3` |

---

## Tools

- **Language**: Julia
- **Core runtime**: **Oceananigans.jl** for grids, fields, simulation loop, output writers, checkpoints, CPU/GPU architectures
- **GPU path**: `GPU()` architecture via Oceananigans; examples explicitly use **CUDA.jl**
- **Optional physics**: **CloudMicrophysics.jl**, **RRTMGP.jl**
- **Output / persistence**: **JLD2Writer**, **NetCDFWriter**, **Checkpointer**
- **Benchmarking**: dedicated CLI-style scripts under `benchmarking/`

Invocation is library-first. Typical usage is:

1. choose `CPU()` or `GPU()`,
2. build a `RectilinearGrid`,
3. build an `AtmosphereModel`,
4. wrap it in `Simulation`,
5. configure timestep control and output writers,
6. call `run!`.

## Multi-agent coordination

**None.**

Breeze is a numerical modeling library. It does not implement any in-repo agent runtime, planning loop, or supervisor/worker coordination layer.

## Domain / model

### Entry point

The package re-exports Oceananigans concepts and exposes atmospheric-specific types from a single module. The practical entry point is:

- `RectilinearGrid(CPU() | GPU(); ...)`
- `AtmosphereModel(grid; ...)`
- `Simulation(model; ...)`
- `conjure_time_step_wizard!(simulation; ...)`
- `run!(simulation)`

### Prognostic state and physics

`AtmosphereModel` assembles:

- dynamics (`AnelasticDynamics`, `CompressibleDynamics`, prescribed / kinematic variants),
- thermodynamic formulation,
- momentum and velocity fields,
- moisture density and microphysical fields,
- tracers,
- advection,
- Coriolis / forcing,
- closure fields,
- radiation,
- timestepper.

The constructor materializes boundary conditions, dynamics, formulation, momentum, microphysics, forcing, closure fields, and time stepping in one place. This is the main API surface Sonde would need to target when generating experiments.

### Compute story

- **CPU and GPU** are selected by grid architecture.
- Examples use **CUDA.jl** explicitly for GPU checks and seeding.
- Benchmark tooling includes **warmup steps for JIT compilation**, which is an operational clue that compile latency matters in practice.
- Breeze exposes Oceananigans output/checkpoint machinery, which supports file-based runs and restart-oriented workflows.

## Execution implications for Sonde

Breeze looks better suited to a **job-oriented execution model** than to a fully interactive agent shell that repeatedly boots Julia on demand.

Recommended shape:

- agent prepares configs / scripts / experiment specs,
- a persistent Julia worker or queued job runner executes Breeze,
- outputs and checkpoints are written to files/object storage,
- the agent analyzes artifacts after the run.

This avoids paying Julia + CUDA compilation latency on every small agent action and keeps long GPU runs out of the agent control loop.

## Comparison hooks

- **Unlike** agent frameworks in `repos/`, Breeze has no orchestration layer at all; Sonde must supply that layer.
- **Similar to** other scientific runtimes that are best treated as execution backends behind a thinner orchestration/control plane.
