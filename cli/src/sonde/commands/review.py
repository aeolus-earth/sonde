"""Review command — critique an experiment's methodology and conclusions."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import click
from postgrest.exceptions import APIError

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands._helpers import resolve_experiment_id
from sonde.db import experiments as exp_db
from sonde.db import reviews as review_db
from sonde.db.activity import log_activity
from sonde.local import ensure_subdir, find_sonde_dir
from sonde.models.review import ExperimentReviewEntryCreate
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_success,
    truncate_text,
)
from sonde.review_utils import (
    activity_review_details,
    one_line,
    render_review_entry_markdown,
    render_review_thread_markdown,
)


@click.group("review")
def review() -> None:
    """Review an experiment's methodology, bugs, and interpretation."""


@review.command("add")
@click.argument("experiment_id", required=False, default=None)
@click.argument("content", required=False, default=None)
@click.option("--file", "-f", "content_file", type=click.Path(exists=True), help="Review from file")
@click.option("--stdin", "read_stdin", is_flag=True, help="Read review from stdin")
@pass_output_options
@click.pass_context
def add_review(
    ctx: click.Context,
    experiment_id: str | None,
    content: str | None,
    content_file: str | None,
    read_stdin: bool,
) -> None:
    """Append critique to an experiment's review thread.

    If no experiment ID is given, uses the focused experiment (sonde focus).

    \b
    Examples:
      sonde experiment review add EXP-0001 "Method uses wrong baseline"
      sonde experiment review add --stdin < review.md
      sonde experiment review add EXP-0001 -f critique.md
    """
    experiment_id, content = _resolve_review_target_and_content(
        experiment_id,
        content,
        content_file=content_file,
        read_stdin=read_stdin,
    )
    _require_experiment(experiment_id)

    source = resolve_source()
    now = datetime.now(UTC)
    local_file = _pending_entry_path(experiment_id, now)

    try:
        thread, thread_created = review_db.ensure_thread(experiment_id, source)
        entry = review_db.append_entry(
            ExperimentReviewEntryCreate(
                review_id=thread.id,
                source=source,
                content=content,
            )
        )
    except APIError as exc:
        _write_pending_review_entry(
            experiment_id=experiment_id,
            source=source,
            timestamp=now.isoformat(),
            body=content,
            local_file=local_file,
        )
        from sonde.db import classify_api_error

        what, why, fix = classify_api_error(exc, table="experiment_reviews", action="save review")
        print_error(what, why, fix)
        err.print(
            f"  [sonde.muted]Saved local review for later sync -> "
            f"{local_file.relative_to(find_sonde_dir().parent)}[/]"
        )
        err.print(f"  [sonde.muted]Sync later: sonde push experiment {experiment_id}[/]")
        raise SystemExit(1) from None

    _write_review_thread_file(thread.model_dump(mode="json"))
    _write_review_entry_file(
        experiment_id=experiment_id,
        source=source,
        timestamp=entry.created_at.isoformat(),
        body=entry.content,
        review_id=thread.id,
        entry_id=entry.id,
        created_at_for_name=entry.created_at.isoformat(),
    )

    if thread_created:
        log_activity(
            experiment_id,
            "experiment",
            "review_opened",
            activity_review_details(review_id=thread.id),
        )
    log_activity(
        experiment_id,
        "experiment",
        "review_comment_added",
        activity_review_details(
            review_id=thread.id,
            entry_id=entry.id,
            status=thread.status,
            content=content,
        ),
    )

    if ctx.obj.get("json"):
        print_json(
            {
                "review": thread.model_dump(mode="json"),
                "entry": entry.model_dump(mode="json"),
                "created": thread_created,
            }
        )
        return

    action = "Opened review and added entry" if thread_created else "Added review entry"
    print_success(f"{action} on {experiment_id}", record_id=experiment_id)
    err.print(f"  {one_line(content)}")


@review.command("show")
@click.argument("experiment_id", required=False, default=None)
@pass_output_options
@click.pass_context
def show_review(ctx: click.Context, experiment_id: str | None) -> None:
    """Show an experiment's review thread."""
    experiment_id = resolve_experiment_id(experiment_id)
    data = _review_payload(experiment_id)
    if not data:
        if ctx.obj.get("json"):
            print_json(None)
            return
        err.print(f"[sonde.muted]No review thread for {experiment_id}.[/]")
        print_breadcrumbs([f'Add review: sonde experiment review add {experiment_id} "critique"'])
        return

    if ctx.obj.get("json"):
        print_json(data)
        return

    _render_review_payload(data)
    print_breadcrumbs(
        [
            f'Add entry: sonde experiment review add {experiment_id} "critique"',
            f"Experiment: sonde show {experiment_id}",
        ]
    )


