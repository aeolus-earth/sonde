"""Experiment commands — log, list, show, search, update."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import click
import yaml

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.git import detect_git_context
from sonde.local import generate_body
from sonde.models.experiment import Experiment, ExperimentCreate
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_success,
    print_table,
    record_summary,
    styled_status,
    truncate_text,
)


def _load_dict_file(path: str) -> dict[str, Any]:
    """Load a YAML or JSON file and return a dict.

    Detects format by extension: .json → json, .yaml/.yml → yaml.
    Other extensions: try JSON first, then YAML.
    """
    p = Path(path)
    content = p.read_text(encoding="utf-8")
    ext = p.suffix.lower()

    if ext == ".json":
        return json.loads(content)
    if ext in (".yaml", ".yml"):
        return yaml.safe_load(content) or {}

    # Unknown extension: try JSON first, then YAML
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return yaml.safe_load(content) or {}


def _columns_for_status(
    status: str | None,
) -> tuple[list[str], Any]:
    """Return (columns, row_builder) adapted to the status filter."""

    def _short_source(src: str | None) -> str:
        return src.split("/")[-1] if src and "/" in src else (src or "—")

    def _default(e):
        return {
            "id": e.id,
            "status": e.status,
            "program": e.program,
            "updated": e.updated_at.strftime("%Y-%m-%d") if e.updated_at else "—",
            "tags": ", ".join(e.tags)[:30] if e.tags else "—",
            "summary": record_summary(e, 50),
        }

    def _open(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": _short_source(e.source),
            "created": e.created_at.strftime("%Y-%m-%d") if e.created_at else "—",
            "summary": record_summary(e, 45),
        }

    def _running(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": _short_source(e.source),
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "summary": record_summary(e, 45),
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
            "summary": record_summary(e, 45),
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


@click.group()
def experiment():
    """Manage experiments."""


@experiment.command()
@click.argument("content_text", required=False, default=None)
@click.option("--program", "-p", help="Program namespace (e.g., weather-intervention)")
@click.option(
    "--file", "-f", "content_file", type=click.Path(exists=True), help="Read content from file"
)
@click.option("--stdin", "read_stdin", is_flag=True, help="Read content from stdin")
@click.option("--hypothesis", help="What you expected to find (legacy)")
@click.option("--params", help="Parameters as JSON string (legacy)")
@click.option(
    "--params-file", "params_file", type=click.Path(exists=True), help="Params from YAML/JSON file"
)
@click.option("--result", help="Results as JSON string (legacy)")
@click.option(
    "--result-file", "result_file", type=click.Path(exists=True), help="Results from YAML/JSON file"
)
@click.option("--finding", help="What you learned (legacy)")
@click.option("--source", "-s", help="Who logged this (default: human/$USER)")
@click.option("--direction", help="Parent research direction ID")
@click.option("--related", help="Related experiment IDs (comma-separated)")
@click.option("--tag", multiple=True, help="Tags (repeatable)")
@click.option("--git-ref", help="Git commit ref (default: auto-detect HEAD)")
@click.option("--status", default="complete", type=click.Choice(["open", "running", "complete"]))
@click.option("--quick", is_flag=True, help="Minimal record — just params + result")
@click.option("--open", "open_exp", is_flag=True, help="Log as open/backlog (not yet run)")
@pass_output_options
@click.pass_context
def log(
    ctx: click.Context,
    content_text: str | None,
    program: str | None,
    content_file: str | None,
    read_stdin: bool,
    hypothesis: str | None,
    params: str | None,
    params_file: str | None,
    result: str | None,
    result_file: str | None,
    finding: str | None,
    source: str | None,
    direction: str | None,
    related: str | None,
    tag: tuple[str, ...],
    git_ref: str | None,
    status: str,
    quick: bool,
    open_exp: bool,
):
    """Log an experiment to the knowledge base.

    \b
    Content can be provided as a positional argument, from a file, or via stdin.
    The content is the experiment itself — write whatever is relevant.

    \b
    Examples:
      # Inline content
      sonde log -p weather-intervention "Ran spectral bin at CCN=1200, 8% less enhancement"

      # From a file
      sonde log -p weather-intervention -f experiment-notes.md

      # From stdin
      echo "Quick observation about CCN response" | sonde log -p weather-intervention --stdin

      # Legacy structured flags (still work)
      sonde log --quick -p weather-intervention \\
        --params '{"ccn": 1200, "scheme": "spectral_bin"}' \\
        --result '{"precip_delta_pct": 5.8}'

      # Open an experiment (backlog item)
      sonde log --open -p weather-intervention "Test combined BL heating + seeding"
    """
    settings = get_settings()

    # Resolve program
    resolved_program = program or settings.program
    if not resolved_program:
        print_error(
            "No program specified",
            "Every experiment must belong to a program.",
            "Use --program <name> or set 'program' in .aeolus.yaml",
        )
        raise SystemExit(2)

    # Resolve source
    resolved_source = source or settings.source or resolve_source()

    # Resolve content from the three possible sources
    content = None
    if content_file:
        with open(content_file, encoding="utf-8") as fh:
            content = fh.read().strip()
    elif read_stdin and not sys.stdin.isatty():
        content = sys.stdin.read().strip()
    elif content_text:
        content = content_text

    # Parse params/result from flags and/or files
    try:
        parsed_params = {}
        if params_file:
            parsed_params = _load_dict_file(params_file)
        if params:
            parsed_params = {**parsed_params, **json.loads(params)}

        parsed_result = None
        if result_file:
            parsed_result = _load_dict_file(result_file)
        if result:
            file_result = parsed_result or {}
            parsed_result = {**file_result, **json.loads(result)}
    except json.JSONDecodeError as e:
        print_error("Invalid JSON", str(e), "Check your --params and --result values")
        raise SystemExit(2) from None
    except (yaml.YAMLError, OSError) as e:
        print_error(
            "Failed to read file",
            str(e),
            "Check your --params-file and --result-file paths",
        )
        raise SystemExit(2) from None

    # If legacy flags used without explicit content, generate content from them
    if not content and (hypothesis or parsed_params or parsed_result or finding):
        content = generate_body(
            {
                "hypothesis": hypothesis,
                "parameters": parsed_params,
                "results": parsed_result,
                "finding": finding,
            }
        )

    # Status override for --open flag
    if open_exp:
        status = "open"

    # Auto-detect git context
    git_ctx = detect_git_context()

    data = ExperimentCreate(
        program=resolved_program,
        status=status,
        source=resolved_source,
        content=content or None,
        hypothesis=hypothesis,
        parameters=parsed_params,
        results=parsed_result,
        finding=finding,
        git_commit=git_ref or (git_ctx.commit if git_ctx else None),
        git_repo=git_ctx.repo if git_ctx else None,
        git_branch=git_ctx.branch if git_ctx else None,
        direction_id=direction,
        related=[r.strip() for r in related.split(",")] if related else [],
        tags=list(tag),
    )

    exp = db.create(data)

    # Log activity
    from sonde.db.activity import log_activity

    log_activity(exp.id, "experiment", "created")

    if ctx.obj.get("json"):
        print_json(exp.model_dump(mode="json"))
    else:
        print_success(f"Created {exp.id} ({exp.program})")
        summary = record_summary(exp, 80)
        if summary != "—":
            err.print(f"  {summary}")
        if exp.git_commit:
            err.print(f"  Git: {exp.git_commit[:8]}")
        err.print()
        err.print(f"  View:    sonde show {exp.id}")
        err.print(f"  Attach:  sonde attach {exp.id} <file>")


@experiment.command("list")
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
    since: str | None,
    before: str | None,
    sort: str,
    show_count: bool,
    limit: int,
    offset: int,
    page: int | None,
):
    """List experiments.

    \b
    Examples:
      sonde list                                  # all experiments
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
    flags = [
        ("open", filter_open),
        ("running", filter_running),
        ("complete", filter_complete),
        ("failed", filter_failed),
    ]
    active = [(name, flag) for name, flag in flags if flag]
    if active and status:
        print_error(
            "Conflicting filters",
            f"Cannot use --{active[0][0]} with --status.",
            "Use one or the other.",
        )
        raise SystemExit(2)
    if len(active) > 1:
        names = ", ".join(f"--{name}" for name, _ in active)
        print_error("Conflicting filters", f"Cannot combine {names}.", "Use one at a time.")
        raise SystemExit(2)
    if active:
        status = active[0][0]

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
    if page is not None:
        if page < 1:
            print_error("Invalid page", "Page must be >= 1.", "Use --page 1 for the first page.")
            raise SystemExit(2)
        offset = (page - 1) * limit

    # --count: issue a true count query, not limited by --limit
    if show_count:
        total = db.count_experiments(
            program=resolved_program,
            status=status,
            source=source,
            tags=list(tag) or None,
            direction=direction,
            since=since,
            before=before,
        )
        if ctx.obj.get("json"):
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
        since=since,
        before=before,
        sort=sort,
        limit=limit,
        offset=offset,
    )

    has_more = len(experiments) > limit
    experiments = experiments[:limit]

    if ctx.obj.get("json"):
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


