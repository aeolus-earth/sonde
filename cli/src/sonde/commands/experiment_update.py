"""Update command — modify fields on an existing experiment."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import click
import yaml

from sonde.cli_options import pass_output_options
from sonde.commands._helpers import (
    load_dict_file,
    merge_structured_metadata,
    structured_metadata_options,
)
from sonde.db import experiments as db
from sonde.output import (
    err,
    print_error,
    print_json,
    print_success,
    record_summary,
    styled_status,
)


@click.command("update")
@click.argument("experiment_id", required=False, default=None)
@click.option(
    "--status", type=click.Choice(["open", "running", "complete", "failed", "superseded"])
)
@click.option("--hypothesis", help="Update hypothesis text")
@click.option(
    "--hypothesis-file",
    type=click.Path(exists=True),
    help="Read multiline hypothesis text from file",
)
@click.option("--params", help="Parameters as JSON (merges with existing)")
@click.option(
    "--params-file", "params_file", type=click.Path(exists=True), help="Params from YAML/JSON file"
)
@click.option(
    "--result",
    help="Structured JSON dict (queryable). For narrative, use --results.",
)
@click.option(
    "--result-file",
    "result_file",
    type=click.Path(exists=True),
    help="Structured results from YAML/JSON file",
)
@click.option("--finding", help="Update finding")
@click.option("--content", "-c", "content_text", help="Replace entire content body")
@click.option(
    "--content-file",
    type=click.Path(exists=True),
    help="Replace entire content from file",
)
@click.option("--method", help="Update ## Method section in content")
@click.option(
    "--results",
    "results_text",
    help="Update ## Results narrative section. For JSON, use --result.",
)
@click.option("--direction", help="Set or change the parent research direction")
@click.option("--project", help="Set or change the parent project")
@click.option("--linear", help="Link to a Linear issue ID (e.g. AEO-123)")
@click.option("--close-commit", help="Repair or override the closing git commit")
@click.option("--close-branch", help="Repair or override the closing git branch")
@click.option(
    "--tag",
    multiple=True,
    help="Set tags (REPLACES all). To append: sonde tag add",
)
@structured_metadata_options
@pass_output_options
@click.pass_context
def update(
    ctx: click.Context,
    experiment_id: str | None,
    status: str | None,
    hypothesis: str | None,
    hypothesis_file: str | None,
    params: str | None,
    params_file: str | None,
    result: str | None,
    result_file: str | None,
    finding: str | None,
    content_text: str | None,
    content_file: str | None,
    method: str | None,
    results_text: str | None,
    direction: str | None,
    project: str | None,
    linear: str | None,
    close_commit: str | None,
    close_branch: str | None,
    tag: tuple[str, ...],
    repro: str | None,
    evidence: tuple[str, ...],
    env_vars: tuple[str, ...],
    blocker: str | None,
):
    """Update fields on an existing experiment.

    If no experiment ID is given, uses the focused experiment (sonde focus).

    \b
    Examples:
      sonde update EXP-0042 --status complete --result '{"rmse": 2.3}'
      sonde update --finding "CCN saturates at 1500"
      sonde update --blocker "waiting for GPU allocation"
    """
    from sonde.commands._helpers import resolve_experiment_id

    experiment_id = resolve_experiment_id(experiment_id)

    exp = db.get(experiment_id)
    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    updates: dict[str, Any] = {}
    resolved_hypothesis = hypothesis
    if resolved_hypothesis is None and hypothesis_file:
        resolved_hypothesis = Path(hypothesis_file).read_text(encoding="utf-8").strip()

    if status is not None:
        updates["status"] = status
    if resolved_hypothesis is not None:
        updates["hypothesis"] = resolved_hypothesis
    if finding is not None:
        updates["finding"] = finding
    if direction is not None:
        updates["direction_id"] = direction
    if project is not None:
        updates["project_id"] = project
    if linear is not None:
        updates["linear_id"] = linear
    if close_commit is not None:
        updates["git_close_commit"] = close_commit
    if close_branch is not None:
        updates["git_close_branch"] = close_branch

    # Content
    if content_file:
        updates["content"] = Path(content_file).read_text(encoding="utf-8").strip()
    elif content_text is not None:
        updates["content"] = content_text

    # Section-level content updates (read → patch → write back)
    if method is not None or results_text is not None:
        from sonde.local import update_section

        existing_content = updates.get("content") or exp.content or ""
        if method is not None:
            existing_content = update_section(existing_content, "method", method)
        if results_text is not None:
            existing_content = update_section(existing_content, "results", results_text)
        updates["content"] = existing_content

    if "content" in updates:
        from sonde.local import extract_section_text

        extracted_hypothesis = extract_section_text(str(updates["content"] or ""), "Hypothesis")
        if (
            resolved_hypothesis is not None
            and extracted_hypothesis
            and extracted_hypothesis.strip() != resolved_hypothesis.strip()
        ):
            err.print(
                "  [sonde.warning]Both --hypothesis and ## Hypothesis were provided; "
                "using the explicit field.[/]"
            )
        elif resolved_hypothesis is None and extracted_hypothesis:
            updates["hypothesis"] = extracted_hypothesis

    # Params: merge file + inline with existing
    try:
        new_params = {}
        if params_file:
            new_params = load_dict_file(params_file)
        if params:
            new_params = {**new_params, **json.loads(params)}
        if new_params:
            updates["parameters"] = {**exp.parameters, **new_params}

        new_result = None
        if result_file:
            new_result = load_dict_file(result_file)
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

    # Structured metadata
    if repro or evidence or env_vars or blocker:
        updates["metadata"] = merge_structured_metadata(
            dict(exp.metadata),
            repro=repro,
            evidence=evidence,
            env_vars=env_vars,
            blocker=blocker,
        )

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
        print_success(f"Updated {experiment_id}", record_id=experiment_id)
        summary = record_summary(updated, 80)
        if summary != "—":
            err.print(f"  {summary}")
        if "status" in updates:
            err.print(f"  Status: {styled_status(updates['status'])}")
