"""Note command — add notes to experiments, directions, or projects."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import click
from postgrest.exceptions import APIError

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.db import notes as db
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.note_utils import (
    CHECKPOINT_STATUSES,
    build_checkpoint,
    build_checkpoint_body,
    checkpoint_activity_details,
    format_checkpoint_summary,
    render_note_markdown,
)
from sonde.output import err, print_error, print_json, print_nudge, print_success


def _detect_record_type(record_id: str) -> str | None:
    """Detect record type from ID prefix."""
    rid = record_id.upper()
    if rid.startswith("EXP-"):
        return "experiment"
    if rid.startswith("DIR-"):
        return "direction"
    if rid.startswith("PROJ-"):
        return "project"
    return None


def _local_subdir(record_type: str, record_id: str) -> str:
    """Return the local subdirectory for notes storage."""
    return f"{record_type}s/{record_id}/notes"


@click.command()
@click.argument("record_id", required=False, default=None)
@click.argument("content", required=False)
@click.option("--file", "-f", "note_file", type=click.Path(exists=True), help="Note from file")
@click.option("--stdin", "read_stdin", is_flag=True, help="Read note from stdin")
@click.option("--phase", help="Structured checkpoint phase for long-running experiment work")
@click.option(
    "--status",
    "checkpoint_status",
    type=click.Choice(CHECKPOINT_STATUSES),
    help="Structured checkpoint status for long-running experiment work",
)
@click.option("--elapsed", help="Structured checkpoint elapsed time, e.g. 22m or 2h")
@pass_output_options
@click.pass_context
def note(
    ctx: click.Context,
    record_id: str | None,
    content: str | None,
    note_file: str | None,
    read_stdin: bool,
    phase: str | None,
    checkpoint_status: str | None,
    elapsed: str | None,
) -> None:
    """Add a note to an experiment, direction, or project.

    If no record ID is given, uses the focused experiment (sonde focus).
    Accepts EXP-*, DIR-*, or PROJ-* IDs.

    \b
    Examples:
      sonde note EXP-0001 "This might interact with BL heating"
      sonde note DIR-001 "Narrowing scope to mid-latitude only"
      sonde note PROJ-001 "Stakeholder feedback: focus on 48h forecasts"
      sonde note "observation about CCN response"
      sonde note -f observations.md
      cat analysis.md | sonde note EXP-0001 --stdin
      sonde note EXP-0001 --phase compile --status running --elapsed 22m "slow-op alarm fired"
    """
    # Resolve record ID and type
    detected = _detect_record_type(record_id) if record_id else None
    if record_id and detected:
        record_type: str = detected
        record_id = record_id.upper()
    else:
        # If record_id looks like content (no prefix match), shift it to content
        if record_id and not detected:
            if content:
                print_error(
                    "Ambiguous arguments",
                    f"'{record_id}' doesn't match a known record prefix (EXP-*, DIR-*, PROJ-*).",
                    'Usage: sonde note <RECORD-ID> "content"\n'
                    '   or: sonde note "content"  (uses focused experiment)',
                )
                raise SystemExit(2)
            content = record_id
            record_id = None

        # Fall back to focused experiment
        from sonde.commands._helpers import resolve_experiment_id

        record_id = resolve_experiment_id(record_id)
        record_type = "experiment"

    if note_file:
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
    checkpoint = build_checkpoint(
        phase=phase,
        status=checkpoint_status,
        elapsed=elapsed,
        note=content,
    )

    if checkpoint and record_type != "experiment":
        print_error(
            "Checkpoint notes are experiment-only",
            "Structured phase/status/elapsed fields are only supported for experiments.",
            f'Use: sonde note {record_id} "your note here"',
        )
        raise SystemExit(2)

    if not content and checkpoint is None:
        print_error(
            "No note content",
            "Provide a note as an argument, --file, or --stdin.",
            'sonde note EXP-0001 "your note here"',
        )
        raise SystemExit(2)

    # Verify record exists
    if not db.record_exists(record_type, record_id):
        hints = {
            "experiment": "List experiments: sonde list",
            "direction": "List directions: sonde direction list",
            "project": "List projects: sonde project list",
        }
        hint = hints.get(record_type, "Check the record ID and try again.")
        print_error(
            f"{record_type.title()} {record_id} not found",
            f"Cannot add a note to a nonexistent {record_type}.",
            hint,
        )
        raise SystemExit(1)

    source = resolve_source()
    now = datetime.now(UTC)
    note_body = build_checkpoint_body(checkpoint) if checkpoint else str(content).strip()
    sonde_dir = find_sonde_dir()
    notes_dir = ensure_subdir(sonde_dir, _local_subdir(record_type, record_id))
    timestamp = now.strftime("%Y-%m-%dT%H-%M-%S")
    local_file = notes_dir / f"{timestamp}.md"

    try:
        row = db.create(record_type, record_id, note_body, source)
    except APIError as exc:
        from sonde.db import classify_api_error

        local_file.write_text(
            render_note_markdown(
                source=source,
                timestamp=now.isoformat(),
                body=note_body,
                pending_sync=True,
                checkpoint=checkpoint,
            ),
            encoding="utf-8",
        )
        what, why, fix = classify_api_error(exc, table="notes", action="save notes")
        print_error(what, why, fix)
        err.print(
            f"  [sonde.muted]Saved local note for later sync -> "
            f"{local_file.relative_to(sonde_dir.parent)}[/]"
        )
        err.print(f"  [sonde.muted]Sync later: sonde push {record_type} {record_id}[/]")
        raise SystemExit(1) from None

    note_id = row["id"]

    # Log activity
    from sonde.db.activity import log_activity

    log_activity(
        record_id,
        record_type,
        "note_added",
        checkpoint_activity_details(note_id=note_id, checkpoint=checkpoint),
    )

    local_file.write_text(
        render_note_markdown(
            source=source,
            timestamp=now.isoformat(),
            body=note_body,
            note_id=note_id,
            checkpoint=checkpoint,
        ),
        encoding="utf-8",
    )

    if ctx.obj.get("json"):
        print_json(row)
    else:
        details = None
        if checkpoint:
            details = [f"Checkpoint: {format_checkpoint_summary(checkpoint, include_note=True)}"]
        print_success(
            f"Note {note_id} added to {record_id}",
            details=details,
            record_id=record_id,
        )
        err.print(f"  [sonde.muted]\u2192 {local_file.relative_to(sonde_dir.parent)}[/]")

        # Research hygiene nudge for experiments with accumulating notes
        if record_type == "experiment":
            notes_count = len(db.list_by_record("experiment", record_id))
            from sonde.db import experiments as exp_db

            exp = exp_db.get(record_id)
            if checkpoint and exp and exp.status == "running":
                print_nudge(
                    "Keep long-running work legible with short checkpoint notes "
                    "as the run evolves:",
                    f'sonde note {record_id} --phase "{phase or "compile"}" '
                    f'--status running --elapsed "..." "what changed"',
                )
            elif notes_count >= 3 and exp and not exp.finding:
                print_nudge(
                    f"This experiment has {notes_count} notes but no finding. "
                    "Distill the key result:",
                    f'sonde finding extract {record_id} --topic "CCN sensitivity"',
                )
