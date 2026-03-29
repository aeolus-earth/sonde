"""Note command — add notes to experiments."""

from __future__ import annotations

from datetime import UTC, datetime

import click

from sonde.auth import get_current_user
from sonde.db import rows
from sonde.db.client import get_client
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
    client = get_client()
    exp_result = client.table("experiments").select("id").eq("id", experiment_id).execute()
    if not rows(exp_result.data):
        print_error(
            f"Experiment {experiment_id} not found",
            "Cannot add a note to a nonexistent experiment.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    user = get_current_user()
    source = f"human/{user.email.split('@')[0]}" if user and not user.is_agent else "agent"
    now = datetime.now(UTC)

    # Generate note ID
    id_result = (
        client.table("experiment_notes")
        .select("id")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    existing = rows(id_result.data)
    if existing:
        last_num = int(existing[0]["id"].split("-")[1])
        note_id = f"NOTE-{last_num + 1:04d}"
    else:
        note_id = "NOTE-0001"

    # Insert into database
    row = {
        "id": note_id,
        "experiment_id": experiment_id,
        "content": content,
        "source": source,
    }

    try:
        result = client.table("experiment_notes").insert(row).execute()
    except Exception as e:
        # Table may not exist yet — graceful fallback
        print_error(
            "Failed to save note",
            str(e),
            "The experiment_notes table may need to be created. Run migrations.",
        )
        raise SystemExit(1) from None

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
        print_json(rows(result.data)[0] if rows(result.data) else row)
    else:
        print_success(f"Note {note_id} added to {experiment_id}")
        err.print(f"  [sonde.muted]→ {local_file.relative_to(sonde_dir.parent)}[/]")
