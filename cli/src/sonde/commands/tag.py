"""Tag command — manage tags on records without editing files."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.output import err, print_error, print_json, print_success, print_table


@click.group(invoke_without_command=True)
@click.pass_context
def tag(ctx: click.Context) -> None:
    """Manage tags on experiments and other records.

    \b
    Examples:
      sonde tag EXP-0001 add cloud-seeding
      sonde tag EXP-0001 remove draft
      sonde tag EXP-0001 list
      sonde tags                           # all tags with counts
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(tags_list)


@tag.command("add")
@click.argument("record_id")
@click.argument("tag_name")
@click.pass_context
def tag_add(ctx: click.Context, record_id: str, tag_name: str) -> None:
    """Add a tag to a record.

    \b
    Examples:
      sonde tag add EXP-0001 subtropical
    """
    record_id = record_id.upper()
    client = get_client()

    result = client.table("experiments").select("tags").eq("id", record_id).execute()
    data = rows(result.data)
    if not data:
        print_error(f"{record_id} not found", "", "sonde list")
        raise SystemExit(1)

    current_tags = data[0].get("tags", [])
    if tag_name in current_tags:
        err.print(f"[sonde.muted]{record_id} already has tag '{tag_name}'[/]")
        return

    current_tags.append(tag_name)
    client.table("experiments").update({"tags": current_tags}).eq("id", record_id).execute()

    from sonde.db.activity import log_activity

    log_activity(record_id, "experiment", "tag_added", {"tag": tag_name})
    print_success(f"Added '{tag_name}' to {record_id}")


@tag.command("remove")
@click.argument("record_id")
@click.argument("tag_name")
@click.pass_context
def tag_remove(ctx: click.Context, record_id: str, tag_name: str) -> None:
    """Remove a tag from a record.

    \b
    Examples:
      sonde tag remove EXP-0001 draft
    """
    record_id = record_id.upper()
    client = get_client()

    result = client.table("experiments").select("tags").eq("id", record_id).execute()
    data = rows(result.data)
    if not data:
        print_error(f"{record_id} not found", "", "sonde list")
        raise SystemExit(1)

    current_tags = data[0].get("tags", [])
    if tag_name not in current_tags:
        err.print(f"[sonde.muted]{record_id} doesn't have tag '{tag_name}'[/]")
        return

    current_tags.remove(tag_name)
    client.table("experiments").update({"tags": current_tags}).eq("id", record_id).execute()

    from sonde.db.activity import log_activity

    log_activity(record_id, "experiment", "tag_removed", {"tag": tag_name})
    print_success(f"Removed '{tag_name}' from {record_id}")


@tag.command("show")
@click.argument("record_id")
@click.pass_context
def tag_show(ctx: click.Context, record_id: str) -> None:
    """Show tags for a specific record.

    \b
    Examples:
      sonde tag show EXP-0001
    """
    record_id = record_id.upper()
    client = get_client()

    result = client.table("experiments").select("tags").eq("id", record_id).execute()
    data = rows(result.data)
    if not data:
        print_error(f"{record_id} not found", "", "sonde list")
        raise SystemExit(1)

    tags = data[0].get("tags", [])
    if ctx.obj.get("json"):
        print_json(tags)
    elif tags:
        for t in sorted(tags):
            print(t)
    else:
        err.print("[sonde.muted]No tags[/]")


@tag.command("list")
@click.option("--program", "-p", help="Filter by program")
@click.option("--limit", "-n", default=25, help="Max tags to show (0 = all)")
@pass_output_options
@click.pass_context
def tags_list(ctx: click.Context, program: str | None, limit: int) -> None:
    """Show all tags with counts.

    \b
    Examples:
      sonde tag list
      sonde tag list -p weather-intervention
      sonde tag list -n 10
      sonde tag list -n 0              # show all
    """
    settings = get_settings()
    resolved = program or settings.program
    client = get_client()

    query = client.table("experiments").select("tags")
    if resolved:
        query = query.eq("program", resolved)
    data = rows(query.execute().data)

    # Count tag occurrences
    counts: dict[str, int] = {}
    for row in data:
        for t in row.get("tags", []):
            counts[t] = counts.get(t, 0) + 1

    if ctx.obj.get("json"):
        print_json(counts)
    elif not counts:
        err.print("[sonde.muted]No tags found.[/]")
    else:
        sorted_tags = sorted(counts.items(), key=lambda x: -x[1])
        display = sorted_tags if not limit else sorted_tags[:limit]
        tag_rows = [{"tag": t, "count": str(c)} for t, c in display]
        print_table(["tag", "count"], tag_rows)
        if limit and len(sorted_tags) > limit:
            err.print(
                f"\n[dim]{len(sorted_tags)} total tags, "
                f"showing top {limit}. Use -n 0 for all.[/dim]"
            )
