"""Delete command — delete an experiment and its notes/artifacts."""

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


@click.command("delete")
@click.argument("experiment_id")
@click.option("--confirm", is_flag=True, help="Confirm deletion")
@pass_output_options
@click.pass_context
def delete_experiment(ctx: click.Context, experiment_id: str, confirm: bool) -> None:
    """Delete an experiment and its notes and artifacts.

    Children are re-parented to the grandparent. Activity log is preserved.

    \b
    Examples:
      sonde delete EXP-0042 --confirm
    """
    experiment_id = experiment_id.upper()
    exp = db.get(experiment_id)
    if not exp:
        print_error(f"{experiment_id} not found", "No experiment with this ID.", "sonde list --all")
        raise SystemExit(1)

    children = db.get_children(experiment_id)
    from sonde.db.artifacts import list_artifacts
    from sonde.db.notes_v2 import list_by_experiment

    notes = list_by_experiment(experiment_id)
    artifacts = list_artifacts(experiment_id)

    if not confirm:
        err.print(f"[sonde.warning]This will delete {experiment_id}:[/]")
        err.print(f"  {len(notes)} note(s), {len(artifacts)} artifact(s)")
        if children:
            err.print(f"  {len(children)} child experiment(s) will be re-parented")
        err.print("\n  Use --confirm to proceed.")
        raise SystemExit(1)

    from sonde.services.experiments import delete_experiment

    cascade = delete_experiment(experiment_id)
    cleanup = cascade.get("artifact_cleanup", {})

    if ctx.obj.get("json"):
        print_json({"deleted": {"id": experiment_id}, "cascade": cascade})
    else:
        print_success(f"Deleted {experiment_id}")
        if cascade.get("notes"):
            err.print(f"  {cascade['notes']} note(s) removed")
        if cascade.get("artifacts"):
            err.print(f"  {cascade['artifacts']} artifact(s) removed")
            if cleanup.get("mode") == "queued":
                err.print("  Artifact blobs queued for storage cleanup")
            elif cleanup.get("mode") in {"reconciled", "partial"}:
                err.print(f"  {cleanup.get('deleted', 0)} artifact blob(s) deleted from storage")
                if cleanup.get("already_absent"):
                    err.print(f"  {cleanup['already_absent']} artifact blob(s) were already absent")
                if cleanup.get("failed"):
                    err.print(f"  {cleanup['failed']} artifact blob(s) still need reconciliation")
        if cascade.get("children_reparented"):
            err.print(f"  {cascade['children_reparented']} child(ren) re-parented")
