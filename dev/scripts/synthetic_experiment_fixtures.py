"""Synthetic experiment payloads for KB stress testing.

Each item is a dict compatible with ExperimentCreate fields (after merging seed tag).
"""

from __future__ import annotations

SEED_MARKER = "seed-synthetic"


def _w(tag_base: str, extra: list[str] | None = None) -> list[str]:
    return [tag_base, *(extra or [])]


def all_phase1_fixtures() -> list[dict]:
    """Phase-1 creates: no related links (filled in phase 2)."""
    rows: list[dict] = []

    # --- weather-intervention: cloud physics, seeding, CCN ---
    wi_long = """## Context
WRF run with Thompson microphysics; domain centered on OK panhandle.

## What we did
- Spectral bin CCN at 800 / 1200 / 1600 cm⁻³
- Compared against bulk activation
- Surface σ_w from sonic ~0.45 m s⁻¹ (convective BL)

## Numbers
Peak reflectivity in seeded cell lagged control by ~6 min. Not sure if significant.

## TODO
- [ ] rerun with updated ice nucleation
- [ ] ask NWP about boundary layer depth sensitivity
"""
    rows.append(
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "human/mperez",
            "tags": _w("cloud-seeding", ["spectral-bin", "CCN", "wrf"]),
            "content": wi_long,
            "hypothesis": "Spectral bin shifts CCN-limited regime timing",
            "parameters": {
                "ccn": 1200,
                "scheme": "spectral_bin",
                "domain_km": 180,
                "nested": {"inner_dx_m": 500},
            },
            "results": {"precip_delta_pct": 5.8, "timing_lag_min": 6, "significant": False},
            "finding": "8% less enhancement than bulk at same CCN; timing signal noisy",
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "human/mperez",
            "tags": _w("cloud-seeding", ["ccn", "bulk"]),
            "content": "quick sanity: bulk at 1200 matches literature curve ok",
            "parameters": {"ccn": 1200, "scheme": "bulk"},
            "results": {"rmse_vs_lit": 0.04},
            "finding": "bulk baseline looks sane",
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "open",
            "source": "human/mperez",
            "tags": _w("cloud-seeding", ["backlog"]),
            "content": "idea: combine BL heating parameterization tweak + seeding run — check if CAPE changes dominate",
            "hypothesis": None,
            "parameters": {},
            "results": None,
            "finding": None,
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "running",
            "source": "codex/wi-batch-7",
            "tags": _w("aerosol", ["ccn"]),
            "content": "overnight WRF — monitoring; logs in `/scratch/wrf/out7`",
            "parameters": {"aod": 0.18, "modes": [0.05, 0.15, 0.35]},
            "results": None,
            "finding": None,
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "human/asonde-seed-script",
            "tags": _w("ice", ["temperature_C"]),
            "content": (
                "## Ice habit sensitivity\n"
                "Plate vs column — used P3. Temperature range −8 to −18 °C.\n"
                "μm-sized crystals dominate radar bright band in one case."
            ),
            "hypothesis": None,
            "parameters": {"habit": "column", "T_min_c": -18, "T_max_c": -8},
            "results": {"zdr_shift_db": 0.7, "samples": [12, 18, 22]},
            "finding": "Column habit slightly elevates Zdr in melting layer",
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "human/lchen",
            "tags": _w("radar", []),
            "content": None,
            "hypothesis": "Dual-pol signature differs for seeded vs natural",
            "parameters": {"radar": "KTLX", "elevation_deg": 0.5},
            "results": {"kdp_mean": 0.02, "zh_max_dbz": 52},
            "finding": "Inconclusive — storm merger confounded signal",
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "human/lchen",
            "tags": _w("CCN", ["case-study"]),
            "content": "one-liner: CCN=1600 run blew up numerically at t=45 min — need smaller timestep",
            "parameters": {"ccn": 1600, "dt_s": 6},
            "results": None,
            "finding": "numerical instability; reduce dt or limiter",
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "open",
            "source": "human/unknown",
            "tags": [],
            "content": "??? forgot what this was — maybe flight day 3?",
            "parameters": {},
            "results": None,
            "finding": None,
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "codex/review-queue",
            "tags": _w("cloud-seeding", ["ccn", "QC"]),
            "content": "# Hygroscopic flare test\n\nFlare B vs control. Humidity marginal.",
            "parameters": {"flare": "B", "rh_pct": [62, 64, 71]},
            "results": {"delta_lwc_g_m3": 0.03},
            "finding": "Marginal conditions; effect within sensor noise",
        }
    )
    rows.append(
        {
            "program": "weather-intervention",
            "status": "running",
            "source": "human/mperez",
            "tags": _w("field", ["P-3"]),
            "content": "in-flight notes: leg 4 spiral noisy, probe icing suspected",
            "parameters": {"flight_id": "P3-2026-03", "leg": 4},
            "results": None,
            "finding": None,
        }
    )
    for i in range(12):
        rows.append(
            {
                "program": "weather-intervention",
                "status": "complete" if i % 3 else "open",
                "source": f"human/field-tech-{i % 4}",
                "tags": _w("cloud-seeding", ["batch-march", f"run-{i}"]),
                "content": f"Sweep {i}: seed rate {1.2 + i * 0.1} L⁻¹; visual only; no radar yet.",
                "parameters": {"seed_rate": round(1.2 + i * 0.1, 2), "idx": i},
                "results": {"subjective": i % 2 == 0},
                "finding": "placeholder finding for list truncation tests" if i % 4 == 0 else None,
            }
        )

    # --- nwp-development: Breeze.jl, deterministic, metrics ---
    rows.append(
        {
            "program": "nwp-development",
            "status": "complete",
            "source": "human/breeze-ci",
            "tags": _w("breeze", ["julia", "regression"]),
            "content": """## Regression 2026-03-12
Driver: `test/atmosphere/thermo.jl`

```julia
@test isapprox(q_liq, 0.0012; rtol=1e-3)
```

Fails on Apple Silicon only — suspect FMA.
""",
            "hypothesis": None,
            "parameters": {"julia_version": "1.11", "arch": "aarch64"},
            "results": {"failed_cases": 1, "passed": 842},
            "finding": "Isolate thermo saturation adjustment on M-series",
        }
    )
    rows.append(
        {
            "program": "nwp-development",
            "status": "failed",
            "source": "human/breeze-ci",
            "tags": _w("breeze", ["solver"]),
            "content": "Newton solver did not converge in 50 iters for stiff column",
            "parameters": {"max_iter": 50, "dt": 0.5},
            "results": {"residual_norm": 1.2e-2},
            "finding": "divergence; needs line search",
        }
    )
    rows.append(
        {
            "program": "nwp-development",
            "status": "open",
            "source": "codex/refactor-thermo",
            "tags": _w("breeze", ["refactor"]),
            "content": "track: split moisture kernels from dynamics for GPU batching",
            "parameters": {},
            "results": None,
            "finding": None,
        }
    )
    rows.append(
        {
            "program": "nwp-development",
            "status": "running",
            "source": "human/dev",
            "tags": _w("dycore", ["benchmark"]),
            "content": "scaling study 1–64 GPUs; comms profile in perfetto trace",
            "parameters": {"ranks": [1, 2, 4, 8, 16, 32, 64]},
            "results": None,
            "finding": None,
        }
    )
    for i in range(14):
        rows.append(
            {
                "program": "nwp-development",
                "status": "complete" if i % 2 == 0 else "running",
                "source": "human/nwp-dev-bot" if i % 3 else "codex/nwp-batch",
                "tags": _w("breeze", [f"commit-{1000 + i}"]),
                "content": f"Nightly build {i}: RMSE vs reference {0.12 + i * 0.001:.4f}",
                "parameters": {"build": i, "grid": {"nx": 128, "ny": 128, "nz": 64}},
                "results": {"rmse": 0.12 + i * 0.001, "wall_s": 400 + i * 2},
                "finding": None,
            }
        )

    # --- energy-trading: messy business-facing notes ---
    rows.append(
        {
            "program": "energy-trading",
            "status": "complete",
            "source": "human/trader-anon",
            "tags": _w("ercot", ["wind"]),
            "content": (
                "ERCOT DA spike Tue — our wind bias model undercalled ramp by ~400MW "
                "between HE18-20. Need to check if NAM nest was late."
            ),
            "hypothesis": None,
            "parameters": {"iso": "ERCOT", "he_start": 18},
            "results": {"missed_mw": 400},
            "finding": "Blend NAM + HRRR for ramp hours",
        }
    )
    rows.append(
        {
            "program": "energy-trading",
            "status": "open",
            "source": "human/trader-anon",
            "tags": _w("gas", ["basis"]),
            "content": "unstructured: talk w/ origination — basis widened, storage withdraw schedule weird",
            "parameters": {},
            "results": None,
            "finding": None,
        }
    )
    rows.append(
        {
            "program": "energy-trading",
            "status": "complete",
            "source": "codex/signal-proto",
            "tags": _w("solar", ["forecast", "ml"]),
            "content": "# Solar forecast v0.3\n\nFeatures: clearsky index, aerosol AOD, neighbor farms.",
            "parameters": {"model": "xgb", "features": ["csi", "aod", "neighbor_mw"]},
            "results": {"mae_mw": 12.3, "crps": 8.1},
            "finding": "AOD from GEOS helps hazy days",
        }
    )
    for i in range(11):
        rows.append(
            {
                "program": "energy-trading",
                "status": "complete" if i % 2 else "open",
                "source": "human/desk-" + str(i % 3),
                "tags": _w("weather-desk", ["tick", str(i)]),
                "content": f"Load forecast tick {i}: HDD proxy vs realized; error {i * 0.1:.1f} σ.",
                "parameters": {"tick": i, "sigma": float(i) * 0.1},
                "results": {"signed_error": (-1) ** i * i},
                "finding": None,
            }
        )

    # --- shared: cross-program, meta, thin records ---
    rows.append(
        {
            "program": "shared",
            "status": "complete",
            "source": "human/ops",
            "tags": _w("meta", ["data-catalog"]),
            "content": "Documented STAC collection `aeolus-goes-mcmipc` — bbox and time split policy.",
            "parameters": {"collection": "aeolus-goes-mcmipc", "granules": 12000},
            "results": {"ingest_gb": 480},
            "finding": "Catalog stable; add projection note to item metadata",
        }
    )
    rows.append(
        {
            "program": "shared",
            "status": "running",
            "source": "human/ops",
            "tags": _w("infra", []),
            "content": "migrating bucket policy for Icechunk — in progress",
            "parameters": {"bucket": "aeolus-lake-dev"},
            "results": None,
            "finding": None,
        }
    )
    rows.append(
        {
            "program": "shared",
            "status": "open",
            "source": "codex/docs-sync",
            "tags": [],
            "content": "TODO: align CLI help with PRD section 4 (shortcuts)",
            "parameters": {},
            "results": None,
            "finding": None,
        }
    )
    for i in range(7):
        rows.append(
            {
                "program": "shared",
                "status": "complete",
                "source": "human/shared-pool",
                "tags": _w("cross-cutting", [f"initiative-{i % 3}"]),
                "content": f"Knowledge share #{i}: lightning climatology link rot check — {i} dead links",
                "parameters": {"urls_checked": 40 + i},
                "results": {"dead": i},
                "finding": "Refresh wiki table quarterly",
            }
        )

    return rows


