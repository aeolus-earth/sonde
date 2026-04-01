"""Project noun group — manage research projects."""

from __future__ import annotations

from typing import Literal, cast

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import projects as db
from sonde.db.activity import log_activity
from sonde.models.project import ProjectCreate
from sonde.output import err, print_error, print_json, print_success, print_table
from sonde.services.projects import delete_project as delete_project_record


@click.group(invoke_without_command=True)
@click.pass_context
def project(ctx: click.Context) -> None:
    """Manage research projects.

    Projects group related directions and experiments into coherent
    bodies of work within a program.

    \b
    Hierarchy: Program → Project → Direction → Experiment

    \b
    Examples:
      sonde project list
      sonde project show PROJ-001
      sonde project create "SuperDroplets GPU Port" \\
        --objective "Port cloud microphysics to GPU"
    """
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@project.command("list")
@click.option("--program", "-p", help="Filter by program")
@click.option("--status", help="Filter by status")
@click.option("--all", "show_all", is_flag=True, help="Include non-active projects")
@click.option("--limit", "-n", default=50, help="Max results")
@pass_output_options
@click.pass_context
def project_list(
    ctx: click.Context,
    program: str | None,
    status: str | None,
    show_all: bool,
    limit: int,
) -> None:
    """List projects."""
    settings = get_settings()
    resolved_program = program or settings.program or None
    statuses = None if show_all else ["proposed", "active"]
    if status:
        statuses = [status]

    projects = db.list_projects(program=resolved_program, statuses=statuses, limit=limit)
    if ctx.obj.get("json"):
        print_json([p.model_dump(mode="json") for p in projects])
        return

    rows = [
        {
            "id": p.id,
            "status": p.status,
            "program": p.program,
            "name": p.name,
            "objective": (p.objective or "")[:60],
        }
        for p in projects
    ]
    print_table(["id", "status", "program", "name", "objective"], rows, title="Projects")


@project.command("show")
@click.argument("project_id")
@pass_output_options
@click.pass_context
def project_show(ctx: click.Context, project_id: str) -> None:
    """Show details for a project."""
    from sonde.commands.show import show_dispatch

    show_dispatch(ctx, project_id.upper(), graph=False)


@project.command("create")
@click.argument("name")
@click.option("--program", "-p", help="Program namespace")
@click.option("--objective", "-o", help="Project objective (one-liner for list views)")
@click.option("--description", help="Detailed project description (markdown)")
@click.option(
    "--description-file",
    type=click.Path(exists=True),
    help="Read description from file",
)
@click.option(
    "--status",
    type=click.Choice(["proposed", "active", "paused", "completed", "archived"]),
    default="active",
    help="Project status",
)
@click.option("--source", "-s", help="Who created this project")
@pass_output_options
@click.pass_context
def project_create(
    ctx: click.Context,
    name: str,
    program: str | None,
    objective: str | None,
    description: str | None,
    description_file: str | None,
    status: str,
    source: str | None,
) -> None:
    """Create a new research project.

    \b
    Examples:
      sonde project create "SuperDroplets GPU Port" \\
        --objective "Port cloud microphysics to GPU"
      sonde project create "CCN Sensitivity" \\
        --objective "Map CCN parameter space" \\
        --description "Full markdown motivation..."
      sonde project create "WRF Tuning" \\
        --description-file motivation.md
    """
    settings = get_settings()
    resolved_program = program or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "Projects need a program namespace.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    if description and description_file:
        print_error(
            "Conflicting options",
            "Use --description or --description-file, not both.",
            "Pass only one of --description or --description-file.",
        )
        raise SystemExit(2)
    if description_file:
        from pathlib import Path

        description = Path(description_file).read_text(encoding="utf-8")

    resolved_source = source or settings.source or resolve_source()
    data = ProjectCreate(
        program=resolved_program,
        name=name,
        objective=objective,
        description=description,
        status=cast(Literal["proposed", "active", "paused", "completed", "archived"], status),
        source=resolved_source,
    )
    result = db.create(data)
    log_activity(result.id, "project", "created")

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Created {result.id} ({resolved_program})",
            details=[f"Name: {name}", f"Objective: {objective or '\u2014'}"],
            breadcrumbs=[f"View: sonde project show {result.id}"],
            record_id=result.id,
        )