@experiment.command()
@click.argument("experiment_id")
@click.option("--graph", "-g", is_flag=True, help="Show all connected entities")
@pass_output_options
@click.pass_context
def show(ctx: click.Context, experiment_id: str, graph: bool) -> None:
    """Show full details for an experiment.

    \b
    Examples:
      sonde experiment show EXP-0001
      sonde show EXP-0001 --json
      sonde show EXP-0001 --graph
    """
    from sonde.db import findings as find_db
    from sonde.db.activity import get_history
    from sonde.db.artifacts import list_artifacts

    exp = db.get(experiment_id.upper())

    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    # Fetch related context via db layer
    related_findings = find_db.find_by_evidence(exp.id)
    artifacts = list_artifacts(exp.id)
    activity = get_history(exp.id)[-5:]  # last 5 entries

    if ctx.obj.get("json"):
        data = exp.model_dump(mode="json")
        data["_findings"] = [f.model_dump(mode="json") for f in related_findings]
        data["_artifacts"] = artifacts
        data["_activity"] = activity
        if graph:
            graph_data = db.get_graph_neighborhood(exp)
            data["_graph"] = _serialize_graph(graph_data)
        print_json(data)
    else:
        from rich.markdown import Markdown
        from rich.panel import Panel

        from sonde.output import out

        # Metadata header
        header = []
        header.append(f"[sonde.heading]{exp.id}[/]  {styled_status(exp.status)}  {exp.program}")
        header.append(
            f"[sonde.muted]Source: {exp.source}  Created: {exp.created_at:%Y-%m-%d %H:%M}[/]"
        )
        if exp.tags:
            header.append(f"[sonde.muted]Tags: {', '.join(exp.tags)}[/]")
        if exp.git_commit:
            git_info = f"Git: {exp.git_commit[:12]}"
            if exp.git_branch:
                git_info += f" ({exp.git_branch})"
            header.append(f"[sonde.muted]{git_info}[/]")
        if exp.related:
            header.append(f"[sonde.muted]Related: {', '.join(exp.related)}[/]")

        if exp.content:
            header.append("")
            out.print(
                Panel(
                    "\n".join(header),
                    title=f"[sonde.brand]{exp.id}[/]",
                    border_style="sonde.brand.dim",
                )
            )
            out.print(Markdown(exp.content))
        else:
            if exp.hypothesis:
                header.append(f"\n[sonde.heading]Hypothesis:[/sonde.heading]\n  {exp.hypothesis}")
            if exp.all_params:
                param_str = "\n".join(f"  {k}: {v}" for k, v in exp.all_params.items())
                header.append(f"\n[sonde.heading]Parameters:[/sonde.heading]\n{param_str}")
            if exp.results:
                result_str = "\n".join(f"  {k}: {v}" for k, v in exp.results.items())
                header.append(f"\n[sonde.heading]Results:[/sonde.heading]\n{result_str}")
            if exp.finding:
                header.append(f"\n[sonde.heading]Finding:[/sonde.heading]\n  {exp.finding}")
            if exp.git_commit:
                header.append("\n[sonde.heading]Provenance:[/sonde.heading]")
                header.append(f"  Commit: {exp.git_commit[:12]}")
                if exp.git_repo:
                    header.append(f"  Repo: {exp.git_repo}")
                if exp.git_branch:
                    header.append(f"  Branch: {exp.git_branch}")
            out.print(
                Panel(
                    "\n".join(header),
                    title=f"[sonde.brand]{exp.id}[/]",
                    border_style="sonde.brand.dim",
                )
            )

        # Related findings
        if related_findings:
            print_table(
                ["id", "finding", "confidence"],
                [
                    {
                        "id": f.id,
                        "finding": truncate_text(f.finding, 55),
                        "confidence": f.confidence,
                    }
                    for f in related_findings
                ],
                title="Findings from this experiment",
            )

        # Artifacts
        if artifacts:
            err.print("\n[sonde.heading]Artifacts[/]")
            for a in artifacts:
                size = a.get("size_bytes")
                size_str = f" ({_format_size(size)})" if size else ""
                err.print(f"  [sonde.muted]{a.get('type', 'file')}[/]  {a['filename']}{size_str}")

        # Recent activity
        if activity:
            err.print("\n[sonde.heading]Activity[/]")
            for entry in activity[:5]:
                ts = entry["created_at"][:16].replace("T", " ")
                actor = entry.get("actor", "")
                if "/" in actor:
                    actor = actor.split("/")[-1]
                err.print(f"  [sonde.muted]{ts}[/]  {actor}  {entry['action']}")

        # Graph traversal (--graph)
        if graph:
            _render_graph(exp)

        print_breadcrumbs(
            [
                f"History: sonde history {exp.id}",
                f'Note:    sonde note {exp.id} "observation"',
            ]
        )


