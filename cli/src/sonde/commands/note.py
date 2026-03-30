"""Note command — add notes to experiments."""

from __future__ import annotations

from datetime import UTC, datetime

import click
from postgrest.exceptions import APIError

from sonde.auth import resolve_source
from sonde.db import notes as db
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.output import err, print_error, print_json, print_success


@click.command()
@click.argument("experiment_id")
@click.argument("content", required=False)
@click.option("--file", "-f", "note_file", type=click.Path(exists=True), help="Note from file")
@click.pass_context
def note(
    ctx: click.Context,
    experiment_id: str,
    content: str | None,
    note_file: str | None,
) -> None:
    """Add a note to an experiment.

    \b
    Examples:
      sonde note EXP-0001 "This might interact with BL heating"
      sonde note EXP-0001 -f observations.md
    """
    experiment_id = experiment_id.upper()

    if note_file:
        from pathlib import Path

        content = Path(note_file).read_text(encoding="utf-8")
    elif not content:
        print_error(
            "No note content",
            "Provide a note as an argument or --file.",
            'sonde note EXP-0001 "your note here"',
        )
        raise SystemExit(2)

    # Verify experiment exists
    if not db.experiment_exists(experiment_id):
        print_error(
            f"Experiment {experiment_id} not found",
            "Cannot add a note to a nonexistent experiment.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    source = resolve_source()
    now = datetime.now(UTC)

    try:
        row = db.create(experiment_id, content, source)
    except APIError as exc:
        print_error(
            "Failed to save note",
            str(exc),
            "The experiment_notes table may need to be created. Run migrations.",
        )
        raise SystemExit(1) from None

    note_id = row["id"]

    # Log activity
    from sonde.db.activity import log_activity

    log_activity(experiment_id, "experiment", "note_added", {"note_id": note_id})

    # Write locally too
    sonde_dir = find_sonde_dir()
    notes_dir = ensure_subdir(sonde_dir, f"experiments/{experiment_id}/notes")
    timestamp = now.strftime("%Y-%m-%dT%H-%M-%S")
    local_file = notes_dir / f"{timestamp}.md"
    local_file.write_text(
        f"---\nid: {note_id}\nauthor: {source}\ntimestamp: {now.isoformat()}\n---\n\n{content}\n",
        encoding="utf-8",
    )

    if ctx.obj.get("json"):
        print_json(row)
    else:
        print_success(f"Note {note_id} added to {experiment_id}")
        err.print(f"  [sonde.muted]\u2192 {local_file.relative_to(sonde_dir.parent)}[/]")
