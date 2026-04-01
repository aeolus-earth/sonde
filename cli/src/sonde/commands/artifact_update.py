"""Artifact update command — set description/caption on an artifact."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.commands._context import use_json
from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.output import print_error, print_json, print_success


@click.command("update")
@click.argument("artifact_id")
@click.option(
    "-d",
    "--description",
    required=True,
    help="Description / caption for this artifact",
)
@pass_output_options
@click.pass_context
def artifact_update(
    ctx: click.Context,
    artifact_id: str,
    description: str,
) -> None:
    """Update an artifact's description.

    Use this to caption figures, describe datasets, or document
    what a log file contains and how it was generated.

    \b
    Examples:
      sonde artifact update ART-0001 -d "Precip anomaly, CCN=1200"
      sonde artifact update ART-0003 -d "GPU profiling from nsight-compute"
    """
    json_mode = use_json(ctx)
    aid = artifact_id.strip().upper()

    client = get_client()
    result = client.table("artifacts").update({"description": description}).eq("id", aid).execute()

    data = to_rows(result.data)
    if not data:
        print_error(
            f"Artifact {aid} not found",
            "No artifact with this ID.",
            "List artifacts: sonde artifact list EXP-XXXX",
        )
        raise SystemExit(1)

    if json_mode:
        print_json(data[0])
    else:
        print_success(
            f"Updated {aid}",
            details=[f"Description: {description}"],
        )
