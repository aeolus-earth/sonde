"""Pull command — fetch records from Supabase to local .sonde/ directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click

from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.local import (
    ensure_subdir,
    find_sonde_dir,
    render_record,
    write_record,
)
from sonde.output import err, print_error, print_success


@click.group(invoke_without_command=True)
@click.option("--program", "-p", help="Program to pull (default: from .aeolus.yaml)")
@click.pass_context
def pull(ctx: click.Context, program: str | None) -> None:
    """Pull research data to local .sonde/ directory.

    \b
    Examples:
      sonde pull                          # pull all for your program
      sonde pull -p weather-intervention  # specific program
      sonde pull experiments              # just experiments
      sonde pull experiment EXP-0001      # one experiment
    """
    ctx.ensure_object(dict)
    settings = get_settings()
    ctx.obj["pull_program"] = program or settings.program

    # If no subcommand, pull everything
    if ctx.invoked_subcommand is None:
        resolved = ctx.obj["pull_program"]
        if not resolved:
            print_error(
                "No program specified",
                "Specify a program to pull.",
                "Use --program <name> or set 'program' in .aeolus.yaml",
            )
            raise SystemExit(2)
        _pull_all(resolved, ctx.obj.get("json", False))


@pull.command("experiments")
@click.pass_context
def pull_experiments(ctx: click.Context) -> None:
    """Pull all experiments to .sonde/experiments/.

    \b
    Examples:
      sonde pull experiments
    """
    sonde_dir = find_sonde_dir()
    program = ctx.obj.get("pull_program")
    client = get_client()

    query = client.table("experiments").select("*").order("created_at", desc=True)
    if program:
        query = query.eq("program", program)

    data = rows(query.execute().data)
    for record in data:
        md = render_record(record)
        write_record(sonde_dir, "experiments", record["id"], md)
        ensure_subdir(sonde_dir, f"experiments/{record['id']}")

    print_success(f"Pulled {len(data)} experiment(s)")


@pull.command("experiment")
@click.argument("experiment_id")
@click.pass_context
def pull_experiment(ctx: click.Context, experiment_id: str) -> None:
    """Pull a single experiment and its artifacts.

    \b
    Examples:
      sonde pull experiment EXP-0001
    """
    sonde_dir = find_sonde_dir()
    client = get_client()

    result = client.table("experiments").select("*").eq("id", experiment_id.upper()).execute()
    data = rows(result.data)
    if not data:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID in the database.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    record = data[0]
    md = render_record(record)
    path = write_record(sonde_dir, "experiments", record["id"], md)

    # Create experiment subdirectory for artifacts/notes
    ensure_subdir(sonde_dir, f"experiments/{record['id']}")

    # Pull artifacts if any
    art_result = client.table("artifacts").select("*").eq("experiment_id", record["id"]).execute()
    artifacts = rows(art_result.data)
    if artifacts:
        _download_artifacts(client, sonde_dir, record["id"], artifacts)

    # Pull notes if any
    try:
        note_result = (
            client.table("experiment_notes")
            .select("*")
            .eq("experiment_id", record["id"])
            .order("created_at")
            .execute()
        )
        notes = rows(note_result.data)
        if notes:
            _write_notes(sonde_dir, record["id"], notes)
    except Exception:
        pass  # Notes table may not exist yet

    print_success(f"Pulled {record['id']} → {path.relative_to(sonde_dir.parent)}")


@pull.command("findings")
@click.pass_context
def pull_findings(ctx: click.Context) -> None:
    """Pull all findings to .sonde/findings/.

    \b
    Examples:
      sonde pull findings
    """
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    client = get_client()

    query = client.table("findings").select("*").order("created_at", desc=True)
    if program:
        query = query.eq("program", program)

    data = rows(query.execute().data)
    for record in data:
        md = render_record(record)
        write_record(sonde_dir, "findings", record["id"], md)

    print_success(f"Pulled {len(data)} finding(s)")


@pull.command("questions")
@click.pass_context
def pull_questions(ctx: click.Context) -> None:
    """Pull all questions to .sonde/questions/.

    \b
    Examples:
      sonde pull questions
    """
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    client = get_client()

    query = client.table("questions").select("*").order("created_at", desc=True)
    if program:
        query = query.eq("program", program)

    data = rows(query.execute().data)
    for record in data:
        md = render_record(record)
        write_record(sonde_dir, "questions", record["id"], md)

    print_success(f"Pulled {len(data)} question(s)")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _pull_all(program: str, use_json: bool) -> None:
    """Pull experiments, findings, and questions for a program."""
    sonde_dir = find_sonde_dir()
    client = get_client()

    if not use_json:
        err.print(f"[sonde.muted]Pulling {program}...[/]")

    # Experiments
    exp_data = rows(
        client.table("experiments")
        .select("*")
        .eq("program", program)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    for record in exp_data:
        md = render_record(record)
        write_record(sonde_dir, "experiments", record["id"], md)
        ensure_subdir(sonde_dir, f"experiments/{record['id']}")

    # Findings
    find_data = rows(
        client.table("findings")
        .select("*")
        .eq("program", program)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    for record in find_data:
        md = render_record(record)
        write_record(sonde_dir, "findings", record["id"], md)

    # Questions
    q_data = rows(
        client.table("questions")
        .select("*")
        .eq("program", program)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    for record in q_data:
        md = render_record(record)
        write_record(sonde_dir, "questions", record["id"], md)

    print_success(
        f"Pulled {len(exp_data)} experiment(s), "
        f"{len(find_data)} finding(s), "
        f"{len(q_data)} question(s)"
    )
    err.print("  [sonde.muted]→ .sonde/[/]")


def _download_artifacts(
    client: Any,
    sonde_dir: Path,
    experiment_id: str,
    artifacts: list[dict[str, Any]],
) -> None:
    """Download artifact files from Supabase Storage."""
    for art in artifacts:
        storage_path = art.get("storage_path", "")
        if not storage_path:
            continue

        filename = art.get("filename", Path(storage_path).name)
        local_path = sonde_dir / "experiments" / experiment_id / filename

        try:
            data = client.storage.from_("artifacts").download(storage_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(data)
        except Exception:
            pass  # Skip failed downloads silently


def _write_notes(
    sonde_dir: Path,
    experiment_id: str,
    notes: list[dict[str, Any]],
) -> None:
    """Write experiment notes to local directory."""
    notes_dir = ensure_subdir(sonde_dir, f"experiments/{experiment_id}/notes")
    for note in notes:
        timestamp = note.get("created_at", "")[:19].replace(":", "-")
        filename = f"{timestamp}.md"
        content = (
            f"---\nauthor: {note.get('source', 'unknown')}\n"
            f"timestamp: {note.get('created_at', '')}\n---\n\n"
            f"{note.get('content', '')}\n"
        )
        (notes_dir / filename).write_text(content, encoding="utf-8")
