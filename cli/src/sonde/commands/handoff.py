"""Handoff command — generate a concise summary for the next agent or engineer."""

from __future__ import annotations

from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.commands._helpers import resolve_experiment_id
from sonde.output import (
    err,
    print_error,
    print_json,
    record_summary,
    truncate_text,
)


@click.command("handoff")
@click.argument("experiment_id", required=False, default=None)
@pass_output_options
@click.pass_context
def handoff(ctx: click.Context, experiment_id: str | None) -> None:
    """Generate a handoff summary for an experiment.

    Produces a compact summary optimized for the next agent or engineer
    picking up the work. Includes experiment state, direction, notes,
    artifacts, findings, and suggested next actions.

    Falls back to the focused experiment if no ID is given.

    \b
    Examples:
      sonde handoff EXP-0164
      sonde handoff --json
      sonde handoff EXP-0164 --json
    """
    from sonde.db import artifacts as art_db
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db
    from sonde.db import findings as find_db
    from sonde.db import notes as notes_db
    from sonde.commands.next import build_suggestions

    experiment_id = resolve_experiment_id(experiment_id)
    exp = exp_db.get(experiment_id)
    if not exp:
        print_error(
            f"{experiment_id} not found",
            "No experiment with this ID exists.",
            "List experiments: sonde list",
        )
        raise SystemExit(1)

    data = _build_handoff_data(exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions)

    if ctx.obj.get("json"):
        print_json(data)
        return

    _render_handoff(data)


def _build_handoff_data(exp, exp_db, dir_db, find_db, notes_db, art_db, build_suggestions) -> dict[str, Any]:
    """Assemble handoff data for an experiment."""
    # Direction context
    direction = None
    if exp.direction_id:
        d = dir_db.get(exp.direction_id)
        if d:
            direction = {"id": d.id, "title": d.title, "question": d.question}

    # Parent info
    parent_summary = None
    if exp.parent_id:
        parent = exp_db.get(exp.parent_id)
        if parent:
            parent_summary = {
                "id": parent.id,
                "status": parent.status,
                "summary": record_summary(parent, 120),
            }

    # Children and siblings
    children = exp_db.get_children(exp.id)
    siblings = exp_db.get_siblings(exp.id) if exp.parent_id else []

    # Notes (last 5)
    notes = notes_db.list_by_experiment(exp.id)
    recent_notes = [
        {
            "content": truncate_text(n.get("content", ""), 200),
            "source": n.get("source", ""),
            "created_at": n.get("created_at", ""),
        }
        for n in (notes[:5] if notes else [])
    ]

    # Artifacts
    artifacts = art_db.list_artifacts(exp.id)
    artifact_list = [
        {
            "id": a.get("id", ""),
            "filename": a.get("filename", ""),
            "type": a.get("type", ""),
            "size_bytes": a.get("size_bytes"),
        }
        for a in (artifacts or [])
    ]

    # Findings citing this experiment
    all_findings = find_db.list_active(program=exp.program)
    related_findings = [
        {
            "id": f.id,
            "finding": truncate_text(f.finding, 120),
            "confidence": f.confidence,
        }
        for f in all_findings
        if exp.id in (f.evidence or [])
    ]

    # Next actions
    from sonde.commands.lifecycle import _suggest_next
    suggestions = _suggest_next(exp, children, siblings)

    return {
        "experiment": {
            "id": exp.id,
            "status": exp.status,
            "program": exp.program,
            "summary": record_summary(exp, 200),
            "content": exp.content,
            "parameters": exp.parameters,
            "finding": exp.finding,
            "direction_id": exp.direction_id,
            "parent_id": exp.parent_id,
            "branch_type": exp.branch_type,
            "tags": exp.tags,
            "source": exp.source,
            "claimed_by": exp.claimed_by,
            "updated_at": exp.updated_at.isoformat() if exp.updated_at else None,
            "created_at": exp.created_at.isoformat() if exp.created_at else None,
        },
        "direction": direction,
        "parent": parent_summary,
        "children": [
            {"id": c.id, "status": c.status, "branch_type": c.branch_type}
            for c in children
        ],
        "siblings": [
            {"id": s.id, "status": s.status, "branch_type": s.branch_type}
            for s in siblings
        ],
        "notes": recent_notes,
        "artifacts": artifact_list,
        "findings": related_findings,
        "own_finding": exp.finding,
        "suggested_next": suggestions,
    }


