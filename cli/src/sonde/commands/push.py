"""Push command — sync local .sonde/ files to Supabase."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import click
import yaml

from sonde.artifact_sync import (
    SyncCandidate,
    SyncJournal,
    SyncProgress,
    build_fingerprint,
    build_plan,
)
from sonde.auth import get_current_user, resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import directions as dir_db
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import notes as notes_db
from sonde.db import program_takeaways as takeaways_db
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
    text_total: int = 0
    media_total: int = 0
    total_bytes: int = 0
    uploaded: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    oversized: int = 0
    transferred_bytes: int = 0
    elapsed_seconds: float = 0.0
    plan: dict[str, Any] = field(default_factory=dict)
    resume: dict[str, Any] = field(default_factory=dict)
    next_steps: list[str] = field(default_factory=list)


_DRY_RUN_CATEGORIES = ("experiments", "findings", "questions", "directions")


def _dry_run_report(ctx: click.Context) -> None:
    """Scan .sonde/ and report what would be pushed, without pushing."""
    try:
        sonde_dir = find_sonde_dir()
    except SystemExit:
        print_error(
            "No .sonde/ directory found",
            "There is nothing to push.",
            "Run sonde init to create a local notebook.",
        )
        raise SystemExit(1) from None

    counts: dict[str, int] = {}
    for category in _DRY_RUN_CATEGORIES:
        cat_dir = sonde_dir / category
        if cat_dir.is_dir():
            counts[category] = len(list(cat_dir.glob("*.md")))
        else:
            counts[category] = 0

    takeaways_exists = (sonde_dir / "takeaways.md").exists()

    if ctx.obj.get("json"):
        print_json({
            "dry_run": True,
            "experiments": counts["experiments"],
            "findings": counts["findings"],
            "questions": counts["questions"],
            "directions": counts["directions"],
            "takeaways": takeaways_exists,
        })
    else:
        labels = []
        for category in _DRY_RUN_CATEGORIES:
            singular = category.rstrip("s")
            n = counts[category]
            labels.append(f"{n} {singular}(s)" if n != 1 else f"1 {singular}")
        takeaways_label = "yes" if takeaways_exists else "no"
        err.print(f"Would push: {', '.join(labels)}, takeaways: {takeaways_label}")


@click.group(invoke_without_command=True)
@click.option("--dry-run", is_flag=True, help="Show what would be pushed without pushing")
@pass_output_options
@click.pass_context
def push(ctx: click.Context, dry_run: bool) -> None:
    """Push local .sonde/ changes to Supabase.

    \b
    Examples:
      sonde push
      sonde push --dry-run
      sonde push experiment EXP-0002
      sonde push finding FIND-001
    """
    if dry_run:
        _dry_run_report(ctx)
        return
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
    settings = get_settings()
    program = settings.program
    sonde_dir = find_sonde_dir()
    takeaways_synced = False
    project_takeaways_synced = 0
    if program:
        body = takeaways_db.read_takeaways_file(sonde_dir)
        if body:
            takeaways_db.upsert(program, body)
            takeaways_synced = True

    # Sync project takeaways (best-effort — table may not exist yet)
    try:
        from sonde.db import project_takeaways as ptw_db

        projects_dir = sonde_dir / "projects"
        if projects_dir.is_dir():
            for proj_dir in projects_dir.iterdir():
                if proj_dir.is_dir() and proj_dir.name.startswith("PROJ-"):
                    body = ptw_db.read_takeaways_file(sonde_dir, proj_dir.name)
                    if body:
                        ptw_db.upsert(proj_dir.name, body)
                        project_takeaways_synced += 1
    except (Exception, SystemExit):
        pass

    # Sync direction and project notes (best-effort)
    notes_synced = 0
    try:
        for subdir_name, record_type, prefix in [
            ("directions", "direction", "DIR-"),
            ("projects", "project", "PROJ-"),
        ]:
            parent_dir = sonde_dir / subdir_name
            if parent_dir.is_dir():
                for record_dir in parent_dir.iterdir():
                    if record_dir.is_dir() and record_dir.name.startswith(prefix):
                        notes_synced += _sync_record_notes(
                            record_type, record_dir.name, record_dir / "notes"
                        )
    except (Exception, SystemExit):
        pass

    if ctx.obj.get("json"):
        print_json({
            **counts,
            "takeaways_synced": takeaways_synced,
            "project_takeaways_synced": project_takeaways_synced,
            "notes_synced": notes_synced,
        })
    else:
        details = [
            f"Experiments: {counts['experiments']}",
            f"Findings: {counts['findings']}",
            f"Questions: {counts['questions']}",
            f"Directions: {counts['directions']}",
        ]
        if takeaways_synced:
            details.append("Takeaways: synced")
        if project_takeaways_synced:
            details.append(f"Project takeaways: {project_takeaways_synced}")
        if notes_synced:
            details.append(f"Direction/project notes: {notes_synced}")
        print_success("Pushed local notebook", details=details)


@push.command("experiment")
@click.argument("name")
@pass_output_options
@click.pass_context
def push_experiment(ctx: click.Context, name: str) -> None:
    """Push one experiment file and its local directory."""
    result = _push_one("experiments", name)
    sync = result.get("_sync", {}).get("artifacts", {})
    has_errors = int(sync.get("failed") or 0) > 0 or int(sync.get("oversized") or 0) > 0
    if ctx.obj.get("json"):
        print_json(result)
    else:
        if has_errors:
            print_error(
                f"Artifact sync was only partially successful for {result['id']}",
                "One or more artifact uploads failed or exceeded the Supabase limit.",
                "Fix the reported paths or use the guided large-file fallback, then retry.",
            )
        else:
            print_success(f"{result['action'].title()} {result['id']}")
            _print_experiment_push_guidance(result)
    if has_errors:
        raise SystemExit(1)


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


def _push_directory(category: str, *, use_json: bool | None = None) -> int:
    if use_json is None:
        ctx = click.get_current_context(silent=True)
        use_json = bool(ctx and ctx.obj and ctx.obj.get("json"))
    sonde_dir = find_sonde_dir()
    directory = sonde_dir / category
    if not directory.exists():
        return 0

    count = 0
    for filepath in sorted(directory.glob("*.md")):
        _push_file(category, filepath, use_json=use_json)
        count += 1
    return count


def _push_one(category: str, name: str, *, use_json: bool | None = None) -> dict[str, Any]:
    if use_json is None:
        ctx = click.get_current_context(silent=True)
        use_json = bool(ctx and ctx.obj and ctx.obj.get("json"))
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
    return _push_file(category, filepath, use_json=use_json)


def _push_file(category: str, filepath: Path, *, use_json: bool | None = None) -> dict[str, Any]:
    if use_json is None:
        ctx = click.get_current_context(silent=True)
        use_json = bool(ctx and ctx.obj and ctx.obj.get("json"))
    frontmatter, body = parse_markdown(filepath.read_text(encoding="utf-8"))
    if category == "experiments":
        result = _upsert_experiment(frontmatter, body, filepath, use_json=use_json)
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
    artifact_updated = int(artifact_sync.get("updated") or 0)
    artifact_skipped = int(artifact_sync.get("skipped") or 0)
    next_steps = [str(step) for step in artifact_sync.get("next_steps") or []]

    if artifact_total == 0:
        print_nudge(
            f"Put files anywhere under .sonde/experiments/{exp_id}/, then push again.",
            f"mkdir -p .sonde/experiments/{exp_id}",
        )
        return

    if next_steps:
        err.print("\n[sonde.heading]Suggested next[/]")
        for command in next_steps[:3]:
            err.print(f"  {command}")
        return

    if artifact_uploaded > 0 or artifact_updated > 0 or artifact_skipped > 0:
        print_nudge(
            "Artifacts are synced. The normal workflow is to keep working under the "
            "experiment tree, then push again.",
            f"sonde show {exp_id}",
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


def _upsert_experiment(
    frontmatter: dict[str, Any],
    body: str,
    filepath: Path,
    *,
    use_json: bool,
) -> dict[str, Any]:
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
    artifact_stats = (
        _sync_directory(exp_id, exp_dir, source=source, use_json=use_json)
        if exp_dir.is_dir()
        else ArtifactUploadStats()
    )
    note_count = _sync_notes(exp_id, exp_dir) if exp_dir.is_dir() else 0
    if (artifact_stats.total or note_count) and not use_json:
        err.print(
            f"  [sonde.muted]{exp_id}: uploaded {artifact_stats.uploaded}, "
            f"updated {artifact_stats.updated}, skipped {artifact_stats.skipped}, "
            f"failed {artifact_stats.failed}, oversized {artifact_stats.oversized}, "
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


def _sync_directory(
    experiment_id: str,
    exp_dir: Path,
    *,
    source: str,
    use_json: bool,
    only_relative_paths: set[str] | None = None,
) -> ArtifactUploadStats:
    from sonde.db.artifacts import (
        MAX_ARTIFACT_SIZE_BYTES,
        ArtifactTooLargeError,
        compute_checksum,
        is_text_artifact,
        list_artifacts,
        upload_file,
    )

    candidates = [
        path
        for path in sorted(exp_dir.rglob("*"))
        if path.is_file() and not any(part in _SKIP or part == "notes" for part in path.parts)
    ]
    if only_relative_paths is not None:
        candidates = [
            path
            for path in candidates
            if path.relative_to(exp_dir).as_posix() in only_relative_paths
        ]

    stats = ArtifactUploadStats(total=len(candidates))
    if not candidates:
        return stats

    existing_rows = {
        str(row.get("storage_path")): row
        for row in list_artifacts(experiment_id)
        if row.get("storage_path")
    }
    planned: list[SyncCandidate] = []
    for path in candidates:
        relative = path.relative_to(exp_dir).as_posix()
        storage_path = f"{experiment_id}/{relative}"
        existing = existing_rows.get(storage_path)
        size_bytes = path.stat().st_size
        kind = "text" if is_text_artifact(path.name) else "media"
        checksum: str | None = None

        if size_bytes > MAX_ARTIFACT_SIZE_BYTES:
            action = "oversized"
        elif existing:
            if existing.get("checksum_sha256") and existing.get("size_bytes") == size_bytes:
                checksum = compute_checksum(path)
                action = "skip" if existing.get("checksum_sha256") == checksum else "update"
            else:
                action = "update"
        else:
            action = "upload"

        fingerprint = build_fingerprint(
            storage_path,
            action,
            size_bytes,
            checksum or path.stat().st_mtime_ns,
        )
        planned.append(
            SyncCandidate(
                key=storage_path,
                label=relative,
                size_bytes=size_bytes,
                kind=kind,
                action=action,
                fingerprint=fingerprint,
                local_path=str(path),
                storage_path=storage_path,
            )
        )

    plan = build_plan(planned)
    journal = SyncJournal(
        find_sonde_dir(),
        operation="push-experiment",
        selector={"kind": "experiment", "experiment_id": experiment_id, "scope": "push"},
        candidates=planned,
    )
    progress = SyncProgress(
        title=f"Syncing {experiment_id}",
        verb="upload",
        plan=plan,
        resume=journal.resume,
        use_json=use_json,
    )
    progress.print_preflight()
    progress.start()

    stats.total = plan.total
    stats.text_total = plan.text
    stats.media_total = plan.media
    stats.total_bytes = plan.total_bytes
    stats.plan = asdict(plan)
    stats.resume = asdict(journal.resume)

    progress_callback = progress.advance_bytes if err.is_terminal and not use_json else None

    try:
        for candidate in planned:
            if candidate.action == "skip":
                stats.skipped += 1
                journal.record(candidate, status="skipped", bytes_transferred=candidate.size_bytes)
                progress.advance_file(bytes_transferred=candidate.size_bytes)
                continue

            if candidate.action == "oversized":
                stats.oversized += 1
                journal.record(candidate, status="oversized", bytes_transferred=0)
                if not use_json:
                    err.print(f"  [sonde.warning]Oversized: {candidate.label}[/]")
                    err.print(f"  [sonde.muted]{_large_artifact_fix()}[/]")
                progress.advance_file(bytes_transferred=0)
                continue

            local_path = Path(candidate.local_path or "")
            progress.set_current(candidate.label)
            try:
                upload_file(
                    local_path,
                    source,
                    experiment_id=experiment_id,
                    storage_subpath=candidate.storage_path,
                    progress_callback=progress_callback,
                )
                if candidate.action == "update":
                    stats.updated += 1
                    status = "updated"
                else:
                    stats.uploaded += 1
                    status = "uploaded"
                stats.transferred_bytes += candidate.size_bytes
                journal.record(candidate, status=status, bytes_transferred=candidate.size_bytes)
                progress.advance_file(
                    bytes_transferred=0 if progress_callback else candidate.size_bytes
                )
            except ArtifactTooLargeError as exc:
                stats.oversized += 1
                journal.record(candidate, status="oversized", bytes_transferred=0)
                if not use_json:
                    err.print(f"  [sonde.warning]Oversized: {candidate.label} ({exc})[/]")
                    err.print(f"  [sonde.muted]{_large_artifact_fix()}[/]")
                progress.advance_file(bytes_transferred=0)
            except Exception as exc:
                stats.failed += 1
                journal.record(candidate, status="failed", bytes_transferred=0)
                if not use_json:
                    err.print(f"  [sonde.warning]Failed: {candidate.label} ({exc})[/]")
                progress.advance_file(bytes_transferred=0)
    finally:
        stats.elapsed_seconds = progress.stop()

    journal.finish(keep=stats.failed > 0 or stats.oversized > 0)
    stats.next_steps = _artifact_sync_next_steps(experiment_id, stats)
    return stats


def _large_artifact_fix() -> str:
    settings = get_settings()
    if settings.s3_bucket:
        prefix = settings.s3_prefix.strip("/")
        location = f"s3://{settings.s3_bucket}/{prefix}" if prefix else f"s3://{settings.s3_bucket}"
        return (
            f"Store the large output under {location} and record that location in the experiment."
        )
    if settings.icechunk_repo:
        return (
            f"Store the large output in the configured Icechunk repo ({settings.icechunk_repo}) "
            "and record that location in the experiment."
        )
    return (
        "Configure .aeolus.yaml with s3.bucket/s3.prefix or icechunk.repo, "
        "then store the large output there instead of Supabase Storage."
    )


def _artifact_sync_next_steps(experiment_id: str, stats: ArtifactUploadStats) -> list[str]:
    if stats.failed or stats.oversized:
        return []
    if stats.total == 0:
        return [f"mkdir -p .sonde/experiments/{experiment_id}"]

    exp = exp_db.get(experiment_id)
    if not exp:
        return []

    suggestions: list[str] = []
    if (stats.uploaded or stats.updated) and not exp.finding:
        try:
            related_findings = find_db.find_by_evidence(experiment_id)
        except SystemExit:
            related_findings = []
        if exp.status in ("open", "running"):
            suggestions.append(f'sonde note {experiment_id} "What changed after this sync"')
        elif not related_findings:
            suggestions.append(f'sonde finding extract {experiment_id} --topic "..."')

    from sonde.commands.lifecycle import _suggest_next

    try:
        children = exp_db.get_children(experiment_id)
        siblings = exp_db.get_siblings(experiment_id) if exp.parent_id else []
    except SystemExit:
        children = []
        siblings = []
    for suggestion in _suggest_next(exp, children, siblings):
        suggestions.append(suggestion["command"])

    deduped: list[str] = []
    seen: set[str] = set()
    for command in suggestions:
        if command in seen:
            continue
        seen.add(command)
        deduped.append(command)
    return deduped[:3]


def _sync_notes(experiment_id: str, exp_dir: Path) -> int:
    """Sync experiment notes from local .sonde/ to DB."""
    return _sync_record_notes("experiment", experiment_id, exp_dir / "notes")


def _sync_record_notes(record_type: str, record_id: str, notes_dir: Path) -> int:
    """Sync notes for any record type from a local notes directory to DB."""
    if not notes_dir.exists():
        return 0

    existing = notes_db.list_by_record(record_type, record_id)
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
        note = notes_db.create(record_type, record_id, body.strip(), str(note_source))
        existing_keys.add(key)
        created += 1
        log_activity(record_id, record_type, "note_added", {"note_id": note["id"]})
    return created
