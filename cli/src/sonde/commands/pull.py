"""Pull command — fetch records from Supabase to local .sonde/ directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click
from postgrest.exceptions import APIError

from sonde.config import get_settings
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import notes as notes_db
from sonde.db import questions as q_db
from sonde.db.artifacts import list_artifacts
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

    experiments = exp_db.list_for_brief(program=program)
    for exp in experiments:
        md = render_record(exp.model_dump(mode="json"))
        write_record(sonde_dir, "experiments", exp.id, md)
        ensure_subdir(sonde_dir, f"experiments/{exp.id}")

    print_success(f"Pulled {len(experiments)} experiment(s)")


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

    exp = exp_db.get(experiment_id.upper())
    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID in the database.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    record = exp.model_dump(mode="json")
    md = render_record(record)
    path = write_record(sonde_dir, "experiments", exp.id, md)

    # Create experiment subdirectory for artifacts/notes
    ensure_subdir(sonde_dir, f"experiments/{exp.id}")

    # Pull artifacts if any
    artifacts = list_artifacts(exp.id)
    if artifacts:
        _download_artifacts(sonde_dir, exp.id, artifacts)

    # Pull notes if any
    try:
        notes = notes_db.list_by_experiment(exp.id)
        if notes:
            _write_notes(sonde_dir, exp.id, notes)
    except APIError as exc:
        err.print(f"  [sonde.warning]Could not pull notes: {exc}[/]")

    print_success(f"Pulled {exp.id} → {path.relative_to(sonde_dir.parent)}")


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

    findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    for f in findings:
        md = render_record(f.model_dump(mode="json"))
        write_record(sonde_dir, "findings", f.id, md)

    print_success(f"Pulled {len(findings)} finding(s)")


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

    questions = q_db.list_questions(program=program, include_all=True, limit=10000)
    for q in questions:
        md = render_record(q.model_dump(mode="json"))
        write_record(sonde_dir, "questions", q.id, md)

    print_success(f"Pulled {len(questions)} question(s)")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _pull_all(program: str, use_json: bool) -> None:
    """Pull experiments, findings, and questions for a program."""
    sonde_dir = find_sonde_dir()

    if not use_json:
        err.print(f"[sonde.muted]Pulling {program}...[/]")

    # Experiments
    experiments = exp_db.list_for_brief(program=program)
    for exp in experiments:
        md = render_record(exp.model_dump(mode="json"))
        write_record(sonde_dir, "experiments", exp.id, md)
        ensure_subdir(sonde_dir, f"experiments/{exp.id}")

    # Findings
    findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    for f in findings:
        md = render_record(f.model_dump(mode="json"))
        write_record(sonde_dir, "findings", f.id, md)

    # Questions
    questions = q_db.list_questions(program=program, include_all=True, limit=10000)
    for q in questions:
        md = render_record(q.model_dump(mode="json"))
        write_record(sonde_dir, "questions", q.id, md)

    print_success(
        f"Pulled {len(experiments)} experiment(s), "
        f"{len(findings)} finding(s), "
        f"{len(questions)} question(s)"
    )
    err.print("  [sonde.muted]→ .sonde/[/]")


def _download_artifacts(
    sonde_dir: Path,
    experiment_id: str,
    artifacts: list[dict[str, Any]],
) -> None:
    """Download artifact files from Supabase Storage, preserving directory structure."""
    from sonde.db.client import get_client

    client = get_client()
    exp_dir = sonde_dir / "experiments" / experiment_id

    for art in artifacts:
        storage_path = art.get("storage_path", "")
        if not storage_path:
            continue

        if storage_path.startswith(f"{experiment_id}/"):
            relative = storage_path[len(experiment_id) + 1 :]
        else:
            relative = art.get("filename", Path(storage_path).name)

        from sonde.db.validate import contained_path

        try:
            local_path = contained_path(exp_dir, relative)
        except ValueError:
            err.print(f"  [sonde.warning]Skipping artifact with unsafe path: {storage_path}[/]")
            continue

        if local_path.exists():
            size = art.get("size_bytes")
            if size and local_path.stat().st_size == size:
                continue

        try:
            data = client.storage.from_("artifacts").download(storage_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(data)
        except Exception as exc:
            err.print(f"  [sonde.warning]Failed to download {storage_path}: {exc}[/]")


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