def _render_handoff(data: dict) -> None:
    """Render handoff as compact human-readable output."""
    exp = data["experiment"]

    # Header
    err.print(f"\n[sonde.heading]Handoff: {exp['id']}[/]")
    parts = [f"Status: [sonde.{exp['status']}]{exp['status']}[/]", f"Program: {exp['program']}"]
    if exp["branch_type"] and exp["parent_id"]:
        parts.append(f"Branch: {exp['branch_type']} of {exp['parent_id']}")
    err.print(f"  {'  |  '.join(parts)}")

    if data["direction"]:
        d = data["direction"]
        err.print(f"  Direction: [sonde.brand]{d['id']}[/] — {d['title']}")
        if d.get("question"):
            err.print(f"  Question: {truncate_text(d['question'], 80)}")

    # Content
    if exp.get("content"):
        err.print(f"\n  [sonde.heading]Context[/]")
        for line in truncate_text(exp["content"], 300).split("\n")[:6]:
            err.print(f"    {line}")

    # Parameters
    if exp.get("parameters"):
        err.print(f"\n  [sonde.heading]Parameters[/]")
        for k, v in exp["parameters"].items():
            err.print(f"    {k}: {v}")

    # Own finding
    if data.get("own_finding"):
        err.print(f"\n  [sonde.heading]Finding[/]")
        err.print(f"    {truncate_text(data['own_finding'], 200)}")

    # Notes
    if data["notes"]:
        err.print(f"\n  [sonde.heading]Recent notes ({len(data['notes'])})[/]")
        for n in data["notes"]:
            ts = n["created_at"][:16] if n["created_at"] else "—"
            source = n["source"].split("/")[-1] if "/" in n["source"] else n["source"]
            err.print(f"    {ts}  {source}  {truncate_text(n['content'], 80)}")

    # Artifacts
    if data["artifacts"]:
        err.print(f"\n  [sonde.heading]Artifacts ({len(data['artifacts'])})[/]")
        for a in data["artifacts"]:
            size = ""
            if a.get("size_bytes"):
                kb = a["size_bytes"] / 1024
                size = f" ({kb:.1f} KB)" if kb < 1024 else f" ({kb/1024:.1f} MB)"

            err.print(f"    {a['id']}  {a['type']}  {a['filename']}{size}")

    # Related findings
    if data["findings"]:
        err.print(f"\n  [sonde.heading]Related findings[/]")
        for f in data["findings"]:
            err.print(f"    {f['id']} — {f['finding']} [{f['confidence']}]")

    # Tree context
    if data["parent"]:
        p = data["parent"]
        err.print(f"\n  [sonde.heading]Tree[/]")
        err.print(f"    Parent: {p['id']} [{p['status']}] {p['summary']}")
    if data["children"]:
        err.print(f"    Children: {', '.join(c['id'] + ' [' + c['status'] + ']' for c in data['children'])}")
    if data["siblings"]:
        err.print(f"    Siblings: {', '.join(s['id'] + ' [' + s['status'] + ']' for s in data['siblings'])}")

    # Suggested next
    if data["suggested_next"]:
        err.print(f"\n  [sonde.heading]Next[/]")
        for s in data["suggested_next"][:3]:
            err.print(f"    [sonde.brand]{s['command']}[/]")
            err.print(f"      [sonde.muted]{s['reason']}[/]")

    err.print()
