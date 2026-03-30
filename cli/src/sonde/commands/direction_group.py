"""Direction noun group — manage research directions."""

from __future__ import annotations

from typing import Literal, cast

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands.new import new_direction
from sonde.commands.pull import pull_direction
from sonde.commands.push import push_direction
from sonde.commands.remove import remove_direction
from sonde.config import get_settings
from sonde.db import directions as db
from sonde.db.activity import log_activity
from sonde.models.direction import DirectionCreate
from sonde.output import print_error, print_json, print_success, print_table


@click.group(invoke_without_command=True)
@click.pass_context
def direction(ctx: click.Context) -> None:
    """Manage research directions.

    \b
    Examples:
      sonde direction list
      sonde direction show DIR-001
      sonde direction create -p weather-intervention \\
        --title "CCN sensitivity" "How does CCN affect precipitation?"
    """
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@direction.command("list")
@click.option("--program", "-p", help="Filter by program")
@click.option("--status", help="Filter by status")
@click.option("--all", "show_all", is_flag=True, help="Include non-active directions")
@click.option("--limit", "-n", default=50, help="Max results")
@pass_output_options
@click.pass_context
def direction_list(
    ctx: click.Context,
    program: str | None,
    status: str | None,
    show_all: bool,
    limit: int,
) -> None:
    """List directions."""
    settings = get_settings()
    resolved_program = program or settings.program or None
    statuses = None if show_all else ["active", "proposed"]
    if status:
        statuses = [status]

    directions = db.list_directions(program=resolved_program, statuses=statuses, limit=limit)
    if ctx.obj.get("json"):
        print_json([d.model_dump(mode="json") for d in directions])
        return

    rows = [
        {
            "id": d.id,
            "status": d.status,
            "program": d.program,
            "title": d.title,
            "question": d.question,
        }
        for d in directions
    ]
    print_table(["id", "status", "program", "title", "question"], rows, title="Directions")


@direction.command("show")
@click.argument("direction_id")
@pass_output_options
@click.pass_context
def direction_show(ctx: click.Context, direction_id: str) -> None:
    """Show details for a direction."""
    from sonde.commands.show import show_dispatch

    show_dispatch(ctx, direction_id.upper(), graph=False)


@direction.command("create")
@click.argument("question_text")
@click.option("--program", "-p", help="Program namespace")
@click.option("--title", "-t", required=True, help="Short direction title")
@click.option(
    "--status",
    type=click.Choice(["proposed", "active", "paused", "completed", "abandoned"]),
    default="active",
    help="Direction status",
)
@click.option("--source", "-s", help="Who created this direction")
@pass_output_options
@click.pass_context
def direction_create(
    ctx: click.Context,
    question_text: str,
    program: str | None,
    title: str,
    status: str,
    source: str | None,
) -> None:
    """Create a new research direction."""
    settings = get_settings()
    resolved_program = program or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "Directions need a program namespace.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    resolved_source = source or settings.source or resolve_source()
    data = DirectionCreate(
        program=resolved_program,
        title=title,
        question=question_text,
        status=cast(Literal["proposed", "active", "paused", "completed", "abandoned"], status),
        source=resolved_source,
    )
    result = db.create(data)
    log_activity(result.id, "direction", "created")

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Created {result.id} ({resolved_program})",
            details=[f"Title: {title}", f"Question: {question_text}"],
            breadcrumbs=[f"View: sonde direction show {result.id}"],
        )


@direction.command("update")
@click.argument("direction_id")
@click.option("--title", "-t", help="Update title")
@click.option("--question", help="Update guiding question")
@click.option(
    "--status",
    type=click.Choice(["proposed", "active", "paused", "completed", "abandoned"]),
    help="Update status",
)
@pass_output_options
@click.pass_context
def direction_update(
    ctx: click.Context,
    direction_id: str,
    title: str | None,
    question: str | None,
    status: str | None,
) -> None:
    """Update a direction."""
    direction_id = direction_id.upper()
    current = db.get(direction_id)
    if not current:
        print_error(
            f"Direction {direction_id} not found",
            "No direction with this ID.",
            "List directions: sonde direction list",
        )
        raise SystemExit(1)

    updates = {
        key: value
        for key, value in {
            "title": title,
            "question": question,
            "status": status,
        }.items()
        if value is not None
    }
    if not updates:
        print_success(f"{direction_id} unchanged")
        return

    updated = db.update(direction_id, updates)
    if not updated:
        print_error(
            f"Failed to update {direction_id}",
            "Update returned no data.",
            f"View: sonde direction show {direction_id}",
        )
        raise SystemExit(1)

    log_activity(direction_id, "direction", "updated", updates)
    if ctx.obj.get("json"):
        print_json(updated.model_dump(mode="json"))
    else:
        print_success(
            f"Updated {direction_id}",
            details=[f"Status: {updated.status}", f"Title: {updated.title}"],
            breadcrumbs=[f"View: sonde direction show {direction_id}"],
        )


direction.add_command(new_direction)
direction.add_command(pull_direction, "pull")
direction.add_command(push_direction, "push")
direction.add_command(remove_direction)