@review.command("resolve")
@click.argument("experiment_id", required=False, default=None)
@click.argument("resolution", required=False, default=None)
@pass_output_options
@click.pass_context
def resolve_review(
    ctx: click.Context,
    experiment_id: str | None,
    resolution: str | None,
) -> None:
    """Mark an experiment review resolved."""
    _finish_review(ctx, experiment_id, resolution, resolved=True)


@review.command("reopen")
@click.argument("experiment_id", required=False, default=None)
@click.argument("reason", required=False, default=None)
@pass_output_options
@click.pass_context
def reopen_review(
    ctx: click.Context,
    experiment_id: str | None,
    reason: str | None,
) -> None:
    """Reopen a resolved experiment review."""
    _finish_review(ctx, experiment_id, reason, resolved=False)


def _finish_review(
    ctx: click.Context,
    experiment_id: str | None,
    message: str | None,
    *,
    resolved: bool,
) -> None:
    experiment_id = resolve_experiment_id(experiment_id)
    thread = review_db.get_thread(experiment_id)
    if not thread:
        print_error(
            f"No review for {experiment_id}",
            "Resolve/reopen requires an existing review thread.",
            f'Add one first: sonde experiment review add {experiment_id} "critique"',
        )
        raise SystemExit(1)

    source = resolve_source()
    entry = None
    if message and message.strip():
        entry = review_db.append_entry(
            ExperimentReviewEntryCreate(
                review_id=thread.id,
                source=source,
                content=message.strip(),
            )
        )

    now = datetime.now(UTC)
    updates: dict[str, Any]
    action: str
    if resolved:
        updates = {
            "status": "resolved",
            "resolved_by": source,
            "resolved_at": now.isoformat(),
        }
        if message and message.strip():
            updates["resolution"] = message.strip()
        action = "review_resolved"
    else:
        updates = {
            "status": "open",
            "resolved_by": None,
            "resolved_at": None,
            "resolution": None,
        }
        action = "review_reopened"

    updated = review_db.update_thread(thread.id, updates)
    if not updated:
        print_error(
            f"Failed to update review for {experiment_id}",
            "The review thread was not returned after update.",
            f"Inspect it: sonde experiment review show {experiment_id}",
        )
        raise SystemExit(1)

    if entry:
        log_activity(
            experiment_id,
            "experiment",
            "review_comment_added",
            activity_review_details(
                review_id=thread.id,
                entry_id=entry.id,
                status=thread.status,
                content=entry.content,
            ),
        )
        _write_review_entry_file(
            experiment_id=experiment_id,
            source=entry.source,
            timestamp=entry.created_at.isoformat(),
            body=entry.content,
            review_id=thread.id,
            entry_id=entry.id,
            created_at_for_name=entry.created_at.isoformat(),
        )

    log_activity(
        experiment_id,
        "experiment",
        action,
        activity_review_details(
            review_id=thread.id,
            status=updated.status,
            content=message,
        ),
    )
    _write_review_thread_file(updated.model_dump(mode="json"))

    if ctx.obj.get("json"):
        data = updated.model_dump(mode="json")
        data["entry"] = entry.model_dump(mode="json") if entry else None
        print_json(data)
        return

    verb = "Resolved" if resolved else "Reopened"
    print_success(f"{verb} review for {experiment_id}", record_id=experiment_id)


