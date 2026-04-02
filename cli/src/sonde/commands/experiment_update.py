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
@click.option("--method", help="Update the ## Method section in content")
@click.option("--results", "results_text", help="Update the ## Results section in content")
@click.option("--direction", help="Set or change the parent research direction")
@click.option("--project", help="Set or change the parent project")
@click.option("--linear", help="Link to a Linear issue ID (e.g. AEO-123)")
@click.option("--tag", multiple=True, help="Set tags (replaces existing)")
@structured_metadata_options
@pass_output_options
@click.pass_context
def update(
    ctx: click.Context,
    experiment_id: str | None,
    status: str | None,
    hypothesis: str | None,
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

    if status is not None:
        updates["status"] = status
    if hypothesis is not None:
        updates["hypothesis"] = hypothesis
    if finding is not None:
        updates["finding"] = finding
    if direction is not None:
        updates["direction_id"] = direction
    if project is not None:
        updates["project_id"] = project
    if linear is not None:
        updates["linear_id"] = linear

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
