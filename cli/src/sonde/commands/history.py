"""History command — full timeline for one record."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.db.activity import get_history
from sonde.output import err, print_error, print_json


@click.command()
@click.argument("record_id")
@pass_output_options
@click.pass_context
def history(ctx: click.Context, record_id: str) -> None:
    """Show the full activity timeline for a record.

    \b
    Examples:
      sonde history EXP-0001
    """
    entries = get_history(record_id)

    if ctx.obj.get("json"):
        print_json(entries)
        return

    if not entries:
        print_error(
            f"No history for {record_id}",
            "No activity recorded for this ID.",
            "The record may predate the activity log.",
        )
        raise SystemExit(1)

    err.print(f"\n[sonde.heading]{record_id.upper()}[/]\n")

    for e in entries:
        timestamp = e["created_at"][:16].replace("T", " ")
        actor = e.get("actor_email") or e.get("actor_name") or e["actor"]
        action = e["action"]
        details = e.get("details", {})

        # Format the action
        if action == "created":
            desc = "Created"
        elif action == "updated":
            desc = "Updated"
        elif action == "status_changed":
            desc = f"Status: {details.get('from', '?')} → {details.get('to', '?')}"
        elif action == "note_added":
            desc = f"Note added ({details.get('note_id', '')})"
        elif action == "artifact_attached":
            filenames = details.get("filenames", [])
            desc = f"Attached: {', '.join(filenames)}" if filenames else "Attached files"
        elif action == "tag_added":
            desc = f"Tag added: {details.get('tag', '')}"
        elif action == "tag_removed":
            desc = f"Tag removed: {details.get('tag', '')}"
        else:
            desc = action

        err.print(f"  [sonde.muted]{timestamp}[/]  {actor}")
        err.print(f"  {desc}")
        err.print()
