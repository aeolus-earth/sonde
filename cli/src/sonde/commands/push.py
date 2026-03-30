"""Push command — sync local .sonde/ files to Supabase."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import click
import yaml
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from sonde.auth import get_current_user, resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import directions as dir_db
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import notes as notes_db
from sonde.db import questions as q_db
from sonde.db.activity import log_activity
from sonde.git import detect_git_context
from sonde.local import extract_finding_text, find_sonde_dir, parse_markdown, resolve_record_path
from sonde.models.direction import DirectionCreate
from sonde.models.experiment import ExperimentCreate
from sonde.models.finding import FindingCreate
from sonde.models.question import QuestionCreate
from sonde.output import err, print_error, print_json, print_nudge, print_success

_SKIP = {".DS_Store", "__pycache__"}


@dataclass
class ArtifactUploadStats:
    """Summarize artifact uploads for one experiment directory."""

    total: int = 0
    uploaded: int = 0
    skipped: int = 0
    failed: int = 0


@click.group(invoke_without_command=True)
@pass_output_options
@click.pass_context
def push(ctx: click.Context) -> None:
    """Push local .sonde/ changes to Supabase.

    \b
    Examples:
      sonde push
      sonde push experiment EXP-0002
      sonde push finding FIND-001
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(push_all)


@push.command("all")
@pass_output_options
@click.pass_context
def push_all(ctx: click.Context) -> None:
    """Push all local core records."""
    counts = {
        "experiments": _push_directory("experiments"),
        "findings": _push_directory("findings"),
        "questions": _push_directory("questions"),
        "directions": _push_directory("directions"),
    }
    if ctx.obj.get("json"):
        print_json(counts)
    else:
        print_success(
            "Pushed local notebook",
            details=[
                f"Experiments: {counts['experiments']}",
                f"Findings: {counts['findings']}",
                f"Questions: {counts['questions']}",
                f"Directions: {counts['directions']}",
            ],
        )


@push.command("experiment")
@click.argument("name")
@pass_output_options
@click.pass_context
def push_experiment(ctx: click.Context, name: str) -> None:
    """Push one experiment file and its local directory."""
    result = _push_one("experiments", name)
    if ctx.obj.get("json"):
        print_json(result)
    else:
        print_success(f"{result['action'].title()} {result['id']}")
        _print_experiment_push_guidance(result)


@push.command("experiments")
@pass_output_options
@click.pass_context
def push_experiments(ctx: click.Context) -> None:
    """Push all experiments."""
    count = _push_directory("experiments")
    if ctx.obj.get("json"):
        print_json({"experiments": count})
    else:
        print_success(f"Pushed {count} experiment(s)")


@push.command("finding")
@click.argument("name")
@pass_output_options
@click.pass_context
def push_finding(ctx: click.Context, name: str) -> None:
    """Push one finding."""
    result = _push_one("findings", name)
    if ctx.obj.get("json"):
        print_json(result)
    else:
        print_success(f"{result['action'].title()} {result['id']}")


@push.command("findings")
@pass_output_options
@click.pass_context
def push_findings(ctx: click.Context) -> None:
    """Push all findings."""
    count = _push_directory("findings")
    if ctx.obj.get("json"):
        print_json({"findings": count})
    else:
        print_success(f"Pushed {count} finding(s)")


@push.command("question")
@click.argument("name")
@pass_output_options
@click.pass_context
def push_question(ctx: click.Context, name: str) -> None:
    """Push one question."""
    result = _push_one("questions", name)
    if ctx.obj.get("json"):
        print_json(result)
    else:
        print_success(f"{result['action'].title()} {result['id']}")


@push.command("questions")
@pass_output_options
@click.pass_context
def push_questions(ctx: click.Context) -> None:
    """Push all questions."""
    count = _push_directory("questions")
    if ctx.obj.get("json"):
        print_json({"questions": count})
    else:
        print_success(f"Pushed {count} question(s)")


@push.command("direction")
@click.argument("name")
@pass_output_options
@click.pass_context
def push_direction(ctx: click.Context, name: str) -> None:
    """Push one direction."""
    result = _push_one("directions", name)
    if ctx.obj.get("json"):
        print_json(result)
    else:
        print_success(f"{result['action'].title()} {result['id']}")


@push.command("directions")
@pass_output_options
@click.pass_context
def push_directions(ctx: click.Context) -> None:
    """Push all directions."""
    count = _push_directory("directions")
    if ctx.obj.get("json"):
        print_json({"directions": count})
    else:
        print_success(f"Pushed {count} direction(s)")


