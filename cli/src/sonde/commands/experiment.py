"""Experiment commands — log, list, show, search, update."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import click
import yaml

from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.git import detect_git_context
from sonde.local import _generate_body
from sonde.models.experiment import ExperimentCreate
from sonde.output import (
    _truncate_text,
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_success,
    print_table,
    record_summary,
    styled_status,
)


def _load_dict_file(path: str) -> dict:
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


def _columns_for_status(status: str | None):
    """Return (columns, row_builder) adapted to the status filter."""

    def _default(e):
        return {
            "id": e.id,
            "status": e.status,
            "program": e.program,
            "tags": ", ".join(e.tags)[:30] if e.tags else "—",
            "summary": record_summary(e, 50),
        }

    def _open(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": e.source.split("/")[-1] if "/" in e.source else e.source,
            "created": e.created_at.strftime("%Y-%m-%d") if e.created_at else "—",
            "summary": record_summary(e, 45),
        }

    def _running(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": e.source.split("/")[-1] if "/" in e.source else e.source,
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "summary": record_summary(e, 45),
        }

    def _complete(e):
        return {
            "id": e.id,
            "program": e.program,
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "finding": _truncate_text(e.finding, 50) if e.finding else record_summary(e, 50),
        }

    def _failed(e):
        return {
            "id": e.id,
            "program": e.program,
            "source": e.source.split("/")[-1] if "/" in e.source else e.source,
            "tags": ", ".join(e.tags)[:25] if e.tags else "—",
            "summary": record_summary(e, 45),
        }

    mapping = {
        "open": (["id", "program", "source", "created", "summary"], _open),
        "running": (["id", "program", "source", "tags", "summary"], _running),
        "complete": (["id", "program", "tags", "finding"], _complete),
        "failed": (["id", "program", "source", "tags", "summary"], _failed),
    }
    return mapping.get(status, (["id", "status", "program", "tags", "summary"], _default))


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
            "Failed to read file", str(e),
            "Check your --params-file and --result-file paths",
        )
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
@click.option("--source", help="Filter by source")
@click.option("--tag", multiple=True, help="Filter by tag (repeatable)")
@click.option("--limit", "-n", default=50, help="Max results (default: 50)")
@click.option("--offset", default=0, help="Skip first N results (for pagination)")
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
    tag: tuple[str, ...],
    limit: int,
    offset: int,
):
    """List experiments.

    \b
    Examples:
      sonde list                                  # all experiments
      sonde list --open                           # open experiments
      sonde list --complete -p weather-intervention
      sonde list --tag cloud-seeding
      sonde list --status open                    # same as --open
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

    experiments = db.list_experiments(
        program=resolved_program,
        status=status,
        source=source,
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
        columns, row_builder = _columns_for_status(status)
        table_rows = [row_builder(e) for e in experiments]
        print_table(columns, table_rows)
        if has_more:
            next_offset = offset + limit
            err.print(
                f"\n[dim]{len(experiments)} experiment(s) shown."
                f" More available: --offset {next_offset}[/dim]"
            )
        else:
            err.print(f"\n[dim]{len(experiments)} experiment(s)[/dim]")
        if experiments:
            print_breadcrumbs([f"Show details: sonde show {experiments[0].id}"])


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
    from sonde.db import rows as to_rows
    from sonde.db.client import get_client

    exp = db.get(experiment_id.upper())

    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    # Fetch related context
    client = get_client()
    related_findings = to_rows(
        client.table("findings")
        .select("id,finding,confidence")
        .contains("evidence", [exp.id])
        .is_("valid_until", "null")
        .execute()
        .data
    )
    artifacts = to_rows(
        client.table("artifacts")
        .select("filename,type,size_bytes")
        .eq("experiment_id", exp.id)
        .execute()
        .data
    )
    activity = to_rows(
        client.table("activity_log")
        .select("created_at,actor,action,details")
        .eq("record_id", exp.id)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
    )

    if ctx.obj.get("json"):
        data = exp.model_dump(mode="json")
        data["_findings"] = related_findings
        data["_artifacts"] = artifacts
        data["_activity"] = activity
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
            if exp.parameters:
                param_str = "\n".join(f"  {k}: {v}" for k, v in exp.parameters.items())
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
                        "id": f["id"],
                        "finding": _truncate_text(f.get("finding"), 55),
                        "confidence": f.get("confidence", "medium"),
                    }
                    for f in related_findings
                ],
                title="Findings from this experiment",
            )

        # Artifacts
        if artifacts:
            err.print(f"\n[sonde.heading]Artifacts[/]")
            for a in artifacts:
                size = a.get("size_bytes")
                size_str = f" ({_format_size(size)})" if size else ""
                err.print(
                    f"  [sonde.muted]{a.get('type', 'file')}[/]  {a['filename']}{size_str}"
                )

        # Recent activity
        if activity:
            err.print(f"\n[sonde.heading]Activity[/]")
            for entry in activity[:5]:
                ts = entry["created_at"][:16].replace("T", " ")
                actor = entry.get("actor", "")
                if "/" in actor:
                    actor = actor.split("/")[-1]
                err.print(f"  [sonde.muted]{ts}[/]  {actor}  {entry['action']}")

        print_breadcrumbs([
            f"History: sonde history {exp.id}",
            f"Note:    sonde note {exp.id} \"observation\"",
        ])


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

    updates: dict = {}

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
            "Failed to read file", str(e),
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
        print_error(f"Failed to update {experiment_id}", "Update returned no data.", "")
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


def _format_size(size_bytes: int | None) -> str:
    """Format bytes as human-readable size."""
    if not size_bytes:
        return ""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.0f} {unit}" if unit == "B" else f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# ---------------------------------------------------------------------------
# Register subcommands from other modules
# ---------------------------------------------------------------------------

from sonde.commands.attach import attach  # noqa: E402
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
