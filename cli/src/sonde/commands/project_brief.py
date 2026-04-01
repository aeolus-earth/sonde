"""Project brief — auto-generated summary scoped to a project."""

from __future__ import annotations

from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
    styled_status,
    truncate_text,
)


def _build_project_brief(project_id: str) -> dict[str, Any]:
    """Build a project-level brief with directions, experiments, findings, takeaways."""
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db
    from sonde.db import findings as find_db
    from sonde.db import projects as proj_db

    project = proj_db.get(project_id)
    if not project:
        return {}

    # Directions under this project
    dirs = dir_db.list_directions(statuses=None, limit=200)
    project_dirs = [d for d in dirs if getattr(d, "project_id", None) == project_id]

    # Experiments under this project (direct or via direction)
    dir_ids = {d.id for d in project_dirs}
    all_exps = exp_db.list_experiments(statuses=None, limit=500)
    project_exps = [
        e
        for e in all_exps
        if getattr(e, "project_id", None) == project_id
        or getattr(e, "direction_id", None) in dir_ids
    ]
    exp_ids = {e.id for e in project_exps}

    # Findings whose evidence overlaps with project experiments
    all_findings = find_db.list_active(program=project.program)
    project_findings = [f for f in all_findings if set(f.evidence) & exp_ids]

    # Takeaways
    takeaway_body = None
    try:
        from sonde.db import project_takeaways as ptw_db

        ptw = ptw_db.get(project_id)
        if ptw and ptw.body.strip():
            takeaway_body = ptw.body.strip()
    except Exception:
        pass

    # Notes
    notes: list[dict] = []
    try:
        from sonde.db import notes_v2

        notes = notes_v2.list_by_record("project", project_id)
    except Exception:
        pass

    # Stats
    status_counts = {}
    for e in project_exps:
        status_counts[e.status] = status_counts.get(e.status, 0) + 1

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "objective": project.objective,
            "description": getattr(project, "description", None),
            "status": project.status,
            "program": project.program,
        },
        "directions": [
            {
                "id": d.id,
                "title": d.title,
                "question": d.question,
                "context": getattr(d, "context", None),
                "status": d.status,
                "experiment_count": sum(
                    1 for e in project_exps if getattr(e, "direction_id", None) == d.id
                ),
            }
            for d in project_dirs
        ],
        "experiments": {
            "total": len(project_exps),
            "by_status": status_counts,
            "recent": [
                {
                    "id": e.id,
                    "status": e.status,
                    "direction_id": getattr(e, "direction_id", None),
                    "finding": e.finding,
                    "hypothesis": e.hypothesis,
                }
                for e in sorted(
                    project_exps, key=lambda e: e.updated_at or e.created_at, reverse=True
                )[:10]
            ],
        },
        "findings": [
            {
                "id": f.id,
                "topic": f.topic,
                "finding": f.finding,
                "confidence": f.confidence,
            }
            for f in project_findings
        ],
        "takeaways": takeaway_body,
        "notes": [
            {"id": n["id"], "content": truncate_text(n["content"], 200), "source": n.get("source", "")}
            for n in notes[:5]
        ],
    }


@click.command("brief")
@click.argument("project_id")
@pass_output_options
@click.pass_context
def project_brief(ctx: click.Context, project_id: str) -> None:
    """Generate a project-level brief.

    Aggregates directions, experiments, findings, takeaways, and notes
    into a comprehensive project summary.

    \b
    Examples:
      sonde project brief PROJ-001
    """
    project_id = project_id.upper()
    if not project_id.startswith("PROJ-"):
        print_error(
            f"Invalid project ID: {project_id}",
            "Expected a PROJ-* ID.",
            "sonde project list",
        )
        raise SystemExit(2)

    brief = _build_project_brief(project_id)
    if not brief:
        print_error(
            f"Project {project_id} not found",
            "No project with this ID.",
            "sonde project list",
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(brief)
        return

    p = brief["project"]
    err.print(f"\n[sonde.heading]{p['id']}[/]  {styled_status(p['status'])}  {p['program']}")
    err.print(f"[sonde.heading]{p['name']}[/]")
    if p["objective"]:
        err.print(f"{p['objective']}")
    if p.get("description"):
        err.print(f"\n{p['description']}")

    # Takeaways first — the "so what"
    if brief["takeaways"]:
        err.print(f"\n[sonde.heading]Takeaways[/]\n{brief['takeaways']}")

    # Directions
    dirs = brief["directions"]
    if dirs:
        dir_rows = [
            {
                "id": d["id"],
                "status": d["status"],
                "title": truncate_text(d["title"], 40),
                "experiments": str(d["experiment_count"]),
            }
            for d in dirs
        ]
        print_table(["id", "status", "title", "experiments"], dir_rows, title="Directions")
        # Show direction context summaries (if any have context)
        for d in dirs:
            if d.get("context"):
                err.print(f"  [sonde.muted]{d['id']}: {truncate_text(d['context'], 80)}[/]")

    # Experiment stats
    exps = brief["experiments"]
    if exps["total"]:
        parts = [f"{exps['total']} total"]
        for status, count in sorted(exps["by_status"].items()):
            parts.append(f"{count} {status}")
        err.print(f"\n[sonde.heading]Experiments[/]  {', '.join(parts)}")

    # Findings
    findings = brief["findings"]
    if findings:
        print_table(
            ["id", "topic", "finding", "confidence"],
            [
                {
                    "id": f["id"],
                    "topic": f.get("topic", ""),
                    "finding": truncate_text(f["finding"], 50),
                    "confidence": f["confidence"],
                }
                for f in findings
            ],
            title="Findings",
        )

    # Notes
    if brief["notes"]:
        err.print(f"\n[sonde.heading]Notes ({len(brief['notes'])})[/]")
        for n in brief["notes"][:3]:
            err.print(f"  {n['id']}  {truncate_text(n['content'], 60)}")

    print_breadcrumbs([
        f"Details: sonde project show {project_id}",
        f"Takeaways: sonde takeaway --project {project_id} --show",
    ])
