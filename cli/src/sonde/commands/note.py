"""Note command — add notes to experiments."""

from __future__ import annotations

from datetime import UTC, datetime

import click
from postgrest.exceptions import APIError

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.db import notes as db
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.output import err, print_error, print_json, print_nudge, print_success


@click.command()
@click.argument("experiment_id", required=False, default=None)
@click.argument("content", required=False)
@click.option("--file", "-f", "note_file", type=click.Path(exists=True), help="Note from file")
@click.option("--stdin", "read_stdin", is_flag=True, help="Read note from stdin")
@pass_output_options
@click.pass_context
def note(
    ctx: click.Context,
    experiment_id: str | None,
    content: str | None,
    note_file: str | None,
    read_stdin: bool,
) -> None:
    """Add a note to an experiment.

    If no experiment ID is given, uses the focused experiment (sonde focus).

    \b
    Examples:
      sonde note EXP-0001 "This might interact with BL heating"
      sonde note "observation about CCN response"
      sonde note -f observations.md
      cat analysis.md | sonde note EXP-0001 --stdin
    """
    from sonde.commands._helpers import resolve_experiment_id

    experiment_id = resolve_experiment_id(experiment_id)

    if note_file:
        from pathlib import Path

        content = Path(note_file).read_text(encoding="utf-8")
    elif read_stdin:
        import sys

        if sys.stdin.isatty():
            print_error(
                "No input on stdin",
                "Use --stdin with piped input, not interactively.",
                'echo "note" | sonde note EXP-0001 --stdin',
            )
            raise SystemExit(2)
        content = sys.stdin.read().strip()
    elif not content:
        print_error(
            "No note content",
            "Provide a note as an argument, --file, or --stdin.",
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
        from sonde.db import classify_api_error

        what, why, fix = classify_api_error(exc, table="experiment_notes", action="save notes")
        print_error(what, why, fix)
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

        # Research hygiene nudge when notes accumulate without a finding
        from sonde.db import experiments as exp_db
        from sonde.db.notes import list_by_experiment

        notes_count = len(list_by_experiment(experiment_id))
        exp = exp_db.get(experiment_id)
        if notes_count >= 3 and exp and not exp.finding:
            print_nudge(
                f"This experiment has {notes_count} notes but no finding. Distill the key result:",
                f'sonde finding extract {experiment_id} --topic "CCN sensitivity"',
            )
