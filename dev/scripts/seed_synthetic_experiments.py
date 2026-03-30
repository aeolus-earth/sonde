#!/usr/bin/env python3
"""Seed Supabase with synthetic experiments for CLI stress testing.

Run from repo root (or anywhere) with the CLI venv and auth session:

  cd cli && uv run python ../dev/scripts/seed_synthetic_experiments.py

Requires: sonde login (or SONDE_TOKEN), same as the CLI.

See README-seed.md in this directory for verification commands.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPTS_DIR.parent.parent
_CLI_SRC = _REPO_ROOT / "cli" / "src"

sys.path.insert(0, str(_CLI_SRC))
sys.path.insert(0, str(_SCRIPTS_DIR))

from dotenv import load_dotenv

load_dotenv(_REPO_ROOT / ".env")
load_dotenv(_REPO_ROOT / "cli" / ".env")
load_dotenv()

from synthetic_experiment_fixtures import (
    SEED_MARKER,
    all_phase1_fixtures,
    phase2_related_fixtures,
    update_targets_phase2a,
)
from sonde.db import experiments as db
from sonde.db.activity import log_activity
from sonde.models.experiment import ExperimentCreate


def _existing_seed_count(seed_tag: str) -> int:
    batch: list = []
    offset = 0
    page = 200
    while True:
        chunk = db.list_experiments(tags=[seed_tag], limit=page, offset=offset)
        if not chunk:
            break
        batch.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return len(batch)


def _fixture_to_create(row: dict, seed_tag: str) -> ExperimentCreate:
    tags = [seed_tag, *row.get("tags", [])]
    return ExperimentCreate(
        program=row["program"],
        status=row["status"],
        source=row.get("source", "human/sonde-seed-script"),
        tags=tags,
        content=row.get("content"),
        hypothesis=row.get("hypothesis"),
        parameters=row.get("parameters") or {},
        results=row.get("results"),
        finding=row.get("finding"),
        related=list(row.get("related") or []),
        git_commit=None,
        git_repo=None,
        git_branch=None,
        metadata={},
    )


def _run_notes(sonde_bin: str, ids: list[str], seed_tag: str) -> None:
    samples = [ids[i] for i in range(0, len(ids), 7)][:12]
    bodies = [
        "Curator note: verify parameters JSON still renders in table view.",
        "Follow-up: cross-check against findings list when wired.",
        "Seed script: synthetic note for recent activity feed.",
        "Edge case: unicode in note — σ estimated at 0.4 from in-situ.",
        "TODO: replace with real human note after demo.",
    ]
    for j, exp_id in enumerate(samples):
        text = bodies[j % len(bodies)]
        r = subprocess.run(
            [sonde_bin, "note", exp_id, f"[{seed_tag}] {text}"],
            cwd=str(_REPO_ROOT / "cli"),
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print(f"warning: sonde note {exp_id} failed: {r.stderr or r.stdout}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts and exit without writing",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow run even if seed-tagged experiments already exist",
    )
    parser.add_argument(
        "--seed-tag",
        default=SEED_MARKER,
        help=f"Tag merged into every record (default: {SEED_MARKER})",
    )
    parser.add_argument(
        "--skip-related",
        action="store_true",
        help="Skip phase-2 experiments that set related[]",
    )
    parser.add_argument(
        "--skip-notes",
        action="store_true",
        help="Skip sonde note subprocesses",
    )
    parser.add_argument(
        "--skip-status-mutations",
        action="store_true",
        help="Skip failed/superseded updates on phase-1 rows",
    )
    args = parser.parse_args()

    phase1 = all_phase1_fixtures()
    n_related = 0 if args.skip_related else len(phase2_related_fixtures("X", "Y", "Z"))

    if args.dry_run:
        print(f"Dry run: would create {len(phase1)} phase-1 + {n_related} related experiments")
        print(f"Seed tag: {args.seed_tag}")
        return 0

    try:
        from sonde.db.client import get_client

        get_client()
    except SystemExit:
        print(
            "error: not authenticated. Run `sonde login` (or set SONDE_TOKEN).",
            file=sys.stderr,
        )
        return 1

    existing = _existing_seed_count(args.seed_tag)
    if existing and not args.force:
        print(
            f"error: found {existing} experiment(s) tagged {args.seed_tag!r}. "
            "Use --force to seed again or remove those rows first.",
            file=sys.stderr,
        )
        return 1

    created_phase1: list[str] = []
    for row in phase1:
        data = _fixture_to_create(row, args.seed_tag)
        exp = db.create(data)
        log_activity(exp.id, "experiment", "created")
        created_phase1.append(exp.id)
        print(exp.id, row["program"], row["status"])

    if not args.skip_status_mutations:
        targets = update_targets_phase2a()
        for status, indices in targets.items():
            for idx in indices:
                if idx >= len(created_phase1):
                    continue
                eid = created_phase1[idx]
                prev = db.get(eid)
                old = prev.status if prev else "unknown"
                db.update(eid, {"status": status})
                log_activity(
                    eid,
                    "experiment",
                    "status_changed",
                    {"from": old, "to": status, "seed_script": True},
                )
                print(f"updated {eid} -> {status}")

    created_all = list(created_phase1)
    if not args.skip_related:
        anchors = (
            created_phase1[0],
            created_phase1[min(8, len(created_phase1) - 1)],
            created_phase1[min(40, len(created_phase1) - 1)],
        )
        for row in phase2_related_fixtures(*anchors):
            data = _fixture_to_create(row, args.seed_tag)
            exp = db.create(data)
            log_activity(exp.id, "experiment", "created")
            created_all.append(exp.id)
            print(exp.id, row["program"], "related=", list(data.related))

    if not args.skip_notes:
        sonde_bin = os.environ.get("SONDE_BIN", "sonde")
        _run_notes(sonde_bin, created_all, args.seed_tag)

    print(f"\nDone. Created/updated seed data. Tag: {args.seed_tag!r}")
    print(f"IDs (phase 1): {len(created_phase1)}, total with related: {len(created_all)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
