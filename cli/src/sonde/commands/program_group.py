"""Program noun group — manage research programs."""

from __future__ import annotations

from typing import Any

import click
from postgrest.exceptions import APIError
from pydantic import ValidationError

from sonde.cli_options import pass_output_options
from sonde.db import programs as db
from sonde.models.program import ProgramCreate
from sonde.output import err, print_breadcrumbs, print_error, print_json, print_success, print_table


@click.group(invoke_without_command=True)
@click.pass_context
def program(ctx: click.Context) -> None:
    """Manage research programs."""
    if ctx.invoked_subcommand is None:
        ctx.invoke(program_list)


@program.command("list")
@click.option("--all", "show_all", is_flag=True, help="Include archived programs")
@pass_output_options
@click.pass_context
def program_list(ctx: click.Context, show_all: bool = False) -> None:
    """List active programs with stats."""
    programs = db.list_programs(include_archived=show_all)

    if ctx.obj.get("json"):
        items: list[dict[str, Any]] = []
        for p in programs:
            d = p.model_dump(mode="json")
            d["_stats"] = db.get_stats(p.id)
            items.append(d)
        print_json(items)
        return

    rows = []
    for p in programs:
        stats = db.get_stats(p.id)
        rows.append({
            "program": p.id,
            "experiments": str(stats.get("experiments", 0)),
            "findings": str(stats.get("findings", 0)),
            "directions": str(stats.get("directions", 0)),
            "status": "archived" if p.is_archived else "active",
        })
    print_table(
        ["program", "experiments", "findings", "directions", "status"],
        rows,
        title="Programs",
    )


@program.command("create")
@click.argument("id")
@click.option("--name", "-n", required=True, help="Display name for the program")
@click.option("--description", "-d", "description", default=None, help="Program description")
@pass_output_options
@click.pass_context
def program_create(ctx: click.Context, id: str, name: str, description: str | None) -> None:
    """Create a new program.

    \b
    Examples:
      sonde program create weather-intervention --name "Weather Intervention"
      sonde program create ccn-study --name "CCN Study" -d "Cloud condensation nuclei research"
    """
    try:
        data = ProgramCreate(id=id, name=name, description=description)
    except ValidationError:
        print_error(
            f"Invalid program ID: {id}",
            "IDs must be lowercase, start with a letter, and contain only letters/numbers/hyphens.",
            f'Try: sonde program create {id.lower().replace(" ", "-")} --name "{name}"',
        )
        raise SystemExit(2) from None

    try:
        result = db.create(data)
    except APIError as exc:
        msg = str(exc)
        if "duplicate" in msg.lower() or "23505" in msg:
            print_error(
                f"Program {id} already exists",
                "A program with this ID is already registered.",
                f"View it: sonde program show {id}",
            )
        else:
            print_error(
                f"Failed to create program {id}",
                msg,
                "Check your permissions and try again.",
            )
        raise SystemExit(1) from None

    if ctx.obj.get("json"):
        print_json(result.model_dump(mode="json"))
    else:
        print_success(
            f"Created program {id}. You are admin.",
            details=[f"Name: {name}"],
            breadcrumbs=[f"View: sonde program show {id}"],
        )


@program.command("show")
@click.argument("id")
@pass_output_options
@click.pass_context
def program_show(ctx: click.Context, id: str) -> None:
    """Show program details.

    \b
    Examples:
      sonde program show weather-intervention
      sonde program show weather-intervention --json
    """
    p = db.get(id)
    if not p:
        print_error(
            f"Program {id} not found",
            "No program with this ID.",
            "List programs: sonde program list --all",
        )
        raise SystemExit(1)

    stats = db.get_stats(id)

    if ctx.obj.get("json"):
        d = p.model_dump(mode="json")
        d["_stats"] = stats
        print_json(d)
        return

    # Human-readable panel
    err.print(f"\n[sonde.heading]{p.name}[/]  [sonde.muted]({p.id})[/]")
    if p.description:
        err.print(f"  [sonde.muted]{p.description}[/]")
    err.print(f"  Created: {p.created_at:%Y-%m-%d}")
    if p.is_archived:
        err.print(f"  [sonde.warning]Archived: {p.archived_at:%Y-%m-%d}[/]")
    else:
        err.print("  Status: [sonde.success]active[/]")

    # Stats table
    stat_rows = [
        {"noun": k, "count": str(v)}
        for k, v in stats.items()
    ]
    print_table(["noun", "count"], stat_rows, title="Records")

    print_breadcrumbs([
        f"sonde list -p {id}",
        f"sonde tree -p {id}",
        f"sonde brief -p {id}",
    ])


@program.command("archive")
@click.argument("id")
@click.pass_context
def program_archive(ctx: click.Context, id: str) -> None:
    """Archive a program. Data is preserved but hidden from default views."""
    try:
        db.archive(id)
    except APIError as exc:
        msg = str(exc)
        if "42501" in msg or "Only program admins" in msg.lower():
            print_error(
                f"Cannot archive {id}",
                "Only program admins can archive.",
                "Ask an admin for help.",
            )
        else:
            print_error(f"Failed to archive {id}", msg, "Check your permissions.")
        raise SystemExit(1) from None

    print_success(f"Archived {id}. Data is preserved but hidden from default views.")


@program.command("unarchive")
@click.argument("id")
@click.pass_context
def program_unarchive(ctx: click.Context, id: str) -> None:
    """Unarchive a program."""
    try:
        db.unarchive(id)
    except APIError as exc:
        msg = str(exc)
        if "42501" in msg or "Only program admins" in msg.lower():
            print_error(
                f"Cannot unarchive {id}",
                "Only program admins can unarchive.",
                "Ask an admin for help.",
            )
        else:
            print_error(f"Failed to unarchive {id}", msg, "Check your permissions.")
        raise SystemExit(1) from None

    print_success(f"Unarchived {id}.")


@program.command("delete")
@click.argument("id")
@click.option("--confirm", "confirm_id", default=None, help="Confirm by repeating the program ID")
@click.pass_context
def program_delete(ctx: click.Context, id: str, confirm_id: str | None) -> None:
    """Delete a program and all child records. Requires --confirm <id>."""
    if confirm_id != id:
        err.print(f"\n  To delete, use: [sonde.brand]sonde program delete {id} --confirm {id}[/]\n")
        raise SystemExit(2)

    # Show what will be deleted
    stats = db.get_stats(id)
    counts = ", ".join(f"{v} {k}" for k, v in stats.items() if v)
    if counts:
        err.print(f"  This will permanently delete [sonde.warning]{id}[/] and all {counts}.")
    else:
        err.print(f"  This will permanently delete [sonde.warning]{id}[/].")

    try:
        db.delete(id)
    except APIError as exc:
        msg = str(exc)
        if "42501" in msg:
            print_error(
                f"Cannot delete {id}",
                "Only global admins can delete programs.",
                "Contact a global admin for help.",
            )
        else:
            print_error(f"Failed to delete {id}", msg, "Check your permissions.")
        raise SystemExit(1) from None

    print_success(f"Deleted {id} and all child records.")
