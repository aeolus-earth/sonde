"""Pull command — fetch records from Supabase to local .sonde/."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import click
from postgrest.exceptions import APIError

from sonde.config import get_settings
from sonde.db import directions as dir_db
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import notes as notes_db
from sonde.db import questions as q_db
from sonde.db.artifacts import list_artifacts
from sonde.local import ensure_subdir, find_sonde_dir, render_record, write_record
from sonde.output import err, print_error, print_json, print_success


@click.group(invoke_without_command=True)
@click.option("--program", "-p", help="Program to pull (default: from .aeolus.yaml)")
@click.pass_context
def pull(ctx: click.Context, program: str | None) -> None:
    """Pull research data to local .sonde/ directory."""
    settings = get_settings()
    ctx.ensure_object(dict)
    ctx.obj["pull_program"] = program or settings.program or None

    if ctx.invoked_subcommand is None:
        _pull_all(ctx)


@pull.command("experiment")
@click.argument("experiment_id")
@click.pass_context
def pull_experiment(ctx: click.Context, experiment_id: str) -> None:
    """Pull a single experiment and its artifacts/notes."""
    sonde_dir = find_sonde_dir()
    exp = exp_db.get(experiment_id.upper())
    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID in the database.",
            "List experiments: sonde experiment list",
        )
        raise SystemExit(1)

    path = _write_record_with_body(sonde_dir, "experiments", exp.id, exp.model_dump(mode="json"))
    ensure_subdir(sonde_dir, f"experiments/{exp.id}")

    artifacts = list_artifacts(exp.id)
    if artifacts:
        _download_artifacts(sonde_dir, exp.id, artifacts)

    try:
        notes = notes_db.list_by_experiment(exp.id)
        if notes:
            _write_notes(sonde_dir, exp.id, notes)
    except APIError as exc:
        err.print(f"  [sonde.warning]Could not pull notes: {exc}[/]")

    if ctx.obj.get("json"):
        print_json(exp.model_dump(mode="json"))
    else:
        print_success(f"Pulled {exp.id} → {path.relative_to(sonde_dir.parent)}")


@pull.command("experiments")
@click.pass_context
def pull_experiments(ctx: click.Context) -> None:
    """Pull all experiments."""
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    experiments = exp_db.list_for_brief(program=program)
    for exp in experiments:
        _write_record_with_body(sonde_dir, "experiments", exp.id, exp.model_dump(mode="json"))
        ensure_subdir(sonde_dir, f"experiments/{exp.id}")
    print_success(f"Pulled {len(experiments)} experiment(s)")


@pull.command("finding")
@click.argument("finding_id")
@click.pass_context
def pull_finding(ctx: click.Context, finding_id: str) -> None:
    """Pull a single finding."""
    sonde_dir = find_sonde_dir()
    finding = find_db.get(finding_id.upper())
    if not finding:
        print_error(
            f"Finding {finding_id} not found",
            "No finding with this ID in the database.",
            "List findings: sonde finding list",
        )
        raise SystemExit(1)

    path = _write_record_with_body(
        sonde_dir, "findings", finding.id, finding.model_dump(mode="json")
    )
    if ctx.obj.get("json"):
        print_json(finding.model_dump(mode="json"))
    else:
        print_success(f"Pulled {finding.id} → {path.relative_to(sonde_dir.parent)}")


@pull.command("findings")
@click.pass_context
def pull_findings(ctx: click.Context) -> None:
    """Pull all findings."""
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    for finding in findings:
        _write_record_with_body(sonde_dir, "findings", finding.id, finding.model_dump(mode="json"))
    print_success(f"Pulled {len(findings)} finding(s)")


@pull.command("question")
@click.argument("question_id")
@click.pass_context
def pull_question(ctx: click.Context, question_id: str) -> None:
    """Pull a single question."""
    sonde_dir = find_sonde_dir()
    question = q_db.get(question_id.upper())
    if not question:
        print_error(
            f"Question {question_id} not found",
            "No question with this ID in the database.",
            "List questions: sonde question list",
        )
        raise SystemExit(1)

    path = _write_record_with_body(
        sonde_dir, "questions", question.id, question.model_dump(mode="json")
    )
    if ctx.obj.get("json"):
        print_json(question.model_dump(mode="json"))
    else:
        print_success(f"Pulled {question.id} → {path.relative_to(sonde_dir.parent)}")


@pull.command("questions")
@click.pass_context
def pull_questions(ctx: click.Context) -> None:
    """Pull all questions."""
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    questions = q_db.list_questions(program=program, include_all=True, limit=10000)
    for question in questions:
        _write_record_with_body(
            sonde_dir, "questions", question.id, question.model_dump(mode="json")
        )
    print_success(f"Pulled {len(questions)} question(s)")


@pull.command("direction")
@click.argument("direction_id")
@click.pass_context
def pull_direction(ctx: click.Context, direction_id: str) -> None:
    """Pull a single direction."""
    sonde_dir = find_sonde_dir()
    direction = dir_db.get(direction_id.upper())
    if not direction:
        print_error(
            f"Direction {direction_id} not found",
            "No direction with this ID in the database.",
            "List directions: sonde direction list",
        )
        raise SystemExit(1)

    path = _write_record_with_body(
        sonde_dir, "directions", direction.id, direction.model_dump(mode="json")
    )
    if ctx.obj.get("json"):
        print_json(direction.model_dump(mode="json"))
    else:
        print_success(f"Pulled {direction.id} → {path.relative_to(sonde_dir.parent)}")


@pull.command("directions")
@click.pass_context
def pull_directions(ctx: click.Context) -> None:
    """Pull all directions."""
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    directions = dir_db.list_directions(program=program, statuses=None, limit=10000)
    for direction in directions:
        _write_record_with_body(
            sonde_dir, "directions", direction.id, direction.model_dump(mode="json")
        )
    print_success(f"Pulled {len(directions)} direction(s)")


def _pull_all(ctx: click.Context) -> None:
    program = ctx.obj.get("pull_program")
    if not program:
        print_error(
            "No program specified",
            "Specify a program to pull.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    sonde_dir = find_sonde_dir()
    experiments = exp_db.list_for_brief(program=program)
    findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    questions = q_db.list_questions(program=program, include_all=True, limit=10000)
    directions = dir_db.list_directions(program=program, statuses=None, limit=10000)

    for exp in experiments:
        _write_record_with_body(sonde_dir, "experiments", exp.id, exp.model_dump(mode="json"))
        ensure_subdir(sonde_dir, f"experiments/{exp.id}")
    for finding in findings:
        _write_record_with_body(sonde_dir, "findings", finding.id, finding.model_dump(mode="json"))
    for question in questions:
        _write_record_with_body(
            sonde_dir, "questions", question.id, question.model_dump(mode="json")
        )
    for direction in directions:
        _write_record_with_body(
            sonde_dir, "directions", direction.id, direction.model_dump(mode="json")
        )

    if ctx.obj.get("json"):
        print_json(
            {
                "experiments": len(experiments),
                "findings": len(findings),
                "questions": len(questions),
                "directions": len(directions),
            }
        )
    else:
        print_success(
            f"Pulled {len(experiments)} experiment(s), "
            f"{len(findings)} finding(s), "
            f"{len(questions)} question(s), "
            f"{len(directions)} direction(s)"
        )
        err.print("  [sonde.muted]→ .sonde/[/]")


def _write_record_with_body(
    sonde_dir: Path,
    category: str,
    record_id: str,
    record: dict[str, Any],
) -> Path:
    return write_record(sonde_dir, category, record_id, render_record(record))


def _download_artifacts(
    sonde_dir: Path,
    experiment_id: str,
    artifacts: list[dict[str, Any]],
) -> None:
    from sonde.db.client import get_client
    from sonde.db.validate import contained_path

    client = get_client()
    exp_dir = sonde_dir / "experiments" / experiment_id

    for artifact in artifacts:
        storage_path = artifact.get("storage_path", "")
        if not storage_path:
            continue
        if storage_path.startswith(f"{experiment_id}/"):
            relative = storage_path[len(experiment_id) + 1 :]
        else:
            relative = artifact.get("filename", Path(storage_path).name)

        try:
            local_path = contained_path(exp_dir, relative)
        except ValueError:
            err.print(f"  [sonde.warning]Skipping artifact with unsafe path: {storage_path}[/]")
            continue

        if local_path.exists():
            size = artifact.get("size_bytes")
            if size and local_path.stat().st_size == size:
                continue

        try:
            data = client.storage.from_("artifacts").download(storage_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(data)
        except Exception as exc:
            err.print(f"  [sonde.warning]Failed to download {storage_path}: {exc}[/]")


def _write_notes(sonde_dir: Path, experiment_id: str, notes: list[dict[str, Any]]) -> None:
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
