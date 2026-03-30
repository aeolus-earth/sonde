"""Repository bootstrap command."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click
import yaml

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import directions as dir_db
from sonde.db import programs as prog_db
from sonde.db.activity import log_activity
from sonde.local import find_sonde_dir
from sonde.models.direction import DirectionCreate
from sonde.output import err, print_error, print_json, print_success


def _load_existing_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        return {}
    with config_path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@click.command("init")
@click.option("--program", "-p", help="Program namespace")
@click.option("--source", "-s", help="Default source attribution")
@click.option("--default-direction", help="Default direction ID to pin in .aeolus.yaml")
@click.option("--direction-title", help="Create and set a new default direction title")
@click.option("--direction-question", help="Question for the new default direction")
@pass_output_options
@click.pass_context
def init_cmd(
    ctx: click.Context,
    program: str | None,
    source: str | None,
    default_direction: str | None,
    direction_title: str | None,
    direction_question: str | None,
) -> None:
    """Initialize repo-local Sonde config for a research project."""
    settings = get_settings()
    available_programs = [program.id for program in prog_db.list_programs()]
    resolved_program = program or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "Init needs a target program.",
            "Use --program <name>.",
        )
        raise SystemExit(2)
    if resolved_program not in available_programs:
        print_error(
            f"Unknown program: {resolved_program}",
            "You do not have access to that program or it does not exist.",
            "Run: sonde status",
        )
        raise SystemExit(1)

    resolved_source = source or settings.source or resolve_source()
    created_direction_id = None
    if direction_title or direction_question:
        if not direction_title or not direction_question:
            print_error(
                "Incomplete direction bootstrap",
                "Both --direction-title and --direction-question are required together.",
                "Provide both flags or use --default-direction.",
            )
            raise SystemExit(2)
        direction = dir_db.create(
            DirectionCreate(
                program=resolved_program,
                title=direction_title,
                question=direction_question,
                status="active",
                source=resolved_source,
            )
        )
        created_direction_id = direction.id
        log_activity(direction.id, "direction", "created")

    config_path = Path.cwd() / ".aeolus.yaml"
    config = _load_existing_config(config_path)
    config["program"] = resolved_program
    config["source"] = resolved_source
    if default_direction or created_direction_id:
        config["default_direction"] = default_direction or created_direction_id

    with config_path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(config, fh, sort_keys=False)

    sonde_dir = find_sonde_dir()
    (sonde_dir / "brief.md").touch(exist_ok=True)

    payload = {
        "program": resolved_program,
        "source": resolved_source,
        "default_direction": config.get("default_direction"),
        "config_path": str(config_path),
    }
    if ctx.obj.get("json"):
        print_json(payload)
    else:
        print_success(f"Initialized {config_path.name}")
        err.print(f"  [sonde.muted]Program: {resolved_program}[/]")
        if config.get("default_direction"):
            err.print(f"  [sonde.muted]Default direction: {config['default_direction']}[/]")
        err.print("  [sonde.muted]Workspace: .sonde/[/]")
