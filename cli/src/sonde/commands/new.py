"""New command — scaffold a record file with minimal template."""

from __future__ import annotations

from datetime import UTC, datetime

import click

from sonde.config import get_settings
from sonde.local import TEMPLATES, ensure_subdir, find_sonde_dir
from sonde.output import err, print_error, print_success


def _slugify(title: str) -> str:
    """Convert a title to a filename-safe slug."""
    import re

    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    return slug[:60]


def _create_new(record_type: str, title: str | None, program: str | None) -> None:
    """Core logic for creating a new record file from a template."""
    settings = get_settings()
    resolved_program = program or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "New records need a program namespace.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    template = TEMPLATES.get(record_type, TEMPLATES["note"])
    content = template.format(program=resolved_program)

    # Determine filename
    if title:
        filename = f"{_slugify(title)}.md"
    else:
        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H-%M")
        filename = f"draft-{timestamp}.md"

    # Determine directory
    category = {
        "experiment": "experiments",
        "finding": "findings",
        "question": "questions",
        "note": "notes",
    }[record_type]

    sonde_dir = find_sonde_dir()
    subdir = ensure_subdir(sonde_dir, category)
    filepath = subdir / filename

    if filepath.exists():
        print_error(
            f"File already exists: {filename}",
            f"{filepath} already exists.",
            "Choose a different title or edit the existing file.",
        )
        raise SystemExit(1)

    filepath.write_text(content, encoding="utf-8")

    print_success(f"Created {filepath.relative_to(sonde_dir.parent)}")
    err.print(f"  [sonde.muted]Edit the file, then: sonde push {record_type} {filepath.stem}[/]")


@click.command("new")
@click.argument("record_type", type=click.Choice(["experiment", "finding", "question", "note"]))
@click.option("--title", "-t", help="Title (used for filename)")
@click.option("--program", "-p", help="Program namespace")
@click.pass_context
def new(ctx: click.Context, record_type: str, title: str | None, program: str | None) -> None:
    """Create a new record file from a template.

    \b
    Examples:
      sonde new experiment
      sonde new finding --title "CCN saturation threshold"
      sonde new question
      sonde new note --title "Literature review"
    """
    _create_new(record_type, title, program)


@click.command("new")
@click.option("--title", "-t", help="Title (used for filename)")
@click.option("--program", "-p", help="Program namespace")
@click.pass_context
def new_experiment(ctx: click.Context, title: str | None, program: str | None) -> None:
    """Scaffold a new experiment file from a template.

    \b
    Examples:
      sonde experiment new
      sonde experiment new --title "CCN sweep subtropical"
    """
    _create_new("experiment", title, program)
