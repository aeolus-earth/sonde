"""Pull command — fetch records from Supabase to local .sonde/."""

from __future__ import annotations

import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import click
from postgrest.exceptions import APIError

from sonde.artifact_sync import (
    SyncCandidate,
    SyncJournal,
    SyncProgress,
    build_fingerprint,
    build_plan,
)
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import directions as dir_db
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import notes as notes_db
from sonde.db import program_takeaways as takeaways_db
from sonde.db import questions as q_db
from sonde.db.artifacts import (
    compute_checksum,
    download_file,
    is_text_artifact,
    list_for_experiments,
)
from sonde.local import ensure_subdir, find_sonde_dir, render_record, write_record
from sonde.output import err, print_error, print_json, print_success

ARTIFACT_CHOICES = ("none", "text", "media", "all")


@dataclass
class ArtifactSyncSummary:
    """Summarize artifact sync results."""

    mode: str
    selected: int = 0
    text_total: int = 0
    media_total: int = 0
    downloaded: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    selected_bytes: int = 0
    downloaded_bytes: int = 0
    elapsed_seconds: float = 0.0
    plan: dict[str, Any] | None = None
    resume: dict[str, Any] | None = None
    next_steps: list[str] | None = None


def _artifact_mode_option(default: str | None = None):
    return click.option(
        "--artifacts",
        type=click.Choice(ARTIFACT_CHOICES),
        default=default,
        show_default=default is not None,
        help="Artifact download mode: none, text, media, or all.",
    )


def _experiment_pull_options(fn):
    decorators = [
        click.option(
            "--tree",
            "tree_ids",
            multiple=True,
            help="Pull the full subtree rooted at this experiment ID. Repeatable.",
        ),
        click.option("--status", help="Filter experiments by status."),
        click.option("--tag", "tags", multiple=True, help="Filter experiments by tag. Repeatable."),
        click.option("--direction", help="Filter experiments by direction ID."),
        click.option("--source", help="Filter experiments by source."),
        click.option("--roots", is_flag=True, help="Pull only root experiments."),
        _artifact_mode_option(),
    ]
    for decorator in reversed(decorators):
        fn = decorator(fn)
    return fn


@click.group(invoke_without_command=True)
@click.option("--program", "-p", help="Program to pull (default: from .aeolus.yaml)")
@_artifact_mode_option(default="text")
@pass_output_options
@click.pass_context
def pull(ctx: click.Context, program: str | None, artifacts: str) -> None:
    """Pull research data to local .sonde/ directory.

    \b
    With no subcommand, pulls everything for the program:
      sonde pull -p dart-benchmarking           # pull all record types
      sonde pull -p dart-benchmarking all       # same thing, explicit

    \b
    Or pull specific record types:
      sonde pull experiments                    # experiments for default program
      sonde pull experiment EXP-0154            # single experiment + artifacts
      sonde pull findings                       # findings only
    """
    settings = get_settings()
    ctx.ensure_object(dict)
    ctx.obj["pull_program"] = program or settings.program or None
    ctx.obj["pull_artifacts"] = artifacts

    if ctx.invoked_subcommand is None:
        _pull_all(ctx)


@pull.command("all")
@pass_output_options
@click.pass_context
def pull_all_cmd(ctx: click.Context) -> None:
    """Pull all record types for the program (experiments, findings, questions, directions)."""
    _pull_all(ctx)


@pull.command("experiment")
@click.argument("experiment_id", required=False)
@_experiment_pull_options
@pass_output_options
@click.pass_context
def pull_experiment(
    ctx: click.Context,
    experiment_id: str | None,
    tree_ids: tuple[str, ...],
    status: str | None,
    tags: tuple[str, ...],
    direction: str | None,
    source: str | None,
    roots: bool,
    artifacts: str | None,
) -> None:
    """Pull experiments and their local directories."""
    _run_experiment_pull(
        ctx,
        experiment_id=experiment_id,
        tree_ids=tree_ids,
        status=status,
        tags=tags,
        direction=direction,
        source=source,
        roots=roots,
        artifacts=artifacts,
    )


@pull.command("experiments")
@_experiment_pull_options
@pass_output_options
@click.pass_context
def pull_experiments(
    ctx: click.Context,
    tree_ids: tuple[str, ...],
    status: str | None,
    tags: tuple[str, ...],
    direction: str | None,
    source: str | None,
    roots: bool,
    artifacts: str | None,
) -> None:
    """Pull a working set of experiments."""
    _run_experiment_pull(
        ctx,
        experiment_id=None,
        tree_ids=tree_ids,
        status=status,
        tags=tags,
        direction=direction,
        source=source,
        roots=roots,
        artifacts=artifacts,
    )


