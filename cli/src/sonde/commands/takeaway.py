"""Takeaway command — maintain program- or project-level research synthesis."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.local import find_sonde_dir
from sonde.output import err, print_error, print_json, print_success

_HEADER = "# Takeaways\n"


def _sync_to_db(program: str) -> None:
    """Best-effort sync of local takeaways to the database."""
    try:
        from sonde.db import program_takeaways as tw_db

        body = _read_takeaways_raw()
        if body and program and program != "unknown":
            tw_db.upsert(program, body)
    except Exception:
        pass


def _sync_project_to_db(project_id: str) -> None:
    """Best-effort sync of project takeaways to the database."""
    try:
        from sonde.db import project_takeaways as ptw_db

        body = ptw_db.read_takeaways_file(find_sonde_dir(), project_id)
        if body:
            ptw_db.upsert(project_id, body)
    except Exception:
        pass


def _takeaways_path() -> Path:
    """Return the path to .sonde/takeaways.md."""
    return find_sonde_dir() / "takeaways.md"


def _project_takeaways_path(project_id: str) -> Path:
    """Return the path to .sonde/projects/{project_id}/takeaways.md."""
    path = find_sonde_dir() / "projects" / project_id / "takeaways.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _read_takeaways_raw() -> str | None:
    """Read raw takeaways content, or None if file missing/empty."""
    path = Path.cwd() / ".sonde" / "takeaways.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    # Strip header
    body = text.removeprefix(_HEADER.strip()).strip()
    return body if body else None


def _append_takeaway(content: str, source: str, path: Path | None = None) -> Path:
    """Append a timestamped takeaway to a takeaways file."""
    if path is None:
        path = _takeaways_path()
    now = datetime.now(UTC).strftime("%Y-%m-%d")

    entry = f"\n- {content.strip()} *({now}, {source})*\n"

    if path.exists():
        existing = path.read_text(encoding="utf-8")
        path.write_text(existing.rstrip("\n") + "\n" + entry, encoding="utf-8")
    else:
        path.write_text(_HEADER + entry, encoding="utf-8")

    return path


def _replace_takeaways(content: str, source: str, path: Path | None = None) -> Path:
    """Replace takeaways content entirely (for consolidation)."""
    if path is None:
        path = _takeaways_path()
    now = datetime.now(UTC).strftime("%Y-%m-%d")

    body = f"\n{content.strip()}\n\n*Consolidated {now} by {source}*\n"
    path.write_text(_HEADER + body, encoding="utf-8")

    return path


def _read_file_body(path: Path) -> str | None:
    """Read a takeaways file and return the body (without header)."""
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    body = text.removeprefix(_HEADER.strip()).strip()
    return body if body else None


@click.command("takeaway")
@click.argument("content", required=False, default=None)
@click.option("--program", "-p", help="Program (for display only; default from .aeolus.yaml)")
@click.option("--project", help="Scope takeaway to a project (PROJ-* ID)")
@click.option(
    "--file",
    "-f",
    "from_file",
    type=click.Path(exists=True),
    help="Read content from file",
)
@click.option("--show", is_flag=True, help="Display current takeaways")
@click.option(
    "--replace",
    "replace_content",
    default=None,
    help="Replace all takeaways (consolidate)",
)
@pass_output_options
@click.pass_context
def takeaway(
    ctx: click.Context,
    content: str | None,
    program: str | None,
    project: str | None,
    from_file: str | None,
    show: bool,
    replace_content: str | None,
) -> None:
    """Maintain program- or project-level research takeaways.

    Takeaways are your running synthesis — the "so what" of the research.
    While findings record individual facts, takeaways connect them into
    a narrative: what the program has learned and where to go next.

    Use --project to scope takeaways to a specific project.

    \b
    Examples:
      sonde takeaway "CCN saturates at ~1500. Next: BL heating."
      sonde takeaway --project PROJ-001 "Confirmed approach works for mid-lat"
      sonde takeaway -f synthesis.md
      sonde takeaway --show
      sonde takeaway --project PROJ-001 --show
      sonde takeaway --replace "Fresh consolidated summary"
    """
    settings = get_settings()
    resolved_program = program or settings.program or "unknown"

    if project:
        project = project.upper()
        _handle_project_takeaway(ctx, project, content, from_file, show, replace_content)
        return

    # ── Program-level takeaways ──

    # Show mode
    if show:
        body = _read_takeaways_raw()
        if ctx.obj.get("json"):
            print_json({"program": resolved_program, "takeaways": body})
        elif body:
            err.print(f"\n[sonde.heading]Takeaways ({resolved_program})[/]\n")
            err.print(body)
            err.print()
        else:
            err.print(f"\n[sonde.muted]No takeaways yet for {resolved_program}[/]")
            err.print('  Add one: sonde takeaway "what you learned"\n')
        return

    # Replace mode
    if replace_content is not None:
        source = resolve_source()
        path = _replace_takeaways(replace_content, source)
        _sync_to_db(resolved_program)
        if ctx.obj.get("json"):
            print_json(
                {
                    "replaced": True,
                    "program": resolved_program,
                    "source": source,
                    "path": str(path),
                }
            )
        else:
            print_success(f"Takeaways consolidated ({resolved_program})")
            err.print(f"  [sonde.muted]{path.relative_to(path.parent.parent)}[/]")
        return

    # Append mode
    if from_file:
        content = Path(from_file).read_text(encoding="utf-8")
    if not content:
        print_error(
            "No takeaway content",
            "Provide a takeaway as an argument or --file.",
            'sonde takeaway "what you learned and what it means"',
        )
        raise SystemExit(2)

    source = resolve_source()
    path = _append_takeaway(content, source)
    _sync_to_db(resolved_program)

    if ctx.obj.get("json"):
        print_json(
            {
                "appended": True,
                "program": resolved_program,
                "content": content.strip(),
                "source": source,
                "path": str(path),
            }
        )
    else:
        print_success(f"Takeaway added ({resolved_program})")
        err.print(f"  [sonde.muted]{path.relative_to(path.parent.parent)}[/]")
        err.print("  View: sonde takeaway --show")
        err.print(f"  Brief: sonde brief -p {resolved_program}")


def _handle_project_takeaway(
    ctx: click.Context,
    project_id: str,
    content: str | None,
    from_file: str | None,
    show: bool,
    replace_content: str | None,
) -> None:
    """Handle --project scoped takeaway operations."""
    # Validate PROJ-* prefix
    if not project_id.startswith("PROJ-"):
        print_error(
            f"Invalid project ID: {project_id}",
            "Expected a PROJ-* ID.",
            "sonde project list",
        )
        raise SystemExit(2)

    # Validate project exists (skip for show — just read local file)
    if not show:
        try:
            from sonde.db import projects as proj_db

            if not proj_db.get(project_id):
                print_error(
                    f"Project {project_id} not found",
                    "Cannot add takeaways to a nonexistent project.",
                    "sonde project list",
                )
                raise SystemExit(1)
        except SystemExit:
            raise
        except Exception:
            pass  # Best-effort — DB may be unreachable

    path = _project_takeaways_path(project_id)

    # Show mode
    if show:
        body = _read_file_body(path)
        if ctx.obj.get("json"):
            print_json({"project": project_id, "takeaways": body})
        elif body:
            err.print(f"\n[sonde.heading]Takeaways ({project_id})[/]\n")
            err.print(body)
            err.print()
        else:
            err.print(f"\n[sonde.muted]No takeaways yet for {project_id}[/]")
            err.print(f'  Add one: sonde takeaway --project {project_id} "what you learned"\n')
        return

    # Replace mode
    if replace_content is not None:
        source = resolve_source()
        result_path = _replace_takeaways(replace_content, source, path)
        _sync_project_to_db(project_id)
        if ctx.obj.get("json"):
            print_json(
                {
                    "replaced": True,
                    "project": project_id,
                    "source": source,
                    "path": str(result_path),
                }
            )
        else:
            print_success(f"Takeaways consolidated ({project_id})")
        return

    # Append mode
    if from_file:
        content = Path(from_file).read_text(encoding="utf-8")
    if not content:
        print_error(
            "No takeaway content",
            "Provide a takeaway as an argument or --file.",
            f'sonde takeaway --project {project_id} "what you learned"',
        )
        raise SystemExit(2)

    source = resolve_source()
    _append_takeaway(content, source, path)
    _sync_project_to_db(project_id)

    if ctx.obj.get("json"):
        print_json(
            {
                "appended": True,
                "project": project_id,
                "content": content.strip(),
                "source": source,
                "path": str(path),
            }
        )
    else:
        print_success(f"Takeaway added ({project_id})")
        err.print(f"  View: sonde takeaway --project {project_id} --show")
        err.print(f"  Project: sonde project show {project_id}")