def _push_directory(category: str) -> int:
    sonde_dir = find_sonde_dir()
    directory = sonde_dir / category
    if not directory.exists():
        return 0

    count = 0
    for filepath in sorted(directory.glob("*.md")):
        _push_file(category, filepath)
        count += 1
    return count


def _push_one(category: str, name: str) -> dict[str, Any]:
    sonde_dir = find_sonde_dir()
    try:
        filepath = _find_file(sonde_dir / category, name)
    except ValueError:
        print_error(
            f"Invalid local record path: {name}",
            "Record names must stay within .sonde/ and must not be absolute paths.",
            "Use the record ID or local filename stem.",
        )
        raise SystemExit(2) from None
    if not filepath:
        print_error(
            f"File not found: {name}",
            f"No .md file matching '{name}' in .sonde/{category}/",
            f"Create one first: sonde {category[:-1]} new",
        )
        raise SystemExit(1)
    return _push_file(category, filepath)


def _push_file(category: str, filepath: Path) -> dict[str, Any]:
    frontmatter, body = parse_markdown(filepath.read_text(encoding="utf-8"))
    if category == "experiments":
        result = _upsert_experiment(frontmatter, body, filepath)
    elif category == "findings":
        result = _upsert_finding(frontmatter, body, filepath)
    elif category == "questions":
        result = _upsert_question(frontmatter, body, filepath)
    elif category == "directions":
        result = _upsert_direction(frontmatter, body, filepath)
    else:
        raise ValueError(f"Unsupported category: {category}")

    log_activity(result["id"], result["record_type"], result["action"])
    return result


def _find_file(directory: Path, name: str) -> Path | None:
    return resolve_record_path(directory.parent, directory.name, name)


def _rename_local_record(filepath: Path, new_id: str) -> None:
    new_path = filepath.parent / f"{new_id}.md"
    if filepath == new_path:
        return

    frontmatter, body = parse_markdown(filepath.read_text(encoding="utf-8"))
    frontmatter["id"] = new_id
    content = f"---\n{yaml.dump(frontmatter, sort_keys=False).rstrip()}\n---\n\n{body}"
    new_path.write_text(content, encoding="utf-8")
    filepath.unlink()

    old_dir = filepath.parent / filepath.stem
    new_dir = filepath.parent / new_id
    if old_dir.is_dir() and not new_dir.exists():
        old_dir.rename(new_dir)


def _print_experiment_push_guidance(result: dict[str, Any]) -> None:
    exp_id = str(result["id"])
    sync = result.get("_sync") or {}
    artifact_sync = sync.get("artifacts") or {}
    artifact_total = int(artifact_sync.get("total") or 0)
    artifact_uploaded = int(artifact_sync.get("uploaded") or 0)
    artifact_skipped = int(artifact_sync.get("skipped") or 0)

    if artifact_total == 0:
        print_nudge(
            f"No local result files were found. Stage outputs under "
            f".sonde/experiments/{exp_id}/results/ before the next push.",
            f"mkdir -p .sonde/experiments/{exp_id}/results",
        )
        return

    exp = exp_db.get(exp_id)
    if (
        exp
        and exp.status in ("open", "running")
        and (artifact_uploaded > 0 or artifact_skipped > 0)
    ):
        print_nudge(
            "Artifacts are synced. If this run is done, record the takeaway and close it.",
            f'sonde close {exp_id} --finding "..."',
        )


def _resolve_program(frontmatter: dict[str, Any]) -> str:
    settings = get_settings()
    program = frontmatter.get("program") or settings.program
    if not program:
        raise click.ClickException("No program in frontmatter or .aeolus.yaml.")
    return str(program)


def _resolve_source(frontmatter: dict[str, Any]) -> str:
    settings = get_settings()
    user = get_current_user()
    return str(frontmatter.get("source") or settings.source or resolve_source(user))