@pull.command("finding")
@click.argument("finding_id")
@pass_output_options
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
@pass_output_options
@click.pass_context
def pull_findings(ctx: click.Context) -> None:
    """Pull all findings."""
    program = ctx.obj.get("pull_program")
    sonde_dir = find_sonde_dir()
    findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    for finding in findings:
        _write_record_with_body(sonde_dir, "findings", finding.id, finding.model_dump(mode="json"))
    if ctx.obj.get("json"):
        print_json({"count": len(findings), "ids": [f.id for f in findings]})
        return
    print_success(f"Pulled {len(findings)} finding(s)")


@pull.command("question")
@click.argument("question_id")
@pass_output_options
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
@pass_output_options
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
    if ctx.obj.get("json"):
        print_json({"count": len(questions), "ids": [q.id for q in questions]})
        return
    print_success(f"Pulled {len(questions)} question(s)")


@pull.command("direction")
@click.argument("direction_id")
@pass_output_options
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
@pass_output_options
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
    if ctx.obj.get("json"):
        print_json({"count": len(directions), "ids": [d.id for d in directions]})
        return
    print_success(f"Pulled {len(directions)} direction(s)")


def _run_experiment_pull(
    ctx: click.Context,
    *,
    experiment_id: str | None,
    tree_ids: tuple[str, ...],
    status: str | None,
    tags: tuple[str, ...],
    direction: str | None,
    source: str | None,
    roots: bool,
    artifacts: str | None,
) -> None:
    selector_kind = _selector_kind(
        experiment_id=experiment_id,
        tree_ids=tree_ids,
        status=status,
        tags=tags,
        direction=direction,
        source=source,
        roots=roots,
    )
    program = ctx.obj.get("pull_program")
    mode = _resolve_artifact_mode(ctx, artifacts=artifacts, selector_kind=selector_kind)
    sonde_dir = find_sonde_dir()
    experiments, selector_summary = _select_experiments(
        experiment_id=experiment_id,
        tree_ids=tree_ids,
        status=status,
        tags=tags,
        direction=direction,
        source=source,
        roots=roots,
        program=program,
    )
    sync = _sync_experiments(
        sonde_dir,
        experiments,
        selector=selector_summary,
        artifact_mode=mode,
        use_json=bool(ctx.obj.get("json")),
        follow_up_command=_media_follow_up(selector_summary, program),
    )
    if selector_kind == "single":
        sync.next_steps = _pull_next_steps(experiments[0]["id"], sync)

    if ctx.obj.get("json"):
        if selector_kind == "single":
            payload = dict(experiments[0])
            payload["_sync"] = asdict(sync)
            print_json(payload)
            return
        print_json(
            {
                "experiments": len(experiments),
                "_sync": asdict(sync),
                "selector": selector_summary,
            }
        )
        return

    if selector_kind == "single":
        path = sonde_dir / "experiments" / f"{experiments[0]['id']}.md"
        print_success(f"Pulled {experiments[0]['id']} → {path.relative_to(sonde_dir.parent)}")
    else:
        print_success(f"Pulled {len(experiments)} experiment(s)")
    if sync.mode != "none":
        err.print(
            f"  [sonde.muted]Artifacts: downloaded {sync.downloaded}, "
            f"updated {sync.updated}, skipped {sync.skipped}, failed {sync.failed}[/]"
        )
    if sync.next_steps:
        err.print("\n[sonde.heading]Suggested next[/]")
        for command in sync.next_steps[:3]:
            err.print(f"  {command}")


def _selector_kind(
    *,
    experiment_id: str | None,
    tree_ids: tuple[str, ...],
    status: str | None,
    tags: tuple[str, ...],
    direction: str | None,
    source: str | None,
    roots: bool,
) -> str:
    has_filters = bool(status or tags or direction or source or roots)
    selected_modes = sum(bool(value) for value in (experiment_id, tree_ids, has_filters))
    if selected_modes > 1:
        print_error(
            "Conflicting experiment selectors",
            "Use one selector mode at a time: a single experiment, --tree, or filters.",
            "Split the pull into separate commands.",
        )
        raise SystemExit(2)
    if experiment_id:
        return "single"
    if tree_ids:
        return "tree"
    if has_filters:
        return "filtered"
    return "all"