@project.command("update")
@click.argument("project_id")
@click.option("--name", "-n", help="Update name")
@click.option("--objective", "-o", help="Update objective")
@click.option("--description", help="Update description (markdown)")
@click.option(
    "--description-file",
    type=click.Path(exists=True),
    help="Read description from file",
)
@click.option(
    "--status",
    type=click.Choice(["proposed", "active", "paused", "completed", "archived"]),
    help="Update status",
)
@click.option("--linear", help="Link to a Linear issue/project ID")
@pass_output_options
@click.pass_context
def project_update(
    ctx: click.Context,
    project_id: str,
    name: str | None,
    objective: str | None,
    description: str | None,
    description_file: str | None,
    status: str | None,
    linear: str | None,
) -> None:
    """Update a project.

    \b
    Examples:
      sonde project update PROJ-001 --name "New Name"
      sonde project update PROJ-001 --status completed
      sonde project update PROJ-001 --description-file updated_motivation.md
      sonde project update PROJ-001 --linear PROJ-42
    """
    project_id = project_id.upper()
    current = db.get(project_id)
    if not current:
        print_error(
            f"Project {project_id} not found",
            "No project with this ID.",
            "List projects: sonde project list",
        )
        raise SystemExit(1)

    if description and description_file:
        print_error(
            "Conflicting options",
            "Use --description or --description-file, not both.",
            "Pass only one of --description or --description-file.",
        )
        raise SystemExit(2)
    if description_file:
        from pathlib import Path

        description = Path(description_file).read_text(encoding="utf-8")

    updates = {
        key: value
        for key, value in {
            "name": name,
            "objective": objective,
            "description": description,
            "status": status,
            "linear_id": linear,
        }.items()
        if value is not None
    }
    if not updates:
        print_success(f"{project_id} unchanged")
        return

    updated = db.update(project_id, updates)
    if not updated:
        print_error(
            f"Failed to update {project_id}",
            "Update returned no data.",
            f"Try: sonde project show {project_id}",
        )
        raise SystemExit(1)

    log_activity(project_id, "project", "updated", updates)
    if ctx.obj.get("json"):
        print_json(updated.model_dump(mode="json"))
    else:
        print_success(
            f"Updated {project_id}",
            details=[f"Status: {updated.status}", f"Name: {updated.name}"],
            breadcrumbs=[f"View: sonde project show {project_id}"],
            record_id=project_id,
        )


@project.command("delete")
@click.argument("project_id")
@click.option("--confirm", is_flag=True, help="Confirm deletion")
@pass_output_options
@click.pass_context
def project_delete(ctx: click.Context, project_id: str, confirm: bool) -> None:
    """Delete a project. Clears project_id on linked directions and experiments."""
    project_id = project_id.upper()
    p = db.get(project_id)
    if not p:
        print_error(f"{project_id} not found", "No project with this ID.", "sonde project list")
        raise SystemExit(1)

    if not confirm:
        from sonde.db import directions as dir_db

        dirs = dir_db.list_directions(statuses=None, limit=1000)
        dir_count = sum(1 for d in dirs if getattr(d, "project_id", None) == project_id)
        err.print(f"[sonde.warning]This will delete {project_id} ({p.name})[/]")
        if dir_count:
            err.print(f"  {dir_count} direction(s) will have project_id cleared")
        err.print("  Use --confirm to proceed.")
        raise SystemExit(1)

    deleted = delete_project_record(project_id)

    if ctx.obj.get("json"):
        print_json({"deleted": {"id": project_id}, **deleted})
    else:
        print_success(f"Deleted {project_id}")
        if deleted.get("directions_cleared"):
            err.print(f"  {deleted['directions_cleared']} direction(s) had project_id cleared")
        if deleted.get("experiments_cleared"):
            err.print(f"  {deleted['experiments_cleared']} experiment(s) had project_id cleared")


@project.command("attach")
@click.argument("project_id")
@click.argument("record_ids", nargs=-1, required=True)
@pass_output_options
@click.pass_context
def project_attach(ctx: click.Context, project_id: str, record_ids: tuple[str, ...]) -> None:
    """Attach directions and experiments to a project.

    Accepts any mix of EXP-*, DIR-* IDs. Detects type from prefix.

    \b
    Examples:
      sonde project attach PROJ-001 DIR-001 DIR-002
      sonde project attach PROJ-001 EXP-0042 EXP-0043
      sonde project attach PROJ-001 DIR-001 EXP-0042
    """
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db

    project_id = project_id.upper()
    p = db.get(project_id)
    if not p:
        print_error(f"{project_id} not found", "No project with this ID.", "sonde project list")
        raise SystemExit(1)

    attached_experiments: list[str] = []
    attached_directions: list[str] = []

    for record_id in record_ids:
        rid = record_id.upper()
        if rid.startswith("EXP-"):
            exp_db.update(rid, {"project_id": project_id})
            log_activity(rid, "experiment", "updated", {"project_id": project_id})
            attached_experiments.append(rid)
        elif rid.startswith("DIR-"):
            dir_db.update(rid, {"project_id": project_id})
            log_activity(rid, "direction", "updated", {"project_id": project_id})
            attached_directions.append(rid)
        else:
            print_error(
                f"Unknown record prefix: {rid}",
                "Expected EXP-* or DIR-* ID.",
                "Use IDs like EXP-0001 or DIR-001 (see sonde list / sonde direction list).",
            )
            raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(
            {
                "attached": {
                    "experiments": attached_experiments,
                    "directions": attached_directions,
                },
                "project": project_id,
            }
        )
    else:
        print_success(
            f"Attached {len(attached_directions)} direction(s) and "
            f"{len(attached_experiments)} experiment(s) to {project_id}"
        )