def _resolve_review_target_and_content(
    experiment_id: str | None,
    content: str | None,
    *,
    content_file: str | None,
    read_stdin: bool,
) -> tuple[str, str]:
    if experiment_id and not experiment_id.upper().startswith("EXP-"):
        if content:
            print_error(
                "Ambiguous review arguments",
                f"'{experiment_id}' does not look like an experiment ID.",
                'Use: sonde experiment review add EXP-0001 "critique"',
            )
            raise SystemExit(2)
        content = experiment_id
        experiment_id = None

    experiment_id = resolve_experiment_id(experiment_id)

    if content_file:
        content = Path(content_file).read_text(encoding="utf-8").strip()
    elif read_stdin:
        import sys

        if sys.stdin.isatty():
            print_error(
                "No input on stdin",
                "Use --stdin with piped input, not interactively.",
                "cat critique.md | sonde experiment review add EXP-0001 --stdin",
            )
            raise SystemExit(2)
        content = sys.stdin.read().strip()

    if not content or not content.strip():
        print_error(
            "No review content",
            "Provide review text as an argument, --file, or --stdin.",
            'sonde experiment review add EXP-0001 "critique the methodology"',
        )
        raise SystemExit(2)

    return experiment_id.upper(), content.strip()


def _require_experiment(experiment_id: str) -> None:
    if exp_db.exists(experiment_id):
        return
    print_error(
        f"Experiment {experiment_id} not found",
        "Cannot review a nonexistent experiment.",
        "List experiments: sonde experiment list",
    )
    raise SystemExit(1)


def _review_payload(experiment_id: str) -> dict[str, Any] | None:
    return review_db.get_thread_with_entries(experiment_id.upper())


def _render_review_payload(data: dict[str, Any], *, limit: int | None = None) -> None:
    """Render a serialized review payload."""
    entries = data.get("entries") or []
    if limit is not None:
        entries = entries[-limit:]
    status = data.get("status", "open")
    err.print(f"\n[sonde.heading]Review[/]  [sonde.muted]{status} {data.get('id', '')}[/]")
    if data.get("resolution"):
        err.print(f"  [sonde.success]Resolution:[/] {data['resolution']}")
    for entry in entries:
        created = str(entry.get("created_at") or "")[:16].replace("T", " ")
        source = str(entry.get("source") or "unknown")
        if "/" in source:
            source = source.split("/")[-1]
        err.print(f"\n  [sonde.muted]{created}[/]  {source}")
        for line in truncate_text(str(entry.get("content") or ""), 600).splitlines():
            err.print(f"  {line}")


def _review_local_dir(experiment_id: str) -> Path:
    sonde_dir = find_sonde_dir()
    exp_base = _experiment_notebook_dir(sonde_dir, experiment_id)
    review_dir = exp_base / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    return review_dir


def _experiment_notebook_dir(sonde_dir: Path, experiment_id: str) -> Path:
    """Return the local directory that sits beside artifacts/notes for an experiment."""
    from sonde.local import resolve_record_path

    record_path = resolve_record_path(sonde_dir, "experiments", experiment_id)
    if record_path is not None:
        exp_dir = (record_path.parent / experiment_id).relative_to(sonde_dir)
        return ensure_subdir(sonde_dir, str(exp_dir))
    return ensure_subdir(sonde_dir, f"experiments/{experiment_id}")


def _pending_entry_path(experiment_id: str, now: datetime) -> Path:
    entries_dir = ensure_subdir(_review_local_dir(experiment_id), "entries")
    return entries_dir / f"{now.strftime('%Y-%m-%dT%H-%M-%S')}.md"


def _write_pending_review_entry(
    *,
    experiment_id: str,
    source: str,
    timestamp: str,
    body: str,
    local_file: Path,
) -> None:
    local_file.write_text(
        render_review_entry_markdown(
            source=source,
            timestamp=timestamp,
            body=body,
            pending_sync=True,
        ),
        encoding="utf-8",
    )


def _write_review_thread_file(thread: dict[str, Any]) -> None:
    review_dir = _review_local_dir(str(thread["experiment_id"]))
    (review_dir / "thread.md").write_text(render_review_thread_markdown(thread), encoding="utf-8")


def _write_review_entry_file(
    *,
    experiment_id: str,
    source: str,
    timestamp: str,
    body: str,
    review_id: str,
    entry_id: str,
    created_at_for_name: str,
) -> Path:
    review_dir = _review_local_dir(experiment_id)
    entries_dir = ensure_subdir(review_dir, "entries")
    filename = f"{created_at_for_name[:19].replace(':', '-')}-{entry_id}.md"
    path = entries_dir / filename
    path.write_text(
        render_review_entry_markdown(
            source=source,
            timestamp=timestamp,
            body=body,
            review_id=review_id,
            entry_id=entry_id,
        ),
        encoding="utf-8",
    )
    return path