def _resolve_artifact_mode(
    ctx: click.Context,
    *,
    artifacts: str | None,
    selector_kind: str,
) -> str:
    if artifacts:
        return artifacts
    group_mode = ctx.obj.get("pull_artifacts")
    if selector_kind == "single" and not artifacts:
        return "all"
    return group_mode or "text"


def _select_experiments(
    *,
    experiment_id: str | None,
    tree_ids: tuple[str, ...],
    status: str | None,
    tags: tuple[str, ...],
    direction: str | None,
    source: str | None,
    roots: bool,
    program: str | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if experiment_id:
        exp = exp_db.get(experiment_id.upper())
        if not exp:
            print_error(
                f"Experiment {experiment_id} not found",
                "No experiment with this ID in the database.",
                "List experiments: sonde experiment list",
            )
            raise SystemExit(1)
        return [exp.model_dump(mode="json")], {"kind": "single", "experiment_id": exp.id}

    if tree_ids:
        rows: dict[str, dict[str, Any]] = {}
        for tree_id in tree_ids:
            for row in exp_db.get_subtree(tree_id.upper()):
                rows[row["id"]] = {**row}
        return list(rows.values()), {
            "kind": "tree",
            "tree_ids": [tree_id.upper() for tree_id in tree_ids],
        }

    if not program and not any((status, tags, direction, source, roots)):
        print_error(
            "No program specified",
            "Specify a program to pull when you are not selecting a single experiment or tree.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    experiments = exp_db.list_experiments(
        program=program,
        status=status,
        source=source,
        tags=list(tags) or None,
        direction=direction,
        limit=10000,
        roots=roots,
    )
    return (
        [exp.model_dump(mode="json") for exp in experiments],
        {
            "kind": "filtered" if any((status, tags, direction, source, roots)) else "all",
            "program": program,
            "status": status,
            "tags": list(tags),
            "direction": direction,
            "source": source,
            "roots": roots,
        },
    )


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
    experiments = [exp.model_dump(mode="json") for exp in exp_db.list_for_brief(program=program)]
    findings = find_db.list_findings(program=program, include_superseded=True, limit=10000)
    questions = q_db.list_questions(program=program, include_all=True, limit=10000)
    directions = dir_db.list_directions(program=program, statuses=None, limit=10000)
    sync = _sync_experiments(
        sonde_dir,
        experiments,
        selector={"kind": "program", "program": program},
        artifact_mode=ctx.obj.get("pull_artifacts", "text"),
        use_json=bool(ctx.obj.get("json")),
        follow_up_command=f"sonde pull -p {program} --artifacts media",
    )

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

    tw = takeaways_db.get(program)
    takeaways_db.write_takeaways_file(sonde_dir, tw.body if tw else None)

    # Pull project takeaways (best-effort — table may not exist yet)
    project_takeaways_count = 0
    try:
        from sonde.db import project_takeaways as ptw_db
        from sonde.db import projects as proj_db

        projects = proj_db.list_projects(program=program, statuses=None, limit=200)
        for p in projects:
            ptw = ptw_db.get(p.id)
            if ptw and ptw.body.strip():
                ptw_db.write_takeaways_file(sonde_dir, p.id, ptw.body)
                project_takeaways_count += 1
    except (Exception, SystemExit):
        pass

    if ctx.obj.get("json"):
        print_json(
            {
                "experiments": len(experiments),
                "findings": len(findings),
                "questions": len(questions),
                "directions": len(directions),
                "takeaways": bool(tw and tw.body.strip()),
                "project_takeaways": project_takeaways_count,
                "_sync": asdict(sync),
            }
        )
        return

    print_success(
        f"Pulled {len(experiments)} experiment(s), "
        f"{len(findings)} finding(s), "
        f"{len(questions)} question(s), "
        f"{len(directions)} direction(s)"
    )
    err.print("  [sonde.muted]→ .sonde/[/]")
    if sync.mode != "none":
        err.print(
            f"  [sonde.muted]Artifacts: downloaded {sync.downloaded}, "
            f"updated {sync.updated}, skipped {sync.skipped}, failed {sync.failed}[/]"
        )


def _sync_experiments(
    sonde_dir: Path,
    experiments: list[dict[str, Any]],
    *,
    selector: dict[str, Any],
    artifact_mode: str,
    use_json: bool,
    follow_up_command: str | None,
) -> ArtifactSyncSummary:
    for exp in experiments:
        _write_record_with_body(sonde_dir, "experiments", exp["id"], exp)
        ensure_subdir(sonde_dir, f"experiments/{exp['id']}")
        try:
            notes = notes_db.list_by_experiment(exp["id"])
            if notes:
                _write_notes(sonde_dir, exp["id"], notes)
        except APIError as exc:
            from sonde.db import classify_api_error

            what, _why, _fix = classify_api_error(
                exc,
                table="experiment_notes",
                action="read notes",
            )
            err.print(f"  [sonde.warning]Could not pull notes for {exp['id']}: {what}[/]")

    return _download_selected_artifacts(
        sonde_dir,
        experiments,
        selector=selector,
        mode=artifact_mode,
        use_json=use_json,
        follow_up_command=follow_up_command,
    )


def _download_selected_artifacts(
    sonde_dir: Path,
    experiments: list[dict[str, Any]],
    *,
    selector: dict[str, Any],
    mode: str,
    use_json: bool,
    follow_up_command: str | None,
) -> ArtifactSyncSummary:
    summary = ArtifactSyncSummary(mode=mode)
    if mode == "none" or not experiments:
        return summary

    artifacts = list_for_experiments([exp["id"] for exp in experiments])
    if not artifacts:
        return summary

    planned: list[SyncCandidate] = []
    for artifact in artifacts:
        storage_path = str(artifact.get("storage_path") or "")
        if not storage_path:
            continue
        is_text = is_text_artifact(
            str(artifact.get("filename") or Path(storage_path).name),
            artifact.get("mime_type"),
        )
        if is_text:
            summary.text_total += 1
        else:
            summary.media_total += 1

        should_select = (
            mode == "all" or (mode == "text" and is_text) or (mode == "media" and not is_text)
        )
        if not should_select:
            continue

        local_path, local_action = _planned_pull_target(sonde_dir, artifact)
        fingerprint = build_fingerprint(
            storage_path,
            local_action,
            artifact.get("checksum_sha256"),
            artifact.get("size_bytes"),
        )
        planned.append(
            SyncCandidate(
                key=storage_path,
                label=str(local_path.relative_to(sonde_dir)),
                size_bytes=int(artifact.get("size_bytes") or 0),
                kind="text" if is_text else "media",
                action=local_action,
                fingerprint=fingerprint,
                local_path=str(local_path),
                storage_path=storage_path,
                metadata=artifact,
            )
        )

    plan = build_plan(planned)
    summary.selected = plan.total
    summary.selected_bytes = plan.total_bytes
    summary.plan = asdict(plan)
    journal = SyncJournal(
        sonde_dir,
        operation="pull-experiment",
        selector={"selector": selector, "mode": mode},
        candidates=planned,
    )
    summary.resume = asdict(journal.resume)
    if not planned:
        if mode == "text" and summary.media_total and follow_up_command and not use_json:
            err.print(
                f"  [sonde.muted]Skipped {summary.media_total} media artifact(s). "
                f"Run: {follow_up_command}[/]"
            )
        return summary

    progress = SyncProgress(
        title="Pulling artifacts",
        verb="download",
        plan=plan,
        resume=journal.resume,
        use_json=use_json,
    )
    progress.print_preflight()
    progress.start()

    try:
        for candidate in planned:
            if candidate.action == "skip":
                summary.skipped += 1
                journal.record(candidate, status="skipped", bytes_transferred=candidate.size_bytes)
                progress.advance_file(bytes_transferred=candidate.size_bytes)
                continue

            progress.set_current(candidate.label)
            result = _download_one_artifact(Path(candidate.local_path or ""), candidate.metadata)
            if result == "downloaded":
                summary.downloaded += 1
                summary.downloaded_bytes += candidate.size_bytes
                journal.record(
                    candidate, status="downloaded", bytes_transferred=candidate.size_bytes
                )
                progress.advance_file(bytes_transferred=candidate.size_bytes)
            elif result == "updated":
                summary.updated += 1
                summary.downloaded_bytes += candidate.size_bytes
                journal.record(candidate, status="updated", bytes_transferred=candidate.size_bytes)
                progress.advance_file(bytes_transferred=candidate.size_bytes)
            elif result == "skipped":
                summary.skipped += 1
                journal.record(candidate, status="skipped", bytes_transferred=candidate.size_bytes)
                progress.advance_file(bytes_transferred=candidate.size_bytes)
            else:
                summary.failed += 1
                journal.record(candidate, status="failed", bytes_transferred=0)
                progress.advance_file(bytes_transferred=0)
    finally:
        summary.elapsed_seconds = progress.stop()

    journal.finish(keep=summary.failed > 0)

    if mode == "text" and summary.media_total and follow_up_command and not use_json:
        err.print(
            f"  [sonde.muted]Skipped {summary.media_total} media artifact(s). "
            f"Run: {follow_up_command}[/]"
        )
    return summary


def _planned_pull_target(sonde_dir: Path, artifact: dict[str, Any]) -> tuple[Path, str]:
    from sonde.db.validate import contained_path

    experiment_id = str(artifact.get("experiment_id") or "")
    storage_path = str(artifact.get("storage_path") or "")
    exp_dir = sonde_dir / "experiments" / experiment_id
    if storage_path.startswith(f"{experiment_id}/"):
        relative = storage_path[len(experiment_id) + 1 :]
    else:
        relative = str(artifact.get("filename") or Path(storage_path).name)

    try:
        local_path = contained_path(exp_dir, relative)
    except ValueError:
        return exp_dir / Path(relative).name, "download"

    if local_path.exists():
        return local_path, "skip" if _matches_local_artifact(local_path, artifact) else "update"
    return local_path, "download"


def _download_one_artifact(local_path: Path, artifact: dict[str, Any]) -> str:
    storage_path = str(artifact.get("storage_path") or "")
    if not storage_path:
        return "failed"

    already_exists = local_path.exists()

    try:
        data = download_file(storage_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        _write_bytes_atomic(local_path, data)
    except Exception as exc:
        err.print(f"  [sonde.warning]Failed to download {storage_path}: {exc}[/]")
        return "failed"
    return "updated" if already_exists else "downloaded"


def _matches_local_artifact(local_path: Path, artifact: dict[str, Any]) -> bool:
    size = artifact.get("size_bytes")
    if size and local_path.stat().st_size != int(size):
        return False

    checksum = artifact.get("checksum_sha256")
    if checksum:
        try:
            return compute_checksum(local_path) == checksum
        except OSError:
            return False
    return bool(size)


def _write_bytes_atomic(filepath: Path, data: bytes) -> None:
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=filepath.parent) as handle:
        handle.write(data)
        temp_path = Path(handle.name)
    temp_path.replace(filepath)


def _media_follow_up(selector: dict[str, Any], program: str | None) -> str | None:
    kind = selector.get("kind")
    if kind == "single":
        return f"sonde experiment pull {selector['experiment_id']} --artifacts media"
    if kind == "tree":
        flags = " ".join(f"--tree {tree_id}" for tree_id in selector.get("tree_ids", []))
        return f"sonde experiment pull {flags} --artifacts media".strip()

    parts = ["sonde experiment pull"]
    if program:
        parts.extend(["-p", program])
    if selector.get("status"):
        parts.extend(["--status", selector["status"]])
    for tag in selector.get("tags", []):
        parts.extend(["--tag", tag])
    if selector.get("direction"):
        parts.extend(["--direction", selector["direction"]])
    if selector.get("source"):
        parts.extend(["--source", selector["source"]])
    if selector.get("roots"):
        parts.append("--roots")
    parts.extend(["--artifacts", "media"])
    return " ".join(parts)


def _pull_next_steps(experiment_id: str, sync: ArtifactSyncSummary) -> list[str]:
    if sync.failed:
        return []

    exp = exp_db.get(experiment_id)
    if not exp:
        return []

    suggestions: list[str] = [f"sonde show {experiment_id}"]
    if (sync.downloaded or sync.updated) and exp.status in ("open", "running") and not exp.finding:
        suggestions.append(f'sonde note {experiment_id} "What changed after this pull"')

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


def _format_bytes(value: int) -> str:
    size = float(value)
    units = ["B", "KB", "MB", "GB", "TB"]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            precision = 0 if unit == "B" else 1
            return f"{size:.{precision}f} {unit}"
        size /= 1024
    return f"{value} B"


def _write_record_with_body(
    sonde_dir: Path,
    category: str,
    record_id: str,
    record: dict[str, Any],
) -> Path:
    return write_record(sonde_dir, category, record_id, render_record(record))


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
