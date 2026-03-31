"""Search command — search experiments with text and filters."""

from __future__ import annotations

import click

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
    print_error,
    print_json,
    print_table,
    record_summary,
)


@click.command("search")
@click.option("--program", "-p", help="Filter by program")
@click.option("--text", "-t", help="Full-text search across hypothesis and finding")
@click.option("--status", help="Filter by status (open, running, complete, failed)")
@click.option("--open", "filter_open", is_flag=True, help="Only open experiments")
@click.option("--running", "filter_running", is_flag=True, help="Only running experiments")
@click.option("--complete", "filter_complete", is_flag=True, help="Only complete experiments")
@click.option("--failed", "filter_failed", is_flag=True, help="Only failed experiments")
@click.option("--param", multiple=True, help="Parameter filter (e.g., ccn>1000)")
@click.option("--tag", multiple=True, help="Filter by tag")
@click.option("--since", help="Created after this date (YYYY-MM-DD)")
@click.option("--before", help="Created before this date (YYYY-MM-DD)")
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=50, help="Max results")
@click.option("--offset", default=0, help="Skip first N results (for pagination)")
@click.option("--page", type=int, help="Page number (1-based, combines with --limit)")
@pass_output_options
@click.pass_context
def search(
    ctx: click.Context,
    program: str | None,
    text: str | None,
    status: str | None,
    filter_open: bool,
    filter_running: bool,
    filter_complete: bool,
    filter_failed: bool,
    param: tuple[str, ...],
    tag: tuple[str, ...],
    since: str | None,
    before: str | None,
    show_count: bool,
    limit: int,
    offset: int,
    page: int | None,
):
    """Search experiments.

    \b
    Examples:
      sonde experiment search --text "spectral bin"
      sonde experiment search --text "spectral bin" --complete
      sonde experiment search --param ccn>1000
      sonde experiment search -p weather-intervention --tag cloud-seeding
      sonde experiment search --since 2026-03-01
    """
    # Resolve convenience status flags
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
    settings = get_settings()
    resolved_program = program or settings.program or None

    try:
        offset = resolve_page_offset(page=page, limit=limit, offset=offset)
    except CommandInputError as exc:
        print_error(exc.what, exc.why, exc.fix)
        raise SystemExit(2) from None

    param_filters = []
    for p in param:
        matched = False
        for op in [">", "<", "="]:
            if op in p:
                key, value = p.split(op, 1)
                key, value = key.strip(), value.strip()
                if not key:
                    print_error(
                        f"Invalid param filter: {p}",
                        "Filter key cannot be empty.",
                        "Use format: --param key=value or --param key>number",
                    )
                    raise SystemExit(2)
                if not value:
                    print_error(
                        f"Invalid param filter: {p}",
                        "Filter value cannot be empty.",
                        "Use format: --param key=value or --param key>number",
                    )
                    raise SystemExit(2)
                if op in (">", "<"):
                    try:
                        float(value)
                    except ValueError:
                        print_error(
                            f"Invalid param filter: {p}",
                            f"Value '{value}' is not a number (required for '{op}' operator).",
                            "Use format: --param key>number (e.g., --param ccn>1000)",
                        )
                        raise SystemExit(2) from None
                param_filters.append((key, op, value))
                matched = True
                break
        if not matched:
            print_error(
                f"Invalid param filter: {p}",
                "No operator found. Expected =, >, or <.",
                "Use format: --param key=value or --param key>number",
            )
            raise SystemExit(2)

    experiments = db.search(
        program=resolved_program,
        text=text,
        status=status,
        param_filters=param_filters or None,
        tags=list(tag) or None,
        since=since,
        before=before,
        limit=limit,
        offset=offset,
    )

    has_more = len(experiments) > limit
    experiments = experiments[:limit]

    if show_count:
        # Server-side count when no text search (accurate); fetched count for text search
        if not text:
            total = db.count_experiments(
                program=resolved_program,
                status=status,
                tags=list(tag) or None,
            )
        else:
            total = len(experiments)
        if use_json(ctx):
            print_json({"count": total})
        else:
            click.echo(total)
        return

    if use_json(ctx):
        print_json([e.model_dump(mode="json") for e in experiments])
    elif not experiments:
        err.print("[dim]No experiments found.[/dim]")
    else:
        columns = ["id", "status", "tags", "summary"]
        rows = []
        for e in experiments:
            tag_str = ", ".join(e.tags)[:30] if e.tags else "—"
            rows.append(
                {
                    "id": e.id,
                    "status": e.status,
                    "tags": tag_str,
                    "summary": record_summary(e, 60),
                }
            )
        print_table(columns, rows)
        if has_more:
            next_offset = offset + limit
            err.print(
                f"\n[dim]{len(experiments)} result(s) shown."
                f" More available: --offset {next_offset}[/dim]"
            )
        else:
            err.print(f"\n[dim]{len(experiments)} result(s)[/dim]")
