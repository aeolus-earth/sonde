"""Diff command — compare two experiments side-by-side."""

from __future__ import annotations

from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.db import experiments as db
from sonde.output import err, print_error, print_json, print_table


def _dict_diff(left: dict, right: dict) -> dict[str, Any]:
    """Compute a structured diff between two dicts."""
    all_keys = sorted(set(left) | set(right))
    shared = {}
    changed = {}
    only_left = {}
    only_right = {}

    for key in all_keys:
        in_left = key in left
        in_right = key in right
        if in_left and in_right:
            if left[key] == right[key]:
                shared[key] = left[key]
            else:
                entry: dict[str, Any] = {"left": left[key], "right": right[key]}
                # Compute numeric delta if both are numbers
                try:
                    delta = float(right[key]) - float(left[key])
                    entry["delta"] = delta
                except (ValueError, TypeError):
                    pass
                changed[key] = entry
        elif in_left:
            only_left[key] = left[key]
        else:
            only_right[key] = right[key]

    return {
        "shared": shared,
        "changed": changed,
        "only_left": only_left,
        "only_right": only_right,
    }


@click.command("diff")
@click.argument("id_left")
@click.argument("id_right")
@pass_output_options
@click.pass_context
def diff_cmd(ctx: click.Context, id_left: str, id_right: str) -> None:
    """Compare two experiments side-by-side.

    Shows parameter diffs, result diffs, tag differences, and metadata changes.

    \b
    Examples:
      sonde diff EXP-0001 EXP-0002
      sonde experiment diff EXP-0001 EXP-0002 --json
    """
    left = db.get(id_left.upper())
    right = db.get(id_right.upper())

    if not left:
        print_error(f"Experiment {id_left} not found", "No experiment with this ID.", "")
        raise SystemExit(1)
    if not right:
        print_error(f"Experiment {id_right} not found", "No experiment with this ID.", "")
        raise SystemExit(1)

    # Compute diffs — merge parameters + metadata for a unified view
    param_diff = _dict_diff(left.all_params, right.all_params)
    result_diff = _dict_diff(left.results or {}, right.results or {})

    left_tags = set(left.tags)
    right_tags = set(right.tags)
    tag_diff = {
        "shared": sorted(left_tags & right_tags),
        "only_left": sorted(left_tags - right_tags),
        "only_right": sorted(right_tags - left_tags),
    }

    # Metadata fields diff
    field_diff = {}
    for field in ["status", "source", "program", "direction_id", "git_branch"]:
        lv = getattr(left, field)
        rv = getattr(right, field)
        if lv != rv:
            field_diff[field] = {"left": lv, "right": rv}

    if ctx.obj.get("json"):
        print_json(
            {
                "experiments": [left.id, right.id],
                "parameter_diff": param_diff,
                "result_diff": result_diff,
                "tag_diff": tag_diff,
                "field_diff": field_diff,
            }
        )
        return

    # Human-readable output
    err.print(f"\n[sonde.heading]Comparing {left.id} ↔ {right.id}[/]\n")

    # Field differences
    if field_diff:
        rows = []
        for field, vals in field_diff.items():
            rows.append(
                {
                    "field": field,
                    left.id: str(vals["left"] or "—"),
                    right.id: str(vals["right"] or "—"),
                }
            )
        print_table(["field", left.id, right.id], rows, title="Metadata")

    # Parameter diff
    _render_dict_diff("Parameters", param_diff, left.id, right.id)

    # Result diff
    _render_dict_diff("Results", result_diff, left.id, right.id)

    # Tag diff
    if tag_diff["only_left"] or tag_diff["only_right"]:
        err.print("\n[sonde.heading]Tags[/]")
        if tag_diff["shared"]:
            err.print(f"  shared:     {', '.join(tag_diff['shared'])}")
        if tag_diff["only_left"]:
            err.print(f"  {left.id}:  {', '.join(tag_diff['only_left'])}")
        if tag_diff["only_right"]:
            err.print(f"  {right.id}:  {', '.join(tag_diff['only_right'])}")

    # Findings
    if left.finding or right.finding:
        err.print("\n[sonde.heading]Findings[/]")
        err.print(f"  {left.id}: {left.finding or '—'}")
        err.print(f"  {right.id}: {right.finding or '—'}")

    err.print()


def _render_dict_diff(title: str, diff: dict[str, Any], left_id: str, right_id: str) -> None:
    """Render a dict diff as a Rich table."""
    rows = []

    for key, value in sorted(diff["shared"].items()):
        rows.append({"param": key, left_id: str(value), right_id: str(value), "": ""})

    for key, vals in sorted(diff["changed"].items()):
        delta_str = ""
        if "delta" in vals:
            delta = vals["delta"]
            delta_str = f"+{delta}" if delta > 0 else str(delta)
        rows.append(
            {
                "param": key,
                left_id: str(vals["left"]),
                right_id: str(vals["right"]),
                "": f"[sonde.warning]← {delta_str}[/]"
                if delta_str
                else "[sonde.warning]← changed[/]",
            }
        )

    for key, value in sorted(diff["only_left"].items()):
        rows.append({"param": key, left_id: str(value), right_id: "—", "": ""})

    for key, value in sorted(diff["only_right"].items()):
        rows.append({"param": key, left_id: "—", right_id: str(value), "": ""})

    if rows:
        print_table(["param", left_id, right_id, ""], rows, title=title)
