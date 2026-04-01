"""List command — list experiments with filters."""

from __future__ import annotations

from typing import Any

import click

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands._context import use_json
from sonde.commands._experiment_query import (
    CommandInputError,
    resolve_page_offset,
    resolve_status_filter,
)
from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
    record_summary,
    truncate_text,
)


def _columns_for_status(
    status: str | None,
) -> tuple[list[str], Any]:
    """Return (columns, row_builder) adapted to the status filter."""

    def _short_source(src: str | None) -> str:
        return src.split("/")[-1] if src and "/" in src else (src or "—")

    def _blocker_prefix(e) -> str:
        meta = getattr(e, "metadata", None) or {}
        return "\u26d4 " if meta.get("blocker") else ""

    def _default(e):
        return {
            "id": e.id,
            "status": e.status,
            "program": e.program,
            "updated": e.updated_at.strftime("%Y-%m-%d") if e.updated_at else "—",
            "tags": ", ".join(e.tags)[:30] if e.tags else "—",
            "summary": _blocker_prefix(e) + record_summary(e, 50),
        }

    def _open(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": _short_source(e.source),
            "created": e.created_at.strftime("%Y-%m-%d") if e.created_at else "—",
            "summary": _blocker_prefix(e) + record_summary(e, 45),
        }

    def _running(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": _short_source(e.source),
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "summary": _blocker_prefix(e) + record_summary(e, 45),
        }

    def _complete(e):
        return {
            "id": e.id,
            "program": e.program,
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "finding": truncate_text(e.finding, 50) if e.finding else record_summary(e, 50),
        }

    def _failed(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": _short_source(e.source),
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "summary": _blocker_prefix(e) + record_summary(e, 45),
        }

    mapping = {
        "open": (["id", "program", "source", "created", "summary"], _open),
        "running": (["id", "program", "source", "tags", "summary"], _running),
        "complete": (["id", "program", "tags", "finding"], _complete),
        "failed": (["id", "program", "source", "tags", "summary"], _failed),
    }
    default_entry = (["id", "status", "program", "updated", "tags", "summary"], _default)
    if status is None or status not in mapping:
        return default_entry
    return mapping[status]


