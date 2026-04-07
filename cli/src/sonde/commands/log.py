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
from sonde.db import questions as q_db
from sonde.db.activity import log_activity
from sonde.git import detect_git_context, detect_multi_repo_context, snapshots_to_json
from sonde.local import generate_body
from sonde.models.experiment import ExperimentCreate
from sonde.models.question import QuestionCreate
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


def _question_context(
    exp_id: str,
    direction_id: str | None,
    project_id: str | None,
) -> str:
    """Build lightweight provenance text for a question raised during logging."""
    lines = [f"Raised while logging experiment {exp_id}."]
    if direction_id:
        lines.append(f"Direction: {direction_id}")
    if project_id:
        lines.append(f"Project: {project_id}")
    return "\n".join(lines)


@click.command("log")
@click.argument("content_text", required=False, default=None)
@click.option("--program", "-p", help="Program namespace (e.g., weather-intervention)")
@click.option(
    "--file", "-f", "content_file", type=click.Path(exists=True), help="Read content from file"
)
@click.option("--stdin", "read_stdin", is_flag=True, help="Read content from stdin")
@click.option("--hypothesis", help="Hypothesis text (supports multiline)")
@click.option(
    "--hypothesis-file",
    type=click.Path(exists=True),
    help="Read multiline hypothesis text from file",
)
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
@click.option("--question", "question_texts", multiple=True, help="Raise follow-up question(s)")
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
    hypothesis_file: str | None,
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
    question_texts: tuple[str, ...],
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

      # Structured fields still work
      sonde log --quick -p weather-intervention \\
        --params '{"ccn": 1200, "scheme": "spectral_bin"}' \\
        --result '{"precip_delta_pct": 5.8}'

      # Open an experiment (backlog item)
      sonde log --open -p weather-intervention "Test combined BL heating + seeding"

      # Log an experiment and capture follow-up questions
      sonde log -p weather-intervention "Spectral bin result was inconclusive" \\
        --question "Does the grid spacing explain the variance?"
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

    hypothesis_from_file = None
    if hypothesis_file:
        with open(hypothesis_file, encoding="utf-8") as fh:
            hypothesis_from_file = fh.read().strip()
    resolved_hypothesis = hypothesis if hypothesis is not None else hypothesis_from_file

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
    if not content and (resolved_hypothesis or parsed_params or parsed_result or finding):
        content = generate_body(
            {
                "hypothesis": resolved_hypothesis,
                "parameters": parsed_params,
                "results": parsed_result,
                "finding": finding,
            }
        )

    # Scaffold section headers for open experiments with no content
    if open_exp and not content:
        content = "## Hypothesis\n\n## Method\n\n## Results\n\n## Finding\n"

    from sonde.local import extract_section_text

    extracted_hypothesis = extract_section_text(content or "", "Hypothesis")
    if (
        resolved_hypothesis is not None
        and extracted_hypothesis
        and extracted_hypothesis.strip() != resolved_hypothesis.strip()
    ):
        err.print(
            "  [sonde.warning]Both --hypothesis and ## Hypothesis were provided; "
            "using the explicit field.[/]"
        )
    final_hypothesis = (
        resolved_hypothesis if resolved_hypothesis is not None else extracted_hypothesis
    )

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
        hypothesis=final_hypothesis,
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
    log_activity(exp.id, "experiment", "created")

    created_questions = []
    for question_text in question_texts:
        question = q_db.create(
            QuestionCreate(
                program=exp.program,
                question=question_text,
                context=_question_context(exp.id, exp.direction_id, exp.project_id),
                source=resolved_source,
                tags=list(exp.tags),
            )
        )
        log_activity(question.id, "question", "created", {"from_experiment_id": exp.id})
        created_questions.append(question)

    if ctx.obj.get("json"):
        from sonde.output import ui_url

        data = exp.model_dump(mode="json")
        data["_ui_url"] = ui_url(exp.id)
        data["question_ids"] = [question.id for question in created_questions]
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
        for question in created_questions:
            err.print(f"  Question: sonde show {question.id}")

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
