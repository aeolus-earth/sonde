"""Artifact commands — list files attached to experiments, findings, or directions."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.output import err, print_json, print_table

__all__ = ["artifact"]


@click.group()
def artifact():
    """Artifact operations — list, annotate, and manage attached files."""


# Register subcommands
from sonde.commands.artifact_update import artifact_update  # noqa: E402

artifact.add_command(artifact_update)


@artifact.command("list")
@click.argument("parent_id")
@pass_output_options
@click.pass_context
def list_cmd(ctx: click.Context, parent_id: str) -> None:
    """List artifacts for an experiment (EXP-), finding (FIND-), or direction (DIR-).

    \b
    Examples:
      sonde artifact list EXP-0001
      sonde artifact list EXP-0001 --json
    """
    from sonde.db import artifacts as art_db

    rid = parent_id.strip().upper()
    prefix = rid.split("-")[0] if "-" in rid else ""

    if prefix == "EXP":
        data = art_db.list_artifacts(rid)
    elif prefix == "FIND":
        data = art_db.list_for_finding(rid)
    elif prefix == "DIR":
        data = art_db.list_for_direction(rid)
    else:
        from sonde.output import print_error

        print_error(
            "Invalid record id",
            f"Expected EXP-, FIND-, or DIR- prefix, got {parent_id!r}.",
            "Try: sonde artifact list EXP-0001",
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(data)
        return

    if not data:
        err.print("[dim]No artifacts for this record.[/]")
        return

    print_table(
        ["id", "filename", "type", "size_bytes"],
        [
            {
                "id": row.get("id", ""),
                "filename": row.get("filename", ""),
                "type": row.get("type", ""),
                "size_bytes": row.get("size_bytes", ""),
            }
            for row in data
        ],
    )
