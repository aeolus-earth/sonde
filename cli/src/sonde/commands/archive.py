"""Archive command — archive a completed experiment subtree."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.db import experiments as db
from sonde.output import (
    err,
    print_error,
    print_json,
    print_success,
)


@click.command("archive")
@click.argument("experiment_id")
@click.option("--dry-run", is_flag=True, help="Preview what would be archived")
@pass_output_options
@click.pass_context
def archive(ctx: click.Context, experiment_id: str, dry_run: bool) -> None:
    """Archive a completed experiment subtree.

    Marks all complete/failed experiments in the subtree as superseded.
    Open and running experiments are left untouched.
    Archived experiments are hidden from `sonde list` by default (use --all to see them).

    \b
    Examples:
      sonde archive EXP-0001 --dry-run   # preview
      sonde archive EXP-0001             # archive the subtree
    """
    experiment_id = experiment_id.upper()
    exp = db.get(experiment_id)
    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID.",
            "List experiments: sonde list --all",
        )
        raise SystemExit(1)

    subtree = db.get_subtree(experiment_id)
    to_archive = [r for r in subtree if r.get("status") in ("complete", "failed")]
    to_skip = [r for r in subtree if r.get("status") in ("open", "running")]

    if not to_archive:
        err.print("[dim]No complete/failed experiments to archive.[/dim]")
        return

    if dry_run:
        if ctx.obj.get("json"):
            print_json(
                {
                    "dry_run": True,
                    "would_archive": [r["id"] for r in to_archive],
                    "would_skip": [r["id"] for r in to_skip],
                }
            )
        else:
            err.print(f"[sonde.heading]Would archive {len(to_archive)} experiment(s):[/]")
            for r in to_archive:
                summary = (r.get("content") or "")[:60] or "—"
                err.print(f"  {r['id']}  [{r['status']}]  {summary}")
            if to_skip:
                err.print(f"\n[sonde.muted]Would skip {len(to_skip)} open/running:[/]")
                for r in to_skip:
                    err.print(f"  {r['id']}  [{r['status']}]")
        return

    archived, skipped = db.archive_subtree(experiment_id)

    # Log activity for each archived experiment
    from sonde.db.activity import log_activity

    for aid in archived:
        log_activity(aid, "experiment", "archived", {"archived_by": experiment_id})

    if ctx.obj.get("json"):
        print_json({"archived": archived, "skipped": skipped})
    else:
        print_success(f"Archived {len(archived)} experiment(s) under {experiment_id}")
        if skipped:
            err.print(f"  [sonde.muted]Skipped {len(skipped)} open/running[/]")
        err.print("\n  View: sonde list --all")
        err.print(f"  Tree: sonde tree {experiment_id}")