@experiment.command()
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
    status_flags = [
        ("open", filter_open),
        ("running", filter_running),
        ("complete", filter_complete),
        ("failed", filter_failed),
    ]
    active = [(name, flag) for name, flag in status_flags if flag]
    if active and status:
        print_error(
            "Conflicting filters",
            f"Cannot use --{active[0][0]} with --status.",
            "Use one or the other.",
        )
        raise SystemExit(2)
    if len(active) > 1:
        names = ", ".join(f"--{name}" for name, _ in active)
        print_error("Conflicting filters", f"Cannot combine {names}.", "Use one at a time.")
        raise SystemExit(2)
    if active:
        status = active[0][0]
    settings = get_settings()
    resolved_program = program or settings.program or None

    # Resolve --page to offset
    if page is not None:
        if page < 1:
            print_error("Invalid page", "Page must be >= 1.", "Use --page 1 for the first page.")
            raise SystemExit(2)
        offset = (page - 1) * limit

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
        if ctx.obj.get("json"):
            print_json({"count": total})
        else:
            click.echo(total)
        return

    if ctx.obj.get("json"):
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


@experiment.command()
@click.argument("experiment_id")
@click.option(
    "--status", type=click.Choice(["open", "running", "complete", "failed", "superseded"])
)
@click.option("--hypothesis", help="Update hypothesis")
@click.option("--params", help="Parameters as JSON (merges with existing)")
@click.option(
    "--params-file", "params_file", type=click.Path(exists=True), help="Params from YAML/JSON file"
)
@click.option("--result", help="Results as JSON")
@click.option(
    "--result-file", "result_file", type=click.Path(exists=True), help="Results from YAML/JSON file"
)
@click.option("--finding", help="Update finding")
@click.option("--content", "-c", "content_text", help="Replace content body")
@click.option("--content-file", type=click.Path(exists=True), help="Replace content from file")
@click.option("--tag", multiple=True, help="Set tags (replaces existing)")
@pass_output_options
@click.pass_context
def update(
    ctx: click.Context,
    experiment_id: str,
    status: str | None,
    hypothesis: str | None,
    params: str | None,
    params_file: str | None,
    result: str | None,
    result_file: str | None,
    finding: str | None,
    content_text: str | None,
    content_file: str | None,
    tag: tuple[str, ...],
):
    """Update fields on an existing experiment.

    \b
    Examples:
      sonde update EXP-0042 --status complete --result '{"rmse": 2.3}'
      sonde update EXP-0042 --finding "CCN saturates at 1500"
      sonde update EXP-0042 --params-file config.yaml
      sonde update EXP-0042 --tag cloud-seeding --tag subtropical
    """
    experiment_id = experiment_id.upper()

    exp = db.get(experiment_id)
    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    updates: dict[str, Any] = {}

    if status is not None:
        updates["status"] = status
    if hypothesis is not None:
        updates["hypothesis"] = hypothesis
    if finding is not None:
        updates["finding"] = finding

    # Content
    if content_file:
        updates["content"] = Path(content_file).read_text(encoding="utf-8").strip()
    elif content_text is not None:
        updates["content"] = content_text

    # Params: merge file + inline with existing
    try:
        new_params = {}
        if params_file:
            new_params = _load_dict_file(params_file)
        if params:
            new_params = {**new_params, **json.loads(params)}
        if new_params:
            updates["parameters"] = {**exp.parameters, **new_params}

        new_result = None
        if result_file:
            new_result = _load_dict_file(result_file)
        if result:
            file_result = new_result or {}
            new_result = {**file_result, **json.loads(result)}
        if new_result is not None:
            updates["results"] = new_result
    except json.JSONDecodeError as e:
        print_error("Invalid JSON", str(e), "Check your --params and --result values")
        raise SystemExit(2) from None
    except (yaml.YAMLError, OSError) as e:
        print_error(
            "Failed to read file",
            str(e),
            "Check your --params-file and --result-file paths",
        )
        raise SystemExit(2) from None

    # Tags: replace if provided
    if tag:
        updates["tags"] = list(tag)

    if not updates:
        err.print("[sonde.muted]Nothing to update.[/]")
        return

    updated = db.update(experiment_id, updates)
    if not updated:
        print_error(
            f"Failed to update {experiment_id}",
            "Update returned no data.",
            f"Verify the experiment exists: sonde show {experiment_id}",
        )
        raise SystemExit(1)

    # Log activity
    from sonde.db.activity import log_activity

    log_activity(experiment_id, "experiment", "updated", updates)

    if ctx.obj.get("json"):
        print_json(updated.model_dump(mode="json"))
    else:
        print_success(f"Updated {experiment_id}")
        summary = record_summary(updated, 80)
        if summary != "—":
            err.print(f"  {summary}")
        if "status" in updates:
            err.print(f"  Status: {styled_status(updates['status'])}")


