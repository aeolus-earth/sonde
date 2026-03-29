"""Push command — sync local .sonde/ files to Supabase."""

from __future__ import annotations

import os
from pathlib import Path

import click

from sonde.auth import get_current_user
from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.local import find_sonde_dir, parse_markdown
from sonde.output import err, print_error, print_json, print_success


@click.group(invoke_without_command=True)
@click.pass_context
def push(ctx: click.Context) -> None:
    """Push local .sonde/ changes to Supabase.

    \b
    Examples:
      sonde push                          # push all experiments
      sonde push experiment EXP-0001      # push one
      sonde push experiment my-draft      # create new from local .md
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(push_experiments)


@push.command("experiment")
@click.argument("name")
@click.pass_context
def push_experiment(ctx: click.Context, name: str) -> None:
    """Push a single experiment from .sonde/experiments/.

    NAME is the filename (without .md) or experiment ID.

    \b
    Examples:
      sonde push experiment EXP-0001
      sonde push experiment my-draft
    """
    sonde_dir = find_sonde_dir()
    filepath = _find_file(sonde_dir / "experiments", name)
    if not filepath:
        print_error(
            f"File not found: {name}",
            f"No .md file matching '{name}' in .sonde/experiments/",
            "Create a file first: sonde new experiment",
        )
        raise SystemExit(1)

    fm, body = parse_markdown(filepath.read_text(encoding="utf-8"))
    if not fm:
        print_error(
            "Invalid file",
            "Could not parse YAML frontmatter.",
            "Ensure the file starts with --- and has valid YAML.",
        )
        raise SystemExit(1)

    result = _upsert_experiment(fm, body, filepath)

    if ctx.obj.get("json"):
        print_json(result)
    else:
        action = "Updated" if fm.get("id") else "Created"
        print_success(f"{action} {result['id']}")


@push.command("experiments")
@click.pass_context
def push_experiments(ctx: click.Context) -> None:
    """Push all experiment .md files from .sonde/experiments/.

    \b
    Examples:
      sonde push experiments
    """
    sonde_dir = find_sonde_dir()
    exp_dir = sonde_dir / "experiments"

    if not exp_dir.exists():
        err.print("[sonde.muted]No experiments directory found.[/]")
        return

    count = 0
    for filepath in sorted(exp_dir.glob("*.md")):
        fm, body = parse_markdown(filepath.read_text(encoding="utf-8"))
        if not fm:
            err.print(f"  [sonde.warning]Skipped {filepath.name} (invalid frontmatter)[/]")
            continue
        result = _upsert_experiment(fm, body, filepath)
        action = "Updated" if fm.get("id") else "Created"
        err.print(f"  [sonde.muted]{action} {result['id']}[/]")
        count += 1

    print_success(f"Pushed {count} experiment(s)")


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------


def _find_file(directory: Path, name: str) -> Path | None:
    """Find a .md file by name or ID."""
    for candidate in [f"{name}.md", f"{name.upper()}.md"]:
        path = directory / candidate
        if path.exists():
            return path
    return None


def _upsert_experiment(fm: dict, body: str, filepath: Path) -> dict:
    """Create or update an experiment from frontmatter + body."""
    client = get_client()
    settings = get_settings()
    user = get_current_user()

    # Resolve source
    source = fm.get("source", "")
    if not source:
        if user and not user.is_agent:
            source = f"human/{user.email.split('@')[0]}"
        else:
            source = f"human/{os.environ.get('USER', 'unknown')}"

    # Resolve program
    program = fm.get("program") or settings.program
    if not program:
        raise click.ClickException(
            "No program in frontmatter or .aeolus.yaml. Add 'program:' to the file."
        )

    # Build the row — frontmatter fields + body as content
    row = {
        "program": program,
        "source": source,
        "status": fm.get("status", "open"),
        "tags": fm.get("tags", []),
        "content": body if body else None,
        "metadata": fm.get("metadata", {}),
        # Legacy structured fields (populated if agent provides them)
        "hypothesis": fm.get("hypothesis"),
        "parameters": fm.get("parameters", {}),
        "results": fm.get("results"),
        "finding": fm.get("finding"),
        "related": fm.get("related", []),
        "direction_id": fm.get("direction_id"),
    }

    existing_id = fm.get("id", "")

    if existing_id and existing_id.startswith("EXP-"):
        # Update
        result = client.table("experiments").update(row).eq("id", existing_id).execute()
        return rows(result.data)[0]
    else:
        # Create
        from sonde.db.experiments import _next_id

        new_id = _next_id()
        row["id"] = new_id
        result = client.table("experiments").insert(row).execute()
        created = rows(result.data)[0]

        # Rename file to assigned ID, write ID back to frontmatter
        new_path = filepath.parent / f"{new_id}.md"
        if filepath != new_path:
            content = filepath.read_text(encoding="utf-8")
            # Insert id into frontmatter
            content = content.replace("---\n", f"---\nid: {new_id}\n", 1)
            new_path.write_text(content, encoding="utf-8")
            filepath.unlink()
            err.print(f"  [sonde.muted]Renamed → {new_path.name}[/]")

        return created
