"""Recent command — what happened lately."""

from __future__ import annotations

import click

from sonde.config import get_settings
from sonde.db.activity import get_recent
from sonde.output import err, print_json, print_table


@click.command()
@click.option("--program", "-p", help="Filter by program")
@click.option("--days", "-d", default=7, type=int, help="Look back N days (default: 7)")
@click.option("--actor", help="Filter by actor (e.g., human/mason)")
@click.option("--limit", "-n", default=20, type=int, help="Max results (default: 20)")
@click.pass_context
def recent(
    ctx: click.Context, program: str | None, days: int, actor: str | None, limit: int
) -> None:
    """Show recent activity across the knowledge base.

    \b
    Examples:
      sonde recent
      sonde recent -p weather-intervention
      sonde recent --days 30
      sonde recent --actor human/mason
    """
    settings = get_settings()
    resolved = program or settings.program or None

    entries = get_recent(program=resolved, days=days, actor=actor, limit=limit)

    if ctx.obj.get("json"):
        print_json(entries)
    elif not entries:
        err.print("[sonde.muted]No recent activity.[/]")
    else:
        columns = ["time", "actor", "action", "record", "details"]
        table_rows = []
        for e in entries:
            timestamp = e["created_at"][:16].replace("T", " ")
            actor_name = e.get("actor_name") or e["actor"]
            # Shorten actor display
            if "/" in actor_name:
                actor_name = actor_name.split("/")[1]

            detail = ""
            details = e.get("details", {})
            if e["action"] == "status_changed":
                detail = f"{details.get('from', '?')} → {details.get('to', '?')}"
            elif e["action"] == "tag_added":
                detail = f"+{details.get('tag', '')}"
            elif e["action"] == "tag_removed":
                detail = f"-{details.get('tag', '')}"
            elif e["action"] == "note_added":
                detail = details.get("note_id", "")
            elif e["action"] == "artifact_attached":
                count = details.get("count", 0)
                detail = f"{count} file(s)"

            table_rows.append(
                {
                    "time": timestamp,
                    "actor": actor_name,
                    "action": e["action"],
                    "record": e["record_id"],
                    "details": detail,
                }
            )

        print_table(columns, table_rows)
        err.print(f"\n[sonde.muted]{len(entries)} action(s)[/]")
