"""Questions command — list open research questions."""

from __future__ import annotations

import click

from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.output import (
    _truncate_text,
    err,
    print_breadcrumbs,
    print_json,
    print_table,
)


@click.command("questions")
@click.option("--program", "-p", help="Filter by program")
@click.option("--all", "show_all", is_flag=True, help="Include dismissed and promoted questions")
@click.option("--tag", multiple=True, help="Filter by tag (repeatable)")
@click.option("--source", help="Filter by source")
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=50, type=int, help="Max results (default: 50)")
@click.pass_context
def questions_cmd(
    ctx: click.Context,
    program: str | None,
    show_all: bool,
    tag: tuple[str, ...],
    source: str | None,
    show_count: bool,
    limit: int,
) -> None:
    """List research questions.

    Shows open and investigating questions by default.
    Use --all to include dismissed and promoted ones.

    \b
    Examples:
      sonde questions -p weather-intervention
      sonde questions --all
      sonde questions --tag cloud-seeding
      sonde questions --source human/mason
      sonde questions --count
    """
    settings = get_settings()
    resolved = program or settings.program or None

    client = get_client()
    query = client.table("questions").select("*").order("created_at", desc=True).limit(limit)

    if resolved:
        query = query.eq("program", resolved)
    if not show_all:
        query = query.in_("status", ["open", "investigating"])
    if tag:
        query = query.contains("tags", list(tag))
    if source:
        if "/" not in source:
            query = query.ilike("source", f"{source}%")
        else:
            query = query.eq("source", source)

    result = query.execute()
    questions_list = rows(result.data)

    if show_count:
        if ctx.obj.get("json"):
            print_json({"count": len(questions_list)})
        else:
            click.echo(len(questions_list))
        return

    if ctx.obj.get("json"):
        print_json(questions_list)
    elif not questions_list:
        err.print("[dim]No questions found.[/dim]")
    else:
        table_rows = []
        for q in questions_list:
            q_source = q.get("source", "")
            if "/" in q_source:
                q_source = q_source.split("/")[-1]
            table_rows.append(
                {
                    "id": q["id"],
                    "status": q.get("status", "open"),
                    "question": _truncate_text(q.get("question"), 55),
                    "source": q_source,
                    "created": q.get("created_at", "")[:10],
                }
            )
        print_table(["id", "status", "question", "source", "created"], table_rows)
        err.print(f"\n[dim]{len(questions_list)} question(s)[/dim]")

        prog = resolved or "<program>"
        print_breadcrumbs(
            [
                f'Promote to experiment: sonde log --open -p {prog} "question text"',
            ]
        )