def _serialize_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Serialize graph neighborhood data for JSON output."""
    return {
        "related_experiments": [e.model_dump(mode="json") for e in graph["related_experiments"]],
        "reverse_related": [e.model_dump(mode="json") for e in graph["reverse_related"]],
        "questions_answered": [q.model_dump(mode="json") for q in graph["questions_answered"]],
        "findings": [f.model_dump(mode="json") for f in graph["findings"]],
        "direction": graph["direction"].model_dump(mode="json") if graph["direction"] else None,
        "direction_siblings": [e.model_dump(mode="json") for e in graph["direction_siblings"]],
    }


def _render_graph(exp: Experiment) -> None:
    """Render graph neighborhood for an experiment."""
    graph = db.get_graph_neighborhood(exp)

    has_content = False

    # Related experiments (forward)
    if graph["related_experiments"]:
        has_content = True
        print_table(
            ["id", "status", "rel", "summary"],
            [
                {"id": e.id, "status": e.status, "rel": "related", "summary": record_summary(e, 45)}
                for e in graph["related_experiments"]
            ],
            title="Related Experiments",
        )

    # Reverse related
    if graph["reverse_related"]:
        has_content = True
        print_table(
            ["id", "status", "rel", "summary"],
            [
                {
                    "id": e.id,
                    "status": e.status,
                    "rel": "references this",
                    "summary": record_summary(e, 45),
                }
                for e in graph["reverse_related"]
            ],
            title="Referenced By",
        )

    # Questions answered
    if graph["questions_answered"]:
        has_content = True
        print_table(
            ["id", "status", "question"],
            [
                {"id": q.id, "status": q.status, "question": truncate_text(q.question, 55)}
                for q in graph["questions_answered"]
            ],
            title="Questions Answered",
        )

    # Findings
    if graph["findings"]:
        has_content = True
        print_table(
            ["id", "finding", "confidence"],
            [
                {"id": f.id, "finding": truncate_text(f.finding, 50), "confidence": f.confidence}
                for f in graph["findings"]
            ],
            title="Findings",
        )

    # Direction
    if graph["direction"]:
        has_content = True
        d = graph["direction"]
        err.print("\n[sonde.heading]Direction[/]")
        err.print(f"  {d.id}  {d.title}  [{d.status}]")
        err.print(f"  [sonde.muted]{d.question}[/]")
        if graph["direction_siblings"]:
            err.print("\n  [sonde.heading]Siblings in this direction:[/]")
            for s in graph["direction_siblings"]:
                err.print(f"    {s.id}  [{s.status}]  {record_summary(s, 50)}")

    if not has_content:
        err.print("\n[dim]No graph connections found for this experiment.[/dim]")


def _format_size(size_bytes: int | None) -> str:
    """Format bytes as human-readable size."""
    if size_bytes is None or size_bytes == 0:
        return ""
    n = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


@experiment.command()
@click.argument("experiment_id")
@click.option("--params", help="Override parameters as JSON (merges with source)")
@click.option(
    "--params-file", "params_file", type=click.Path(exists=True), help="Override params from file"
)
@click.option("--tag", multiple=True, help="Override tags (replaces source tags if provided)")
@click.option("--status", default="open", type=click.Choice(["open", "running"]))
@pass_output_options
@click.pass_context
def fork(
    ctx: click.Context,
    experiment_id: str,
    params: str | None,
    params_file: str | None,
    tag: tuple[str, ...],
    status: str,
):
    """Create a new experiment based on an existing one.

    Copies program, tags, parameters, direction, and data_sources from the
    source experiment. The new experiment links back via 'related'.

    \b
    Examples:
      sonde fork EXP-0001
      sonde fork EXP-0001 --params '{"ccn": 1800}'
      sonde fork EXP-0001 --tag subtropical --tag high-ccn
    """
    source_exp = db.get(experiment_id.upper())
    if not source_exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    # Build overrides
    override_params = dict(source_exp.parameters)
    try:
        if params_file:
            override_params = {**override_params, **_load_dict_file(params_file)}
        if params:
            override_params = {**override_params, **json.loads(params)}
    except json.JSONDecodeError as e:
        print_error("Invalid JSON", str(e), "Check your --params value")
        raise SystemExit(2) from None
    except (yaml.YAMLError, OSError) as e:
        print_error("Failed to read file", str(e), "Check your --params-file path")
        raise SystemExit(2) from None

    resolved_tags = list(tag) if tag else list(source_exp.tags)

    # Resolve source
    settings = get_settings()
    resolved_source = settings.source or resolve_source()

    # Auto-detect git context
    git_ctx = detect_git_context()

    data = ExperimentCreate(
        program=source_exp.program,
        status=status,
        source=resolved_source,
        tags=resolved_tags,
        parameters=override_params,
        metadata=dict(source_exp.metadata),
        direction_id=source_exp.direction_id,
        data_sources=list(source_exp.data_sources),
        related=[source_exp.id],
        git_commit=git_ctx.commit if git_ctx else None,
        git_repo=git_ctx.repo if git_ctx else None,
        git_branch=git_ctx.branch if git_ctx else None,
    )

    new_exp = db.create(data)

    from sonde.db.activity import log_activity

    log_activity(new_exp.id, "experiment", "created", {"forked_from": source_exp.id})

    if ctx.obj.get("json"):
        print_json(new_exp.model_dump(mode="json"))
    else:
        print_success(f"Forked {source_exp.id} → {new_exp.id}")
        if override_params != source_exp.parameters:
            changed = {
                k: v for k, v in override_params.items() if source_exp.parameters.get(k) != v
            }
            if changed:
                err.print(f"  Changed: {', '.join(f'{k}={v}' for k, v in changed.items())}")
        err.print(f"\n  View:    sonde show {new_exp.id}")
        err.print(f"  Start:   sonde start {new_exp.id}")


# ---------------------------------------------------------------------------
# Register subcommands from other modules
# ---------------------------------------------------------------------------

from sonde.commands.attach import attach  # noqa: E402
from sonde.commands.diff import diff_cmd  # noqa: E402
from sonde.commands.history import history  # noqa: E402
from sonde.commands.lifecycle import (  # noqa: E402
    close_experiment,
    open_experiment,
    start_experiment,
)
from sonde.commands.new import new_experiment  # noqa: E402
from sonde.commands.note import note  # noqa: E402
from sonde.commands.tag import tag  # noqa: E402

experiment.add_command(close_experiment)
experiment.add_command(open_experiment)
experiment.add_command(start_experiment)
experiment.add_command(note)
experiment.add_command(attach)
experiment.add_command(tag)
experiment.add_command(history)
experiment.add_command(new_experiment)
experiment.add_command(diff_cmd)