def _extract_heading(body: str, fallback: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def _extract_context(body: str) -> str | None:
    lines = body.splitlines()
    filtered = [line for line in lines if not line.startswith("# ")]
    text = "\n".join(filtered).strip()
    return text or None


def _upsert_experiment(frontmatter: dict[str, Any], body: str, filepath: Path) -> dict[str, Any]:
    program = _resolve_program(frontmatter)
    source = _resolve_source(frontmatter)
    git_ctx = detect_git_context()

    payload: dict[str, Any] = {
        "program": program,
        "status": frontmatter.get("status", "open"),
        "source": source,
        "content": body or None,
        "hypothesis": frontmatter.get("hypothesis"),
        "parameters": frontmatter.get("parameters") or {},
        "results": frontmatter.get("results"),
        "finding": frontmatter.get("finding"),
        "metadata": frontmatter.get("metadata") or {},
        "data_sources": frontmatter.get("data_sources") or [],
        "direction_id": frontmatter.get("direction_id"),
        "related": frontmatter.get("related") or [],
        "parent_id": frontmatter.get("parent_id"),
        "branch_type": frontmatter.get("branch_type"),
        "claimed_by": frontmatter.get("claimed_by"),
        "claimed_at": frontmatter.get("claimed_at"),
        "run_at": frontmatter.get("run_at"),
        "tags": frontmatter.get("tags") or [],
        "git_commit": frontmatter.get("git_commit") or (git_ctx.commit if git_ctx else None),
        "git_repo": frontmatter.get("git_repo") or (git_ctx.repo if git_ctx else None),
        "git_branch": frontmatter.get("git_branch") or (git_ctx.branch if git_ctx else None),
        "git_close_commit": frontmatter.get("git_close_commit"),
        "git_close_branch": frontmatter.get("git_close_branch"),
        "git_dirty": frontmatter.get("git_dirty"),
    }

    existing_id = str(frontmatter.get("id", "")).upper()
    if existing_id.startswith("EXP-"):
        exp = exp_db.update(existing_id, payload)
        if not exp:
            raise click.ClickException(f"Failed to update {existing_id}.")
        action = "updated"
        exp_id = exp.id
    else:
        exp = exp_db.create(ExperimentCreate(**payload))
        exp_id = exp.id
        action = "created"
        _rename_local_record(filepath, exp_id)

    exp_dir = filepath.parent / exp_id
    if not exp_dir.exists():
        exp_dir = filepath.parent / filepath.stem
    artifact_stats = _sync_directory(exp_id, exp_dir) if exp_dir.is_dir() else ArtifactUploadStats()
    note_count = _sync_notes(exp_id, exp_dir) if exp_dir.is_dir() else 0
    if artifact_stats.total or note_count:
        err.print(
            f"  [sonde.muted]{exp_id}: uploaded {artifact_stats.uploaded}, "
            f"skipped {artifact_stats.skipped}, failed {artifact_stats.failed}, "
            f"notes {note_count}[/]"
        )
    return {
        "id": exp_id,
        "record_type": "experiment",
        "action": action,
        "_sync": {"artifacts": asdict(artifact_stats), "notes": note_count},
    }


def _upsert_finding(frontmatter: dict[str, Any], body: str, filepath: Path) -> dict[str, Any]:
    program = _resolve_program(frontmatter)
    source = _resolve_source(frontmatter)
    finding_text = frontmatter.get("finding") or extract_finding_text(body) or body.strip()
    topic = frontmatter.get("topic") or _extract_heading(body, filepath.stem.replace("-", " "))

    existing_id = str(frontmatter.get("id", "")).upper()
    if existing_id.startswith("FIND-"):
        finding = find_db.update(
            existing_id,
            {
                "program": program,
                "topic": topic,
                "finding": finding_text,
                "confidence": frontmatter.get("confidence", "medium"),
                "evidence": frontmatter.get("evidence") or [],
                "source": source,
                "supersedes": frontmatter.get("supersedes"),
            },
        )
        if not finding:
            raise click.ClickException(f"Failed to update {existing_id}.")
        return {"id": finding.id, "record_type": "finding", "action": "updated"}

    finding = find_db.create(
        FindingCreate(
            program=program,
            topic=topic,
            finding=finding_text,
            confidence=frontmatter.get("confidence", "medium"),
            evidence=frontmatter.get("evidence") or [],
            source=source,
            supersedes=frontmatter.get("supersedes"),
        )
    )
    _rename_local_record(filepath, finding.id)
    return {"id": finding.id, "record_type": "finding", "action": "created"}


def _upsert_question(frontmatter: dict[str, Any], body: str, filepath: Path) -> dict[str, Any]:
    program = _resolve_program(frontmatter)
    source = _resolve_source(frontmatter)
    question_text = frontmatter.get("question") or _extract_heading(body, filepath.stem)
    context = frontmatter.get("context") or _extract_context(body)

    existing_id = str(frontmatter.get("id", "")).upper()
    if existing_id.startswith("Q-"):
        question = q_db.update(
            existing_id,
            {
                "program": program,
                "question": question_text,
                "context": context,
                "status": frontmatter.get("status", "open"),
                "source": source,
                "raised_by": frontmatter.get("raised_by"),
                "tags": frontmatter.get("tags") or [],
                "promoted_to_type": frontmatter.get("promoted_to_type"),
                "promoted_to_id": frontmatter.get("promoted_to_id"),
            },
        )
        if not question:
            raise click.ClickException(f"Failed to update {existing_id}.")
        return {"id": question.id, "record_type": "question", "action": "updated"}

    question = q_db.create(
        QuestionCreate(
            program=program,
            question=question_text,
            context=context,
            status=frontmatter.get("status", "open"),
            source=source,
            raised_by=frontmatter.get("raised_by"),
            tags=frontmatter.get("tags") or [],
        )
    )
    _rename_local_record(filepath, question.id)
    return {"id": question.id, "record_type": "question", "action": "created"}


def _upsert_direction(frontmatter: dict[str, Any], body: str, filepath: Path) -> dict[str, Any]:
    program = _resolve_program(frontmatter)
    source = _resolve_source(frontmatter)
    title = frontmatter.get("title") or _extract_heading(body, filepath.stem.replace("-", " "))
    question = frontmatter.get("question") or _extract_context(body) or title
    payload = {
        "program": program,
        "title": title,
        "question": question,
        "status": frontmatter.get("status", "active"),
        "source": source,
    }

    existing_id = str(frontmatter.get("id", "")).upper()
    if existing_id.startswith("DIR-"):
        direction = dir_db.update(existing_id, payload)
        if not direction:
            raise click.ClickException(f"Failed to update {existing_id}.")
        return {"id": direction.id, "record_type": "direction", "action": "updated"}

    direction = dir_db.create(DirectionCreate(**payload))
    _rename_local_record(filepath, direction.id)
    return {"id": direction.id, "record_type": "direction", "action": "created"}


def _sync_directory(experiment_id: str, exp_dir: Path) -> ArtifactUploadStats:
    from sonde.db.artifacts import compute_checksum, find_by_path, upload_file

    user = get_current_user()
    source = resolve_source(user)
    candidates = [
        path
        for path in sorted(exp_dir.rglob("*"))
        if path.is_file() and not any(part in _SKIP or part == "notes" for part in path.parts)
    ]
    stats = ArtifactUploadStats(total=len(candidates))
    if not candidates:
        return stats

    progress: Progress | None = None
    task_id: int | None = None
    if err.is_terminal:
        progress = Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=err,
        )
        progress.start()
        task_id = progress.add_task(f"Uploading {experiment_id}", total=len(candidates))

    try:
        for path in candidates:
            relative = path.relative_to(exp_dir)
            storage_path = f"{experiment_id}/{relative}"
            existing = find_by_path(experiment_id, storage_path)
            if progress and task_id is not None:
                progress.update(task_id, description=f"Uploading {relative}")

            if existing and existing.get("checksum_sha256"):
                local_checksum = compute_checksum(path)
                if (
                    existing.get("checksum_sha256") == local_checksum
                    and existing.get("size_bytes") == path.stat().st_size
                ):
                    stats.skipped += 1
                    if progress and task_id is not None:
                        progress.advance(task_id)
                    continue

            try:
                upload_file(experiment_id, path, source, storage_subpath=storage_path)
                stats.uploaded += 1
            except Exception as exc:
                stats.failed += 1
                err.print(f"  [sonde.warning]Failed: {relative} ({exc})[/]")
            if progress and task_id is not None:
                progress.advance(task_id)
    finally:
        if progress:
            progress.stop()

    return stats


def _sync_notes(experiment_id: str, exp_dir: Path) -> int:
    notes_dir = exp_dir / "notes"
    if not notes_dir.exists():
        return 0

    existing = notes_db.list_by_experiment(experiment_id)
    existing_keys = {
        ((note.get("content") or "").strip(), note.get("source") or "") for note in existing
    }
    created = 0
    for note_file in sorted(notes_dir.glob("*.md")):
        frontmatter, body = parse_markdown(note_file.read_text(encoding="utf-8"))
        note_source = frontmatter.get("author") or frontmatter.get("source") or _resolve_source({})
        key = (body.strip(), str(note_source))
        if not body.strip() or key in existing_keys:
            continue
        note = notes_db.create(experiment_id, body.strip(), str(note_source))
        existing_keys.add(key)
        created += 1
        log_activity(experiment_id, "experiment", "note_added", {"note_id": note["id"]})
    return created
