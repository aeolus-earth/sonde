"""Attach command — upload files to experiments."""

from __future__ import annotations

from pathlib import Path

import click

from sonde.auth import get_current_user
from sonde.db import rows
from sonde.db.artifacts import upload_file
from sonde.db.client import get_client
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.output import err, print_error, print_json, print_success


@click.command()
@click.argument("experiment_id")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True))
@click.option("--type", "artifact_type", help="Override artifact type")
@click.option("--description", "-d", help="Description of the artifact")
@click.pass_context
def attach(
    ctx: click.Context,
    experiment_id: str,
    files: tuple[str, ...],
    artifact_type: str | None,
    description: str | None,
) -> None:
    """Attach files to an experiment.

    \b
    Examples:
      sonde attach EXP-0001 figures/precip_delta.png
      sonde attach EXP-0001 report.pdf --type paper
      sonde attach EXP-0001 output/*.nc
    """
    experiment_id = experiment_id.upper()
    client = get_client()

    # Verify experiment exists
    exp_result = client.table("experiments").select("id").eq("id", experiment_id).execute()
    if not rows(exp_result.data):
        print_error(
            f"Experiment {experiment_id} not found",
            "Cannot attach files to a nonexistent experiment.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    user = get_current_user()
    source = f"human/{user.email.split('@')[0]}" if user and not user.is_agent else "agent"

    results = []
    for file_str in files:
        filepath = Path(file_str)
        try:
            row = upload_file(
                experiment_id,
                filepath,
                source,
                artifact_type=artifact_type,
                description=description,
            )
            results.append(row)

            # Copy locally too
            sonde_dir = find_sonde_dir()
            local_dir = ensure_subdir(sonde_dir, f"experiments/{experiment_id}")
            (local_dir / filepath.name).write_bytes(filepath.read_bytes())

            if not ctx.obj.get("json"):
                err.print(f"  [sonde.muted]{row['id']} ← {filepath.name}[/]")
        except Exception as e:
            print_error("Upload failed", str(e), f"Failed: {filepath.name}")

    # Log activity
    if results:
        from sonde.db.activity import log_activity

        filenames = [r["filename"] for r in results]
        log_activity(
            experiment_id,
            "experiment",
            "artifact_attached",
            {"filenames": filenames, "count": len(filenames)},
        )

    if ctx.obj.get("json"):
        print_json(results)
    else:
        print_success(f"Attached {len(results)} file(s) to {experiment_id}")
