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
from sonde.output import err, print_error, print_json, print_success, print_table
from sonde.services.directions import delete_direction as delete_direction_record


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
@click.option("--project", help="Set or change the parent project")
@click.option("--linear", help="Link to a Linear issue ID (e.g. AEO-123)")
@pass_output_options
@click.pass_context
def direction_update(
    ctx: click.Context,
    direction_id: str,
    title: str | None,
    question: str | None,
    status: str | None,
    project: str | None,
    linear: str | None,
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
            "project_id": project,
            "linear_id": linear,
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


@direction.command("delete")
@click.argument("direction_id")
@click.option("--confirm", is_flag=True, help="Confirm deletion")
@pass_output_options
@click.pass_context
def direction_delete(ctx: click.Context, direction_id: str, confirm: bool) -> None:
    """Delete a direction. Clears direction_id on linked experiments."""
    direction_id = direction_id.upper()
    d = db.get(direction_id)
    if not d:
        print_error(
            f"{direction_id} not found",
            "No direction with this ID.",
            "sonde direction list",
        )
        raise SystemExit(1)

    if not confirm:
        from sonde.db import experiments as exp_db

        exp_count = len(exp_db.list_by_direction(direction_id))
        err.print(f"[sonde.warning]This will delete {direction_id}[/]")
        if exp_count:
            err.print(f"  {exp_count} experiment(s) will have direction_id cleared")
        err.print("  Use --confirm to proceed.")
        raise SystemExit(1)

    deleted = delete_direction_record(direction_id)

    if ctx.obj.get("json"):
        print_json({"deleted": {"id": direction_id}, **deleted})
    else:
        print_success(f"Deleted {direction_id}")
        if deleted.get("experiments_cleared"):
            err.print(f"  {deleted['experiments_cleared']} experiment(s) had direction_id cleared")
        if deleted.get("artifacts"):
            err.print(f"  {deleted['artifacts']} artifact(s) removed")
            cleanup = deleted.get("artifact_cleanup", {})
            if cleanup.get("mode") == "queued":
                err.print("  Artifact blobs queued for storage cleanup")
            elif cleanup.get("mode") in {"reconciled", "partial"}:
                err.print(f"  {cleanup.get('deleted', 0)} artifact blob(s) deleted from storage")
                if cleanup.get("already_absent"):
                    err.print(f"  {cleanup['already_absent']} artifact blob(s) were already absent")
                if cleanup.get("failed"):
                    err.print(f"  {cleanup['failed']} artifact blob(s) still need reconciliation")


direction.add_command(new_direction)
direction.add_command(pull_direction, "pull")
direction.add_command(push_direction, "push")
direction.add_command(remove_direction)
