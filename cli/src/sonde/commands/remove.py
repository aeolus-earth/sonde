"""Local workspace cleanup commands."""

from __future__ import annotations

import shutil
from pathlib import Path

import click

from sonde.cli_options import pass_output_options
from sonde.local import find_sonde_dir, resolve_record_path
from sonde.output import print_error, print_json, print_success


def _remove_local_record(category: str, name: str) -> Path:
    sonde_dir = find_sonde_dir()
    try:
        candidate = resolve_record_path(sonde_dir, category, name)
    except ValueError:
        print_error(
            f"Invalid local record path: {name}",
            "Record names must stay within .sonde/ and must not be absolute paths.",
            "Use the record ID or local filename stem.",
        )
        raise SystemExit(2) from None
    if candidate is not None:
        candidate.unlink()
        if category == "experiments":
            # Artifact dir is a sibling directory named after the experiment ID
            exp_dir = candidate.parent / candidate.stem
            if exp_dir.is_dir():
                shutil.rmtree(exp_dir)
        return candidate

    print_error(
        f"Local record not found: {name}",
        f"No .md file matching '{name}' in .sonde/",
        "Use the exact local filename stem or record ID.",
    )
    raise SystemExit(1)


@click.command("remove")
@click.argument("name")
@pass_output_options
@click.pass_context
def remove_experiment(ctx: click.Context, name: str) -> None:
    """Remove a local experiment file and its notebook directory."""
    path = _remove_local_record("experiments", name)
    if ctx.obj.get("json"):
        print_json({"removed": path.name, "category": "experiments"})
        return
    print_success(f"Removed {path.name} from .sonde/experiments/")


@click.command("remove")
@click.argument("name")
@pass_output_options
@click.pass_context
def remove_finding(ctx: click.Context, name: str) -> None:
    """Remove a local finding file."""
    path = _remove_local_record("findings", name)
    if ctx.obj.get("json"):
        print_json({"removed": path.name, "category": "findings"})
        return
    print_success(f"Removed {path.name} from .sonde/findings/")


@click.command("remove")
@click.argument("name")
@pass_output_options
@click.pass_context
def remove_question(ctx: click.Context, name: str) -> None:
    """Remove a local question file."""
    path = _remove_local_record("questions", name)
    if ctx.obj.get("json"):
        print_json({"removed": path.name, "category": "questions"})
        return
    print_success(f"Removed {path.name} from .sonde/questions/")


@click.command("remove")
@click.argument("name")
@pass_output_options
@click.pass_context
def remove_direction(ctx: click.Context, name: str) -> None:
    """Remove a local direction file."""
    path = _remove_local_record("directions", name)
    if ctx.obj.get("json"):
        print_json({"removed": path.name, "category": "directions"})
        return
    print_success(f"Removed {path.name} from .sonde/directions/")