def phase2_related_fixtures(anchor_a: str, anchor_b: str, anchor_c: str) -> list[dict]:
    """Creates that reference existing experiment IDs (graph edges)."""
    return [
        {
            "program": "weather-intervention",
            "status": "complete",
            "source": "human/sonde-seed-script",
            "tags": _w("cloud-seeding", ["follow-up", "related-test"]),
            "content": (
                f"## Follow-up\nLinks prior CCN sweep ({anchor_a}) and radar baseline ({anchor_b}). "
                "Combined interpretation pending."
            ),
            "hypothesis": "Joint analysis reduces ambiguity",
            "parameters": {"anchors": [anchor_a, anchor_b]},
            "results": None,
            "finding": "Document cross-reference only",
            "related": [anchor_a, anchor_b],
        },
        {
            "program": "nwp-development",
            "status": "complete",
            "source": "codex/graph-smoke",
            "tags": _w("breeze", ["related-test"]),
            "content": f"Regression triage tied to energy desk wind miss ({anchor_c}) — cross-program note.",
            "parameters": {},
            "results": None,
            "finding": "NWP bias may couple to trading signal",
            "related": [anchor_c],
        },
        {
            "program": "weather-intervention",
            "status": "open",
            "source": "human/sonde-seed-script",
            "tags": _w("cloud-seeding", ["related-test", "triad"]),
            "content": "Explicit triad link test for `show` graph rendering.",
            "parameters": {},
            "results": None,
            "finding": None,
            "related": [anchor_a, anchor_b, anchor_c],
        },
        {
            "program": "shared",
            "status": "complete",
            "source": "human/sonde-seed-script",
            "tags": _w("meta", ["related-test"]),
            "content": "Synthetic hub record linking three domains for UI stress.",
            "parameters": {"hub": True},
            "results": None,
            "finding": None,
            "related": [anchor_a, anchor_b],
        },
        {
            "program": "energy-trading",
            "status": "open",
            "source": "human/sonde-seed-script",
            "tags": _w("weather-desk", ["related-test"]),
            "content": "Forward link only to WI experiment for reverse_related queries.",
            "parameters": {},
            "results": None,
            "finding": None,
            "related": [anchor_a],
        },
    ]


def update_targets_phase2a() -> dict[str, list[int]]:
    """Map status -> indices into phase-1 created_ids for post-create updates.

    Indices are safe for len(phase1) >= 20.
    """
    return {
        "failed": [5, 17, 33, 48],
        "superseded": [19, 44],
    }
