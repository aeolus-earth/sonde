"""Experiment commands — log, list, show, search, update."""

from __future__ import annotations

import json
import os

import click

from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.git import detect_git_context
from sonde.models.experiment import ExperimentCreate
from sonde.output import err, print_error, print_json, print_success, print_table, styled_status


@click.group()
def experiment():
    """Manage experiments."""


@experiment.command()
@click.option("--program", "-p", help="Program namespace (e.g., weather-intervention)")
@click.option("--hypothesis", help="What you expected to find")
@click.option("--params", help="Parameters as JSON string")
@click.option("--result", help="Results as JSON string")
@click.option("--finding", help="What you learned")
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
    program: str | None,
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
    Examples:
      # Quick log after a simulation run
      sonde log --quick -p weather-intervention \\
        --params '{"ccn": 1200, "scheme": "spectral_bin"}' \\
        --result '{"precip_delta_pct": 5.8}'

      # Full log with finding and tags
      sonde log -p weather-intervention \\
        --hypothesis "Spectral bin changes CCN response" \\
        --params '{"ccn": 1200, "scheme": "spectral_bin"}' \\
        --result '{"precip_delta_pct": 5.8}' \\
        --finding "8% less enhancement than bulk at same CCN" \\
        --tag cloud-seeding --tag spectral-bin

      # Open an experiment (backlog item)
      sonde log --open -p weather-intervention \\
        --hypothesis "Combined BL heating + seeding is superlinear"
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

    # Parse JSON fields
    try:
        parsed_params = json.loads(params) if params else {}
        parsed_result = json.loads(result) if result else None
    except json.JSONDecodeError as e:
        print_error("Invalid JSON", str(e), "Check your --params and --result values")
        raise SystemExit(2) from None

    # Status override for --open flag
    if open_exp:
        status = "open"

    # Auto-detect git context
    git_ctx = detect_git_context()

    data = ExperimentCreate(
        program=resolved_program,
        status=status,
        source=resolved_source,
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

    if ctx.obj.get("json"):
        print_json(exp.model_dump(mode="json"))
    else:
        print_success(f"Created {exp.id} ({exp.program})")
        if exp.hypothesis:
            err.print(f"  Hypothesis: {exp.hypothesis[:80]}")
        if exp.finding:
            err.print(f"  Finding: {exp.finding[:80]}")
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
        columns = ["id", "status", "program", "parameters", "finding"]
        rows = []
        for e in experiments:
            param_str = ", ".join(f"{k}={v}" for k, v in e.parameters.items())[:40]
            rows.append(
                {
                    "id": e.id,
                    "status": e.status,
                    "program": e.program,
                    "parameters": param_str or "—",
                    "finding": _truncate(e.finding, 50),
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
        from rich.panel import Panel

        from sonde.output import out

        lines = []
        lines.append(f"[sonde.heading]{exp.id}[/]  {styled_status(exp.status)}  {exp.program}")
        lines.append(
            f"[sonde.muted]Source: {exp.source}  Created: {exp.created_at:%Y-%m-%d %H:%M}[/]"
        )
        if exp.hypothesis:
            lines.append(f"\n[sonde.heading]Hypothesis:[/sonde.heading]\n  {exp.hypothesis}")
        if exp.parameters:
            param_str = "\n".join(f"  {k}: {v}" for k, v in exp.parameters.items())
            lines.append(f"\n[sonde.heading]Parameters:[/sonde.heading]\n{param_str}")
        if exp.results:
            result_str = "\n".join(f"  {k}: {v}" for k, v in exp.results.items())
            lines.append(f"\n[sonde.heading]Results:[/sonde.heading]\n{result_str}")
        if exp.finding:
            lines.append(f"\n[sonde.heading]Finding:[/sonde.heading]\n  {exp.finding}")
        if exp.git_commit:
            lines.append("\n[sonde.heading]Provenance:[/sonde.heading]")
            lines.append(f"  Commit: {exp.git_commit[:12]}")
            if exp.git_repo:
                lines.append(f"  Repo: {exp.git_repo}")
            if exp.git_branch:
                lines.append(f"  Branch: {exp.git_branch}")
        if exp.related:
            lines.append(f"\n[sonde.heading]Related:[/sonde.heading] {', '.join(exp.related)}")
        if exp.tags:
            lines.append(f"[sonde.heading]Tags:[/sonde.heading] {', '.join(exp.tags)}")

        out.print(
            Panel(
                "\n".join(lines),
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
        columns = ["id", "status", "parameters", "finding"]
        rows = []
        for e in experiments:
            param_str = ", ".join(f"{k}={v}" for k, v in e.parameters.items())[:40]
            rows.append(
                {
                    "id": e.id,
                    "status": e.status,
                    "parameters": param_str or "—",
                    "finding": _truncate(e.finding, 60),
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
