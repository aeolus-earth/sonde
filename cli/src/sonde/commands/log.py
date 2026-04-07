"""Log command — create a new experiment."""

from __future__ import annotations

import json
import sys

import click
import yaml

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands._helpers import (
    load_dict_file,
    merge_structured_metadata,
    structured_metadata_options,
)
from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.git import detect_git_context, detect_multi_repo_context, snapshots_to_json
from sonde.local import generate_body
from sonde.models.experiment import ExperimentCreate
from sonde.output import (
    err,
    print_error,
    print_json,
    print_nudge,
    print_success,
    record_summary,
)


def _inherit_project(direction_id: str | None) -> str | None:
    """Auto-inherit project_id from a direction, if it has one."""
    if not direction_id:
        return None
    try:
        from sonde.db import directions as dir_db

        d = dir_db.get(direction_id)
        return getattr(d, "project_id", None) if d else None
    except Exception:
        return None


@click.command("log")
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
@click.option(
    "--result",
    help="Structured JSON dict (legacy). Prefer ## Results section.",
)
@click.option(
    "--result-file",
    "result_file",
    type=click.Path(exists=True),
    help="Structured results from YAML/JSON file (legacy)",
)
@click.option("--finding", help="What you learned (legacy)")
@click.option("--source", "-s", help="Who logged this (default: human/$USER)")
@click.option("--direction", help="Parent research direction ID")
@click.option("--project", help="Parent project ID")
@click.option("--related", help="Related experiment IDs (comma-separated)")
@click.option("--tag", multiple=True, help="Tags (repeatable)")
@click.option("--git-ref", help="Git commit ref (default: auto-detect HEAD)")
@click.option("--status", default="complete", type=click.Choice(["open", "running", "complete"]))
@click.option("--quick", is_flag=True, help="Minimal record — just params + result")
@click.option("--open", "open_exp", is_flag=True, help="Log as open/backlog (not yet run)")
@click.option("--question", "question_text", help="Raise a question linked to this experiment")
@structured_metadata_options
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
    project: str | None,
    related: str | None,
    tag: tuple[str, ...],
    git_ref: str | None,
    status: str,
    quick: bool,
    open_exp: bool,
    question_text: str | None,
    repro: str | None,
    evidence: tuple[str, ...],
    env_vars: tuple[str, ...],
    blocker: str | None,
):
    """Create an experiment in the knowledge base.

    This is the primary way to create experiments. Write content inline,
    from a file, or via stdin. For scaffolding a template to edit locally,
    use: sonde new experiment

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

      # Raise a question alongside the experiment
      sonde log -p weather-intervention "Ran CCN sweep" \
        --question "Does saturation shift with humidity?"
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
            parsed_params = load_dict_file(params_file)
        if params:
            parsed_params = {**parsed_params, **json.loads(params)}

        parsed_result = None
        if result_file:
            parsed_result = load_dict_file(result_file)
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

    # Scaffold section headers for open experiments with no content
    if open_exp and not content:
        content = "## Hypothesis\n\n## Method\n\n## Results\n\n## Finding\n"

    # Status override for --open flag
    if open_exp:
        status = "open"

    # Auto-detect git context (single-repo + multi-repo)
    git_ctx = detect_git_context()
    code_ctx = detect_multi_repo_context()

    metadata = merge_structured_metadata(
        {},
        repro=repro,
        evidence=evidence,
        env_vars=env_vars,
        blocker=blocker,
    )

    data = ExperimentCreate(
        program=resolved_program,
        status=status,
        source=resolved_source,
        content=content or None,
        hypothesis=hypothesis,
        parameters=parsed_params,
        results=parsed_result,
        finding=finding,
        metadata=metadata if metadata else {},
        git_commit=git_ref or (git_ctx.commit if git_ctx else None),
        git_repo=git_ctx.repo if git_ctx else None,
        git_branch=git_ctx.branch if git_ctx else None,
        direction_id=direction or settings.default_direction or None,
        project_id=project or _inherit_project(direction or settings.default_direction),
        related=[r.strip() for r in related.split(",")] if related else [],
        tags=list(tag),
        code_context=snapshots_to_json(code_ctx) if code_ctx else None,
    )

    exp = db.create(data)

    # Log activity
    from sonde.db.activity import log_activity

    log_activity(exp.id, "experiment", "created")

    if ctx.obj.get("json"):
        from sonde.output import ui_url

        data = exp.model_dump(mode="json")
        data["_ui_url"] = ui_url(exp.id)
        print_json(data)
    else:
        print_success(f"Created {exp.id} ({exp.program})", record_id=exp.id)
        summary = record_summary(exp, 80)
        if summary != "—":
            err.print(f"  {summary}")
        if exp.git_commit:
            err.print(f"  Git: {exp.git_commit[:8]}")
        err.print()
        err.print(f"  View:    sonde show {exp.id}")
        err.print(f"  Attach:  sonde attach {exp.id} <file>")

        # Research hygiene nudges (max 1, only for non-JSON)
        if not exp.content and not exp.hypothesis:
            print_nudge(
                "Describe what you're testing and why — be specific for grepability:",
                f'sonde update {exp.id} --method "Spectral bin, 25km, CCN=1500"',
            )
        elif exp.content and len(exp.content.strip()) < 100:
            print_nudge(
                "Short logs lose context. Add method and expected outcome:",
                f'sonde update {exp.id} --method "<procedure, params, expected>"',
            )
        elif not exp.direction_id:
            print_nudge(
                "Attach to a research direction:",
                f"sonde update {exp.id} --direction DIR-XXX",
            )

    # Create linked question if --question was provided
    if question_text:
        from sonde.db import questions as q_db
        from sonde.models.question import QuestionCreate

        q_data = QuestionCreate(
            program=resolved_program,
            question=question_text,
            context=f"Raised while logging {exp.id}",
            source=resolved_source,
        )
        q_record = q_db.create(q_data)
        from sonde.db.activity import log_activity as _log_q_activity

        _log_q_activity(q_record.id, "question", "created")
        if not ctx.obj.get("json"):
            err.print(f"\n  Question logged: {q_record.id}")
            err.print(f"  View: sonde question show {q_record.id}")