@click.command("list")
@click.option("--program", "-p", help="Filter by program")
@click.option("--status", help="Filter by status (open, running, complete, failed)")
@click.option("--open", "filter_open", is_flag=True, help="Show only open experiments")
@click.option("--running", "filter_running", is_flag=True, help="Show only running experiments")
@click.option("--complete", "filter_complete", is_flag=True, help="Show only complete experiments")
@click.option("--failed", "filter_failed", is_flag=True, help="Show only failed experiments")
@click.option("--source", help="Filter by source (prefix match if no '/')")
@click.option("--me", "filter_me", is_flag=True, help="Show only my experiments")
@click.option("--tag", multiple=True, help="Filter by tag (repeatable)")
@click.option("--direction", "-d", help="Filter by research direction ID")
@click.option("--project", help="Filter by project ID")
@click.option("--since", help="Show experiments created after this date (YYYY-MM-DD)")
@click.option("--before", help="Show experiments created before this date (YYYY-MM-DD)")
@click.option(
    "--sort",
    type=click.Choice(["created", "updated"]),
    default="created",
    help="Sort order (default: created)",
)
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=50, help="Max results (default: 50)")
@click.option("--offset", default=0, help="Skip first N results (for pagination)")
@click.option("--page", type=int, help="Page number (1-based, combines with --limit)")
@click.option(
    "--all", "show_all", is_flag=True, help="Include completed and superseded experiments"
)
@click.option("--roots", is_flag=True, help="Show only root experiments (no parent)")
@click.option("--children-of", "children_of", help="List children of this experiment")
@pass_output_options
@click.pass_context
def list_cmd(
    ctx: click.Context,
    program: str | None,
    status: str | None,
    filter_open: bool,
    filter_running: bool,
    filter_complete: bool,
    filter_failed: bool,
    source: str | None,
    filter_me: bool,
    tag: tuple[str, ...],
    direction: str | None,
    project: str | None,
    since: str | None,
    before: str | None,
    sort: str,
    show_count: bool,
    limit: int,
    offset: int,
    page: int | None,
    show_all: bool,
    roots: bool,
    children_of: str | None,
):
    """List experiments (actionable only by default).

    \b
    Examples:
      sonde list                                  # open + running + failed
      sonde list --all                            # include completed/superseded
      sonde list --open                           # open experiments
      sonde list --complete -p weather-intervention
      sonde list --tag cloud-seeding
      sonde list --since 2026-03-01 --before 2026-03-15
      sonde list --direction DIR-001
      sonde list --sort updated                   # recently modified first
      sonde list --source human                   # all human-logged experiments
      sonde list --count --open                   # just the count
    """
    # Resolve convenience flags to status
    try:
        status = resolve_status_filter(
            status=status,
            filter_open=filter_open,
            filter_running=filter_running,
            filter_complete=filter_complete,
            filter_failed=filter_failed,
        )
    except CommandInputError as exc:
        print_error(exc.what, exc.why, exc.fix)
        raise SystemExit(2) from None

    # Default: show only actionable experiments unless explicit status filter or --all
    exclude_terminal = not show_all and status is None

    settings = get_settings()
    resolved_program = program or settings.program or None

    # Resolve --me to source filter
    if filter_me:
        if source:
            print_error(
                "Conflicting filters",
                "Cannot use --me with --source.",
                "Use one or the other.",
            )
            raise SystemExit(2)
        source = resolve_source()

    # Resolve --page to offset
    try:
        offset = resolve_page_offset(page=page, limit=limit, offset=offset)
    except CommandInputError as exc:
        print_error(exc.what, exc.why, exc.fix)
        raise SystemExit(2) from None

    # --children-of: short-circuit to direct children query
    if children_of:
        experiments = db.get_children(children_of.upper())
        if use_json(ctx):
            print_json([e.model_dump(mode="json") for e in experiments])
        elif not experiments:
            err.print(f"[dim]No children found for {children_of.upper()}.[/dim]")
        else:
            columns, row_builder = _columns_for_status(status)
            print_table(columns, [row_builder(e) for e in experiments])
        return

    # --count: issue a true count query, not limited by --limit
    if show_count:
        total = db.count_experiments(
            program=resolved_program,
            status=status,
            source=source,
            tags=list(tag) or None,
            direction=direction,
            project=project,
            since=since,
            before=before,
            exclude_terminal=exclude_terminal,
        )
        if use_json(ctx):
            print_json({"count": total})
        else:
            click.echo(total)
        return

    experiments = db.list_experiments(
        program=resolved_program,
        status=status,
        source=source,
        tags=list(tag) or None,
        direction=direction,
        project=project,
        since=since,
        before=before,
        sort=sort,
        limit=limit,
        offset=offset,
        roots=roots,
        exclude_terminal=exclude_terminal,
    )

    has_more = len(experiments) > limit
    experiments = experiments[:limit]

    if use_json(ctx):
        print_json([e.model_dump(mode="json") for e in experiments])
    elif not experiments:
        err.print("[dim]No experiments found.[/dim]")
    else:
        columns, row_builder = _columns_for_status(status)
        table_rows = [row_builder(e) for e in experiments]
        print_table(columns, table_rows)

        # Context-aware summary line
        label = f"{status} experiment(s)" if status else "experiment(s)"
        parts = [f"{len(experiments)} {label}"]
        if resolved_program:
            parts.append(f"in {resolved_program}")
        if has_more:
            parts.append(f"(more: --offset {offset + limit})")
        err.print(f"\n[dim]{' '.join(parts)}[/dim]")

        if experiments:
            print_breadcrumbs([f"Show details: sonde show {experiments[0].id}"])
