"""Fork command — create a new experiment based on an existing one."""

from __future__ import annotations

import json
from datetime import UTC, datetime

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
@click.option(
    "--clean/--keep-all",
    default=True,
    help="Strip stale inherited fields (default: clean)",
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
    clean: bool,
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

    # Auto-detect git context (single-repo + multi-repo)
    git_ctx = detect_git_context()
    code_ctx = detect_multi_repo_context()

    forked_metadata = merge_structured_metadata(
        dict(source_exp.metadata),
        repro=repro,
        evidence=evidence,
        env_vars=env_vars,
        blocker=blocker,
    )

    clean_params, clean_metadata, stale_warnings = _clean_stale_fields(
        override_params, forked_metadata, strip=clean
    )

    data = ExperimentCreate(
        program=source_exp.program,
        status=status,
        source=resolved_source,
        tags=resolved_tags,
        parameters=clean_params,
        metadata=clean_metadata,
        direction_id=source_exp.direction_id,
        project_id=getattr(source_exp, "project_id", None),
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
        code_context=snapshots_to_json(code_ctx) if code_ctx else None,
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
        data = {
            "created": new_exp.model_dump(mode="json"),
            "siblings": [s.model_dump(mode="json") for s in siblings],
            "parent": source_exp.model_dump(mode="json"),
        }
        if stale_warnings:
            if clean:
                data["_stripped_fields"] = stale_warnings
            else:
                data["_stale_warnings"] = stale_warnings
        print_json(data)
    else:
        type_label = f" ({branch_type})" if branch_type else ""
        print_success(
            f"Forked {source_exp.id} \u2192 {new_exp.id}{type_label}",
            record_id=new_exp.id,
        )
        if override_params != source_exp.parameters:
            changed = {
                k: v for k, v in override_params.items() if source_exp.parameters.get(k) != v
            }
            if changed:
                err.print(f"  Changed: {', '.join(f'{k}={v}' for k, v in changed.items())}")
        if siblings:
            sibling_strs = [f"{s.id} [{s.status}]" for s in siblings]
            err.print(f"  Siblings: {', '.join(sibling_strs)}")

        # Stale field warnings
        if stale_warnings and clean:
            stripped_names = ", ".join(f"{w['source']}.{w['key']}" for w in stale_warnings)
            n = len(stale_warnings)
            err.print(f"\n  [sonde.muted]Stripped {n} stale field(s): {stripped_names}[/]")
            err.print("  [sonde.muted]Use --keep-all to preserve inherited paths[/]")
        elif stale_warnings:
            err.print("\n  [sonde.warning]Inherited fields that may need updating:[/]")
            for w in stale_warnings:
                err.print(f"    [sonde.muted]{w['source']}.{w['key']}[/] = {w['value']}")

        # Content nudge (branch-type-aware)
        if not new_exp.content or (intent and len(intent) < 80):
            from sonde.output import print_nudge

            nudge_msg, nudge_cmd = _fork_content_nudge(new_exp.id, branch_type)
            print_nudge(nudge_msg, nudge_cmd)

        err.print(f"\n  View:    sonde show {new_exp.id}")
        err.print(f"  Start:   sonde start {new_exp.id}")


# ---------------------------------------------------------------------------
# Fork helpers
# ---------------------------------------------------------------------------

_STALE_KEY_PATTERNS = frozenset(
    {
        "dir",
        "path",
        "file",
        "output",
        "log",
        "artifact",
        "result",
        "cache",
        "tmp",
        "scratch",
        "checkpoint",
    }
)


def _is_stale_key(key: str) -> bool:
    """Check if key name contains a stale-indicating word (word-boundary, not substring)."""
    parts = set(key.lower().replace("-", "_").split("_"))
    return bool(parts & _STALE_KEY_PATTERNS)


def _clean_stale_fields(
    params: dict[str, object],
    metadata: dict[str, object],
    *,
    strip: bool = True,
) -> tuple[dict[str, object], dict[str, object], list[dict[str, str]]]:
    """Find and optionally remove inherited fields that look path-like or run-specific.

    Returns (cleaned_params, cleaned_metadata, removed_or_warned_fields).
    """
    warnings: list[dict[str, str]] = []
    cleaned_params = dict(params)
    cleaned_metadata = dict(metadata)

    for source_name, d, cleaned in [
        ("parameters", params, cleaned_params),
        ("metadata", metadata, cleaned_metadata),
    ]:
        for key, value in d.items():
            if not isinstance(value, str):
                continue
            is_path_key = _is_stale_key(key)
            is_path_value = "/" in value
            if is_path_key and is_path_value:
                warnings.append({"source": source_name, "key": key, "value": value})
                if strip:
                    del cleaned[key]

    return cleaned_params, cleaned_metadata, warnings


def _fork_content_nudge(exp_id: str, branch_type: str | None) -> tuple[str, str]:
    """Return (message, command) nudge tailored to the branch type."""
    if branch_type == "debug":
        return (
            "Document the bug you're investigating:",
            f'sonde update {exp_id} "## Observed\\n<what went wrong>\\n\\n'
            f'## Repro\\n<exact command>\\n\\n## Hypothesis\\n<suspected cause>"',
        )
    if branch_type == "refinement":
        return (
            "Document what changed from the parent:",
            f'sonde update {exp_id} "## Changed\\n<what is different>\\n\\n'
            f'## Hypothesis\\n<why this should improve results>"',
        )
    if branch_type == "alternative":
        return (
            "Document the alternative approach:",
            f'sonde update {exp_id} "## Alternative\\n<different approach>\\n\\n'
            f'## Comparison\\n<how to compare against parent>"',
        )
    return (
        "Document what you're testing:",
        f'sonde update {exp_id} --method "<procedure, params, expected outcome>"',
    )
