"""Takeaway command — maintain program-level research synthesis."""

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


def _takeaways_path() -> Path:
    """Return the path to .sonde/takeaways.md."""
    return find_sonde_dir() / "takeaways.md"


def _read_takeaways_raw() -> str | None:
    """Read raw takeaways content, or None if file missing/empty."""
    path = Path.cwd() / ".sonde" / "takeaways.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    # Strip header
    body = text.removeprefix(_HEADER.strip()).strip()
    return body if body else None


def _append_takeaway(content: str, source: str) -> Path:
    """Append a timestamped takeaway to .sonde/takeaways.md."""
    path = _takeaways_path()
    now = datetime.now(UTC).strftime("%Y-%m-%d")

    entry = f"\n- {content.strip()} *({now}, {source})*\n"

    if path.exists():
        existing = path.read_text(encoding="utf-8")
        path.write_text(existing.rstrip("\n") + "\n" + entry, encoding="utf-8")
    else:
        path.write_text(_HEADER + entry, encoding="utf-8")

    return path


def _replace_takeaways(content: str, source: str) -> Path:
    """Replace takeaways content entirely (for consolidation)."""
    path = _takeaways_path()
    now = datetime.now(UTC).strftime("%Y-%m-%d")

    body = f"\n{content.strip()}\n\n*Consolidated {now} by {source}*\n"
    path.write_text(_HEADER + body, encoding="utf-8")

    return path


@click.command("takeaway")
@click.argument("content", required=False, default=None)
@click.option("--program", "-p", help="Program (for display only; default from .aeolus.yaml)")
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
    from_file: str | None,
    show: bool,
    replace_content: str | None,
) -> None:
    """Maintain program-level research takeaways.

    Takeaways are your running synthesis — the "so what" of the research.
    While findings record individual facts, takeaways connect them into
    a narrative: what the program has learned and where to go next.

    Update takeaways every time you close an experiment.

    \b
    Examples:
      sonde takeaway "CCN saturates at ~1500. Next: BL heating."
      sonde takeaway -f synthesis.md
      sonde takeaway --show
      sonde takeaway --replace "Fresh consolidated summary"
    """
    settings = get_settings()
    resolved_program = program or settings.program or "unknown"

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
