"""Recent command — what happened lately."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db.activity import get_recent
from sonde.output import err, print_json, print_table


@click.command()
@click.option("--program", "-p", help="Filter by program")
@click.option("--days", "-d", default=None, type=int, help="Look back N days (default: 7)")
@click.option("--since", help="Show activity after this date (YYYY-MM-DD)")
@click.option("--actor", help="Filter by actor (e.g., human/mason)")
@click.option("--action", help="Filter by action type (e.g., created, status_changed)")
@click.option("--type", "record_type", help="Filter by record type (experiment, finding, question)")
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=20, type=int, help="Max results (default: 20)")
@click.option("--offset", default=0, type=int, help="Skip first N results")
@pass_output_options
@click.pass_context
def recent(
    ctx: click.Context,
    program: str | None,
    days: int | None,
    since: str | None,
    actor: str | None,
    action: str | None,
    record_type: str | None,
    show_count: bool,
    limit: int,
    offset: int,
) -> None:
    """Show recent activity across the knowledge base.

    \b
    Examples:
      sonde recent
      sonde recent -p weather-intervention
      sonde recent --days 30
      sonde recent --since 2026-03-15
      sonde recent --actor human/mason
      sonde recent --action status_changed
      sonde recent --type experiment
      sonde recent --count
    """
    if since and days is not None:
        from sonde.output import print_error

        print_error(
            "Conflicting filters",
            "Cannot use --since with --days.",
            "Use one or the other.",
        )
        raise SystemExit(2)

    # Default to 7 days if neither --since nor --days specified
    if days is None and since is None:
        days = 7

    settings = get_settings()
    resolved = program or settings.program or None

    entries = get_recent(
        program=resolved,
        days=days,
        since=since,
        actor=actor,
        action=action,
        record_type=record_type,
        limit=limit,
        offset=offset,
    )

    if show_count:
        if ctx.obj.get("json"):
            print_json({"count": len(entries)})
        else:
            click.echo(len(entries))
        return

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
