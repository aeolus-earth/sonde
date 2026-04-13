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
from sonde.db import questions as q_db
from sonde.db.activity import log_activity
from sonde.models.direction import DirectionCreate
from sonde.models.question import QuestionCreate
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
@click.option("--project", help="Filter by project ID")
@click.option("--status", help="Filter by status")
@click.option("--all", "show_all", is_flag=True, help="Include non-active directions")
@click.option("--limit", "-n", default=50, help="Max results")
@pass_output_options
@click.pass_context
def direction_list(
    ctx: click.Context,
    program: str | None,
    project: str | None,
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

    directions = db.list_directions(
        program=resolved_program, project=project, statuses=statuses, limit=limit
    )
    if ctx.obj.get("json"):
        print_json([d.model_dump(mode="json") for d in directions])
        return

    rows = [
        {
            "id": d.id,
            "status": d.status,
            "program": d.program,
            "title": (f"\u2514 {d.title}" if d.parent_direction_id else d.title),
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
@click.option("--context", "-c", help="Motivation, scope, or background for this direction")
@click.option("--project", help="Parent project ID")
@click.option("--source", "-s", help="Who created this direction")
@click.option("--parent-direction", "parent_direction", help="Parent direction ID")
@click.option("--from", "from_experiment", help="Experiment ID that spawned this direction")
@pass_output_options
@click.pass_context
def direction_create(
    ctx: click.Context,
    question_text: str,
    program: str | None,
    title: str,
    context: str | None,
    project: str | None,
    status: str,
    source: str | None,
    parent_direction: str | None,
    from_experiment: str | None,
) -> None:
    """Create a new research direction."""
    settings = get_settings()

    # Validate parent direction if provided
    parent_dir = None
    if parent_direction:
        parent_direction = parent_direction.upper()
        parent_dir = db.get(parent_direction)
        if not parent_dir:
            print_error(
                f"Parent direction {parent_direction} not found",
                "No direction with this ID.",
                "sonde direction list",
            )
            raise SystemExit(1)
        if parent_dir.parent_direction_id:
            print_error(
                f"{parent_direction} is already a sub-direction",
                "Direction nesting is limited to 2 levels.",
                f"Use {parent_dir.parent_direction_id} as the parent instead.",
            )
            raise SystemExit(1)

    # Validate spawning experiment if provided
    if from_experiment:
        from_experiment = from_experiment.upper()
        from sonde.db import experiments as exp_db

        exp = exp_db.get(from_experiment)
        if not exp:
            print_error(
                f"Experiment {from_experiment} not found",
                "No experiment with this ID.",
                "sonde list",
            )
            raise SystemExit(1)

    # Inherit program and project from parent if not specified
    resolved_program = program or (parent_dir.program if parent_dir else None) or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "Directions need a program namespace.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    resolved_project = project or (parent_dir.project_id if parent_dir else None)

    resolved_source = source or settings.source or resolve_source()
    data = DirectionCreate(
        program=resolved_program,
        title=title,
        question=question_text,
        context=context,
        project_id=resolved_project,
        status=cast(Literal["proposed", "active", "paused", "completed", "abandoned"], status),
        source=resolved_source,
        parent_direction_id=parent_direction,
        spawned_from_experiment_id=from_experiment,
    )
    result = db.create(data)
    primary_question = q_db.create(
        QuestionCreate(
            program=resolved_program,
            question=question_text,
            direction_id=result.id,
            context=context,
            status="investigating" if status in ("active", "paused") else "open",
            source=resolved_source,
        )
    )
    result = (
        db.update(
            result.id,
            {"primary_question_id": primary_question.id, "question": question_text},
        )
        or result
    )
    details: dict = {"parent_direction": parent_direction, "spawned_from": from_experiment}
    log_activity(result.id, "direction", "created", {k: v for k, v in details.items() if v})
    log_activity(primary_question.id, "question", "created", {"direction_id": result.id})

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        detail_lines = [f"Title: {title}", f"Question: {question_text}"]
        if parent_direction:
            detail_lines.append(f"Parent: {parent_direction}")
        if from_experiment:
            detail_lines.append(f"Spawned from: {from_experiment}")
        detail_lines.append(f"Primary question: {primary_question.id}")
        print_success(
            f"Created {result.id} ({resolved_program})",
            details=detail_lines,
            breadcrumbs=[f"View: sonde direction show {result.id}"],
            record_id=result.id,
        )


@direction.command("update")
@click.argument("direction_id")
@click.option("--title", "-t", help="Update title")
@click.option("--question", help="Update guiding question")
@click.option("--context", "-c", help="Update motivation / scope / background")
@click.option(
    "--status",
    type=click.Choice(["proposed", "active", "paused", "completed", "abandoned"]),
    help="Update status",
)
@click.option("--project", help="Set or change the parent project")
@click.option("--parent-direction", "parent_direction", help="Set or change parent direction")
@click.option("--linear", help="Link to a Linear issue ID (e.g. AEO-123)")
@pass_output_options
@click.pass_context
def direction_update(
    ctx: click.Context,
    direction_id: str,
    title: str | None,
    question: str | None,
    context: str | None,
    status: str | None,
    project: str | None,
    parent_direction: str | None,
    linear: str | None,
) -> None:
    """Update a direction.

    \b
    Examples:
      sonde direction update DIR-001 --status paused
      sonde direction update DIR-001 --context "Narrowing to mid-latitude only"
      sonde direction update DIR-001 --project PROJ-001
      sonde direction update DIR-001 --question "New research question?"
      sonde direction update DIR-015 --parent-direction DIR-002
    """
    direction_id = direction_id.upper()
    current = db.get(direction_id)
    if not current:
        print_error(
            f"Direction {direction_id} not found",
            "No direction with this ID.",
            "List directions: sonde direction list",
        )
        raise SystemExit(1)

    # Validate parent direction if being set
    if parent_direction:
        parent_direction = parent_direction.upper()
        parent_dir = db.get(parent_direction)
        if not parent_dir:
            print_error(
                f"Parent direction {parent_direction} not found",
                "No direction with this ID.",
                "sonde direction list",
            )
            raise SystemExit(1)
        if parent_dir.parent_direction_id:
            print_error(
                f"{parent_direction} is already a sub-direction",
                "Direction nesting is limited to 2 levels.",
                f"Use {parent_dir.parent_direction_id} as the parent instead.",
            )
            raise SystemExit(1)

    updates = {
        key: value
        for key, value in {
            "title": title,
            "question": question,
            "context": context,
            "status": status,
            "project_id": project,
            "parent_direction_id": parent_direction,
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
    if question is not None:
        if current.primary_question_id:
            q_db.update(
                current.primary_question_id,
                {
                    "question": question,
                    "context": context if context is not None else current.context,
                    "direction_id": direction_id,
                },
            )
            log_activity(
                current.primary_question_id,
                "question",
                "updated",
                {"direction_id": direction_id, "question": question},
            )
        else:
            primary_question = q_db.create(
                QuestionCreate(
                    program=current.program,
                    question=question,
                    direction_id=direction_id,
                    context=context if context is not None else current.context,
                    status="investigating"
                    if (status or current.status) in ("active", "paused")
                    else "open",
                    source=resolve_source(),
                )
            )
            db.update(
                direction_id,
                {"primary_question_id": primary_question.id, "question": question},
            )
            log_activity(primary_question.id, "question", "created", {"direction_id": direction_id})
    if ctx.obj.get("json"):
        print_json(updated.model_dump(mode="json"))
    else:
        print_success(
            f"Updated {direction_id}",
            details=[f"Status: {updated.status}", f"Title: {updated.title}"],
            breadcrumbs=[f"View: sonde direction show {direction_id}"],
            record_id=direction_id,
        )

        # Nudge: synthesize findings when completing a direction
        if status in ("completed", "abandoned") and not ctx.obj.get("json"):
            try:
                from sonde.db import direction_takeaways as dtw_db

                existing = dtw_db.get(direction_id)
                if not existing or not existing.body.strip():
                    from sonde.output import print_nudge

                    print_nudge(
                        "Synthesize what this direction's experiments taught you:",
                        f'sonde takeaway --direction {direction_id} "what we learned"',
                    )
            except Exception:
                pass


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
        children = db.get_children(direction_id)
        err.print(f"[sonde.warning]This will delete {direction_id}[/]")
        if exp_count:
            err.print(f"  {exp_count} experiment(s) will have direction_id cleared")
        if children:
            err.print(f"  {len(children)} sub-direction(s) will be orphaned")
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


@direction.command("fork")
@click.argument("direction_id")
@click.argument("question_text")
@click.option("--title", "-t", required=True, help="Short title for the sub-direction")
@click.option("--from", "from_experiment", help="Experiment ID that spawned this sub-direction")
@click.option("--context", "-c", help="Motivation, scope, or background")
@click.option("--source", "-s", help="Who created this direction")
@click.option(
    "--status",
    type=click.Choice(["proposed", "active", "paused", "completed", "abandoned"]),
    default="active",
    help="Direction status",
)
@pass_output_options
@click.pass_context
def direction_fork(
    ctx: click.Context,
    direction_id: str,
    question_text: str,
    title: str,
    from_experiment: str | None,
    context: str | None,
    source: str | None,
    status: str,
) -> None:
    """Fork a direction to create a focused sub-investigation.

    Inherits program and project from the parent direction.

    \b
    Examples:
      sonde direction fork DIR-002 \\
        --from EXP-0201 \\
        --title "Fix compile_raised_backward" \\
        "Why does compile_raised_backward fail?"
    """
    direction_id = direction_id.upper()
    parent_dir = db.get(direction_id)
    if not parent_dir:
        print_error(
            f"Direction {direction_id} not found",
            "No direction with this ID.",
            "sonde direction list",
        )
        raise SystemExit(1)

    if parent_dir.parent_direction_id:
        print_error(
            f"{direction_id} is already a sub-direction",
            "Direction nesting is limited to 2 levels.",
            f"Fork the root direction {parent_dir.parent_direction_id} instead.",
        )
        raise SystemExit(1)

    # Validate spawning experiment if provided
    if from_experiment:
        from_experiment = from_experiment.upper()
        from sonde.db import experiments as exp_db

        exp = exp_db.get(from_experiment)
        if not exp:
            print_error(
                f"Experiment {from_experiment} not found",
                "No experiment with this ID.",
                "sonde list",
            )
            raise SystemExit(1)

    settings = get_settings()
    resolved_source = source or settings.source or resolve_source()

    data = DirectionCreate(
        program=parent_dir.program,
        title=title,
        question=question_text,
        context=context,
        project_id=parent_dir.project_id,
        status=cast(Literal["proposed", "active", "paused", "completed", "abandoned"], status),
        source=resolved_source,
        parent_direction_id=direction_id,
        spawned_from_experiment_id=from_experiment,
    )
    result = db.create(data)

    details: dict = {"forked_from": direction_id, "spawned_from": from_experiment}
    log_activity(result.id, "direction", "created", {k: v for k, v in details.items() if v})

    if ctx.obj.get("json"):
        parent_data = parent_dir.model_dump(mode="json")
        print_json({"created": result.model_dump(mode="json"), "parent": parent_data})
    else:
        detail_lines = [f"Title: {title}", f"Parent: {direction_id} ({parent_dir.title})"]
        if from_experiment:
            detail_lines.append(f"Spawned from: {from_experiment}")
        print_success(
            f"Forked {direction_id} \u2192 {result.id}",
            details=detail_lines,
            breadcrumbs=[
                f"View:  sonde direction show {result.id}",
                f"Tree:  sonde tree {direction_id}",
            ],
            record_id=result.id,
        )


direction.add_command(new_direction)
direction.add_command(pull_direction, "pull")
direction.add_command(push_direction, "push")
direction.add_command(remove_direction)
