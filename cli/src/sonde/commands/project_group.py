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
@click.option("--objective", "-o", help="Project objective / description")
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
    status: str,
    source: str | None,
) -> None:
    """Create a new research project."""
    settings = get_settings()
    resolved_program = program or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "Projects need a program namespace.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    resolved_source = source or settings.source or resolve_source()
    data = ProjectCreate(
        program=resolved_program,
        name=name,
        objective=objective,
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
            details=[f"Name: {name}", f"Objective: {objective or '—'}"],
            breadcrumbs=[f"View: sonde project show {result.id}"],
        )


@project.command("update")
@click.argument("project_id")
@click.option("--name", "-n", help="Update name")
@click.option("--objective", "-o", help="Update objective")
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
    status: str | None,
    linear: str | None,
) -> None:
    """Update a project."""
    project_id = project_id.upper()
    current = db.get(project_id)
    if not current:
        print_error(
            f"Project {project_id} not found",
            "No project with this ID.",
            "List projects: sonde project list",
        )
        raise SystemExit(1)

    updates = {
        key: value
        for key, value in {
            "name": name,
            "objective": objective,
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
        print_error(f"Failed to update {project_id}", "Update returned no data.")
        raise SystemExit(1)

    log_activity(project_id, "project", "updated", updates)
    if ctx.obj.get("json"):
        print_json(updated.model_dump(mode="json"))
    else:
        print_success(
            f"Updated {project_id}",
            details=[f"Status: {updated.status}", f"Name: {updated.name}"],
            breadcrumbs=[f"View: sonde project show {project_id}"],
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
