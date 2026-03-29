"""Experiment commands — log, list, show, search, update."""

from __future__ import annotations

import json
import os
import sys

import click

from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.git import detect_git_context
from sonde.local import _generate_body
from sonde.models.experiment import ExperimentCreate
from sonde.output import err, print_error, print_json, print_success, print_table, styled_status


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
@click.option("--result", help="Results as JSON string (legacy)")
@click.option("--finding", help="What you learned (legacy)")
@click.option("--source", "-s", help="Who logged this (default: human/$USER)")
@click.option("--direction", help="Parent research direction ID")
@click.option("--related", help="Related experiment IDs (comma-separated)")
@click.option("--tag", multiple=True, help="Tags (repeatable)")
@click.option("--git-ref", help="Git commit ref (default: auto-detect HEAD)")
@click.option("--status", default="complete", type=click.Choice(["open", "running", "complete"]))
@click.option("--quick", is_flag=True, help="Minimal record — just params + result")
@click.option("--open", "open_exp", is_flag=True, help="Log as open/backlog (not yet run)")
@click.pass_context
def log(
    ctx: click.Context,
    content_text: str | None,
    program: str | None,
    content_file: str | None,
    read_stdin: bool,
    hypothesis: str | None,
    params: str | None,
    result: str | None,
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
    resolved_source = source or settings.source or f"human/{os.environ.get('USER', 'unknown')}"

    # Resolve content from the three possible sources
    content = None
    if content_file:
        with open(content_file, encoding="utf-8") as fh:
            content = fh.read().strip()
    elif read_stdin and not sys.stdin.isatty():
        content = sys.stdin.read().strip()
    elif content_text:
        content = content_text

    # Parse JSON fields
    try:
        parsed_params = json.loads(params) if params else {}
        parsed_result = json.loads(result) if result else None
    except json.JSONDecodeError as e:
        print_error("Invalid JSON", str(e), "Check your --params and --result values")
        raise SystemExit(2) from None

    # If legacy flags used without explicit content, generate content from them
    if not content and (hypothesis or parsed_params or parsed_result or finding):
        content = _generate_body(
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
        summary = _summary(exp, 80)
        if summary != "—":
            err.print(f"  {summary}")
        if exp.git_commit:
            err.print(f"  Git: {exp.git_commit[:8]}")
        err.print()
        err.print(f"  View:    sonde show {exp.id}")
        err.print(f"  Attach:  sonde attach {exp.id} <file>")


@experiment.command("list")
@click.option("--program", "-p", help="Filter by program")
@click.option("--status", help="Filter by status")
@click.option("--source", help="Filter by source")
@click.option("--limit", "-n", default=50, help="Max results (default: 50)")
@click.option("--offset", default=0, help="Skip first N results (for pagination)")
@click.pass_context
def list_cmd(
    ctx: click.Context,
    program: str | None,
    status: str | None,
    source: str | None,
    limit: int,
    offset: int,
):
    """List experiments.

    \b
    Examples:
      sonde experiment list
      sonde experiment list -p weather-intervention
      sonde experiment list --status open
      sonde experiment list --offset 50
    """
    settings = get_settings()
    resolved_program = program or settings.program or None

    experiments = db.list_experiments(
        program=resolved_program, status=status, source=source, limit=limit, offset=offset
    )

    has_more = len(experiments) > limit
    experiments = experiments[:limit]

    if ctx.obj.get("json"):
        print_json([e.model_dump(mode="json") for e in experiments])
    elif not experiments:
        err.print("[dim]No experiments found.[/dim]")
    else:
        columns = ["id", "status", "program", "tags", "summary"]
        rows = []
        for e in experiments:
            tag_str = ", ".join(e.tags)[:30] if e.tags else "—"
            rows.append(
                {
                    "id": e.id,
                    "status": e.status,
                    "program": e.program,
                    "tags": tag_str,
                    "summary": _summary(e, 50),
                }
            )
        print_table(columns, rows)
        if has_more:
            next_offset = offset + limit
            err.print(
                f"\n[dim]{len(experiments)} experiment(s) shown."
                f" More available: --offset {next_offset}[/dim]"
            )
        else:
            err.print(f"\n[dim]{len(experiments)} experiment(s)[/dim]")


@experiment.command()
@click.argument("experiment_id")
@click.pass_context
def show(ctx: click.Context, experiment_id: str):
    """Show full details for an experiment.

    \b
    Examples:
      sonde experiment show EXP-0001
      sonde show EXP-0001 --json
    """
    exp = db.get(experiment_id.upper())

    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(exp.model_dump(mode="json"))
    else:
        from rich.markdown import Markdown
        from rich.panel import Panel

        from sonde.output import out

        # Metadata header (always shown)
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
            # Content-first: render markdown body
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
            # Legacy: structured field display
            if exp.hypothesis:
                header.append(f"\n[sonde.heading]Hypothesis:[/sonde.heading]\n  {exp.hypothesis}")
            if exp.parameters:
                param_str = "\n".join(f"  {k}: {v}" for k, v in exp.parameters.items())
                header.append(f"\n[sonde.heading]Parameters:[/sonde.heading]\n{param_str}")
            if exp.results:
                result_str = "\n".join(f"  {k}: {v}" for k, v in exp.results.items())
                header.append(f"\n[sonde.heading]Results:[/sonde.heading]\n{result_str}")
            if exp.finding:
                header.append(f"\n[sonde.heading]Finding:[/sonde.heading]\n  {exp.finding}")
            if exp.git_commit and not exp.content:
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


@experiment.command()
@click.option("--program", "-p", help="Filter by program")
@click.option("--text", "-t", help="Full-text search across hypothesis and finding")
@click.option("--param", multiple=True, help="Parameter filter (e.g., ccn>1000)")
@click.option("--tag", multiple=True, help="Filter by tag")
@click.option("--limit", "-n", default=50, help="Max results")
@click.option("--offset", default=0, help="Skip first N results (for pagination)")
@click.pass_context
def search(
    ctx: click.Context,
    program: str | None,
    text: str | None,
    param: tuple[str, ...],
    tag: tuple[str, ...],
    limit: int,
    offset: int,
):
    """Search experiments.

    \b
    Examples:
      sonde experiment search --text "spectral bin"
      sonde experiment search --param ccn>1000
      sonde experiment search -p weather-intervention --tag cloud-seeding
    """
    settings = get_settings()
    resolved_program = program or settings.program or None

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
        param_filters=param_filters or None,
        tags=list(tag) or None,
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
        columns = ["id", "status", "tags", "summary"]
        rows = []
        for e in experiments:
            tag_str = ", ".join(e.tags)[:30] if e.tags else "—"
            rows.append(
                {
                    "id": e.id,
                    "status": e.status,
                    "tags": tag_str,
                    "summary": _summary(e, 60),
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


def _truncate(text: str | None, length: int) -> str:
    if not text:
        return "—"
    return text[:length] + "..." if len(text) > length else text


def _summary(exp, length: int = 60) -> str:
    """Extract a one-line summary from experiment content, falling back to legacy fields."""
    if exp.content:
        for line in exp.content.splitlines():
            stripped = line.strip().lstrip("# ").strip()
            if stripped:
                return _truncate(stripped, length)
    if exp.finding:
        return _truncate(exp.finding, length)
    if exp.hypothesis:
        return _truncate(exp.hypothesis, length)
    return "—"
