"""Fork command — create a new experiment based on an existing one."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import click
import yaml

from sonde.auth import resolve_source
from sonde.cli_options import pass_output_options
from sonde.commands._helpers import load_dict_file, merge_structured_metadata, structured_metadata_options
from sonde.config import get_settings
from sonde.db import experiments as db
from sonde.git import detect_git_context
from sonde.models.experiment import BRANCH_TYPES, ExperimentCreate
from sonde.output import (
    err,
    print_error,
    print_json,
    print_success,
)


@click.command("fork")
@click.argument("experiment_id")
@click.option("--params", help="Override parameters as JSON (merges with source)")
@click.option(
    "--params-file", "params_file", type=click.Path(exists=True), help="Override params from file"
)
@click.option("--tag", multiple=True, help="Override tags (replaces source tags if provided)")
@click.option("--add-tag", "add_tags", multiple=True, help="Add tag(s) to inherited set")
@click.option("--drop-tag", "drop_tags", multiple=True, help="Remove tag(s) from inherited set")
@click.option("--status", default="open", type=click.Choice(["open", "running"]))
@click.option(
    "--type",
    "branch_type",
    type=click.Choice(list(BRANCH_TYPES)),
    help="Branch type",
)
@click.argument("intent", required=False, default=None)
@structured_metadata_options
@pass_output_options
@click.pass_context
def fork(
    ctx: click.Context,
    experiment_id: str,
    params: str | None,
    params_file: str | None,
    tag: tuple[str, ...],
    add_tags: tuple[str, ...],
    drop_tags: tuple[str, ...],
    status: str,
    branch_type: str | None,
    intent: str | None,
    repro: str | None,
    evidence: tuple[str, ...],
    env_vars: tuple[str, ...],
    blocker: str | None,
):
    """Create a new experiment based on an existing one.

    Copies program, tags, parameters, direction, and data_sources from the
    source experiment. The new experiment links back via 'related' and sets
    parent_id for tree branching.

    \b
    Examples:
      sonde fork EXP-0001
      sonde fork EXP-0001 --type refinement "Increase CCN to 1800"
      sonde fork EXP-0001 --params '{"ccn": 1800}'
      sonde fork EXP-0001 --tag subtropical --tag high-ccn
      sonde fork EXP-0001 --drop-tag qrain --add-tag multigate
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
            override_params = {**override_params, **load_dict_file(params_file)}
        if params:
            override_params = {**override_params, **json.loads(params)}
    except json.JSONDecodeError as e:
        print_error("Invalid JSON", str(e), "Check your --params value")
        raise SystemExit(2) from None
    except (yaml.YAMLError, OSError) as e:
        print_error("Failed to read file", str(e), "Check your --params-file path")
        raise SystemExit(2) from None

    if tag:
        # Full replace — --tag takes precedence
        resolved_tags = list(tag)
        if add_tags or drop_tags:
            err.print("  [sonde.warning]--tag replaces all tags; --add-tag/--drop-tag ignored[/]")
    else:
        # Inherit from source, then apply incremental edits
        resolved_tags = list(source_exp.tags)
        if drop_tags:
            resolved_tags = [t for t in resolved_tags if t not in drop_tags]
        if add_tags:
            resolved_tags.extend(t for t in add_tags if t not in resolved_tags)

    # Resolve source
    settings = get_settings()
    resolved_source = settings.source or resolve_source()

    # Auto-detect git context
    git_ctx = detect_git_context()

    forked_metadata = merge_structured_metadata(
        dict(source_exp.metadata),
        repro=repro, evidence=evidence, env_vars=env_vars, blocker=blocker,
    )

    data = ExperimentCreate(
        program=source_exp.program,
        status=status,
        source=resolved_source,
        tags=resolved_tags,
        parameters=override_params,
        metadata=forked_metadata,
        direction_id=source_exp.direction_id,
        data_sources=list(source_exp.data_sources),
        related=[source_exp.id],
        parent_id=source_exp.id,
        branch_type=branch_type,
        content=intent if intent else None,
        git_commit=git_ctx.commit if git_ctx else None,
        git_repo=git_ctx.repo if git_ctx else None,
        git_branch=git_ctx.branch if git_ctx else None,
        claimed_by=resolved_source if status == "running" else None,
        claimed_at=datetime.now(UTC) if status == "running" else None,
    )

    new_exp = db.create(data)

    # Fetch siblings (other children of the same parent, excluding this new one)
    siblings = db.get_children(source_exp.id)
    siblings = [s for s in siblings if s.id != new_exp.id]

    from sonde.db.activity import log_activity

    log_activity(
        new_exp.id,
        "experiment",
        "created",
        {"forked_from": source_exp.id, "branch_type": branch_type},
    )

    if ctx.obj.get("json"):
        print_json(
            {
                "created": new_exp.model_dump(mode="json"),
                "siblings": [s.model_dump(mode="json") for s in siblings],
                "parent": source_exp.model_dump(mode="json"),
            }
        )
    else:
        type_label = f" ({branch_type})" if branch_type else ""
        print_success(f"Forked {source_exp.id} → {new_exp.id}{type_label}")
        if override_params != source_exp.parameters:
            changed = {
                k: v for k, v in override_params.items() if source_exp.parameters.get(k) != v
            }
            if changed:
                err.print(f"  Changed: {', '.join(f'{k}={v}' for k, v in changed.items())}")
        if siblings:
            sibling_strs = [f"{s.id} [{s.status}]" for s in siblings]
            err.print(f"  Siblings: {', '.join(sibling_strs)}")
        err.print(f"\n  View:    sonde show {new_exp.id}")
        err.print(f"  Start:   sonde start {new_exp.id}")
