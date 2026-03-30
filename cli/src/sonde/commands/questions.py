"""Questions command — list open research questions."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import questions as db
from sonde.output import (
    err,
    print_breadcrumbs,
    print_json,
    print_table,
    truncate_text,
)


@click.command("questions")
@click.option("--program", "-p", help="Filter by program")
@click.option("--all", "show_all", is_flag=True, help="Include dismissed and promoted questions")
@click.option("--tag", multiple=True, help="Filter by tag (repeatable)")
@click.option("--source", help="Filter by source")
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=50, type=int, help="Max results (default: 50)")
@click.option("--offset", default=0, type=int, help="Skip first N results")
@pass_output_options
@click.pass_context
def questions_cmd(
    ctx: click.Context,
    program: str | None,
    show_all: bool,
    tag: tuple[str, ...],
    source: str | None,
    show_count: bool,
    limit: int,
    offset: int,
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

    if show_count:
        total = db.count_questions(
            program=resolved,
            include_all=show_all,
            tags=list(tag) or None,
            source=source,
        )
        if ctx.obj.get("json"):
            print_json({"count": total})
        else:
            click.echo(total)
        return

    questions_list = db.list_questions(
        program=resolved,
        include_all=show_all,
        tags=list(tag) or None,
        source=source,
        limit=limit,
        offset=offset,
    )

    if ctx.obj.get("json"):
        print_json([q.model_dump(mode="json") for q in questions_list])
    elif not questions_list:
        err.print("[dim]No questions found.[/dim]")
    else:
        table_rows = []
        for q in questions_list:
            q_source = q.source
            if "/" in q_source:
                q_source = q_source.split("/")[-1]
            table_rows.append(
                {
                    "id": q.id,
                    "status": q.status,
                    "question": truncate_text(q.question, 55),
                    "source": q_source,
                    "created": q.created_at.strftime("%Y-%m-%d") if q.created_at else "—",
                }
            )
        print_table(["id", "status", "question", "source", "created"], table_rows)
        err.print(f"\n[dim]{len(questions_list)} question(s)[/dim]")

        prog = resolved or "<program>"
        print_breadcrumbs([
            "Promote: sonde question promote <Q-ID>",
            f"Create:  sonde question create -p {prog} \"your question\"",
        ])