@project.command("detach")
@click.argument("record_ids", nargs=-1, required=True)
@pass_output_options
@click.pass_context
def project_detach(ctx: click.Context, record_ids: tuple[str, ...]) -> None:
    """Remove project assignment from directions and experiments.

    \b
    Examples:
      sonde project detach DIR-001 EXP-0042
    """
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db

    detached_experiments: list[str] = []
    detached_directions: list[str] = []

    for record_id in record_ids:
        rid = record_id.upper()
        if rid.startswith("EXP-"):
            exp_db.update(rid, {"project_id": None})
            log_activity(rid, "experiment", "updated", {"project_id": None})
            detached_experiments.append(rid)
        elif rid.startswith("DIR-"):
            dir_db.update(rid, {"project_id": None})
            log_activity(rid, "direction", "updated", {"project_id": None})
            detached_directions.append(rid)
        else:
            print_error(
                f"Unknown record prefix: {rid}",
                "Expected EXP-* or DIR-* ID.",
                "Use IDs like EXP-0001 or DIR-001 (see sonde list / sonde direction list).",
            )
            raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(
            {
                "detached": {
                    "experiments": detached_experiments,
                    "directions": detached_directions,
                },
            }
        )
    else:
        print_success(
            f"Detached {len(detached_directions)} direction(s) and "
            f"{len(detached_experiments)} experiment(s) from their project"
        )


@project.command("adopt")
@click.argument("project_id")
@click.option("--direction", "-d", help="Adopt all experiments under this direction")
@click.option("--dry-run", is_flag=True, help="Show what would be adopted")
@pass_output_options
@click.pass_context
def project_adopt(
    ctx: click.Context, project_id: str, direction: str | None, dry_run: bool
) -> None:
    """Adopt orphaned records into a project.

    With --direction: adopts the direction and all its experiments.
    Without: lists orphaned records in the same program.

    \b
    Examples:
      sonde project adopt PROJ-001 --direction DIR-001
      sonde project adopt PROJ-001 --direction DIR-001 --dry-run
    """
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db

    project_id = project_id.upper()
    p = db.get(project_id)
    if not p:
        print_error(f"{project_id} not found", "No project with this ID.", "sonde project list")
        raise SystemExit(1)

    if not direction:
        print_error(
            "No --direction specified",
            "Currently only --direction mode is supported.",
            "Usage: sonde project adopt PROJ-001 --direction DIR-001",
        )
        raise SystemExit(1)

    direction_id = direction.upper()
    dir_record = dir_db.get(direction_id)
    if not dir_record:
        print_error(
            f"{direction_id} not found",
            "No direction with this ID.",
            "sonde direction list",
        )
        raise SystemExit(1)

    experiments = exp_db.list_by_direction(direction_id)
    orphans = [e for e in experiments if not getattr(e, "project_id", None)]
    adopt_direction = not getattr(dir_record, "project_id", None)

    if dry_run:
        items: list[str] = []
        if adopt_direction:
            items.append(f"  {direction_id} (direction)")
        for exp in orphans:
            items.append(f"  {exp.id} (experiment)")
        if ctx.obj.get("json"):
            print_json(
                {
                    "dry_run": True,
                    "project": project_id,
                    "would_adopt": {
                        "direction": direction_id if adopt_direction else None,
                        "experiments": [e.id for e in orphans],
                    },
                }
            )
        else:
            if not items:
                print_success("Nothing to adopt — all records already assigned")
            else:
                err.print(f"[sonde.warning]Would adopt into {project_id}:[/]")
                for item in items:
                    err.print(item)
        return

    adopted_count = 0
    if adopt_direction:
        dir_db.update(direction_id, {"project_id": project_id})
        log_activity(direction_id, "direction", "updated", {"project_id": project_id})

    for exp in orphans:
        exp_db.update(exp.id, {"project_id": project_id})
        log_activity(exp.id, "experiment", "updated", {"project_id": project_id})
        adopted_count += 1

    if ctx.obj.get("json"):
        print_json(
            {
                "adopted": {
                    "direction": direction_id if adopt_direction else None,
                    "experiments": [e.id for e in orphans],
                },
                "project": project_id,
            }
        )
    else:
        parts = []
        if adopt_direction:
            parts.append(direction_id)
        if adopted_count:
            parts.append(f"{adopted_count} experiment(s)")
        if parts:
            print_success(f"Adopted {' and '.join(parts)} into {project_id}")
        else:
            print_success("Nothing to adopt — all records already assigned")


# Wire project brief subcommand
from sonde.commands.project_brief import project_brief  # noqa: E402

project.add_command(project_brief)
