"""Status command — cross-program overview of the knowledge base."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.db import directions as dir_db
from sonde.db import experiments as exp_db
from sonde.db import findings as find_db
from sonde.db import programs as prog_db
from sonde.db import questions as q_db
from sonde.output import (
    err,
    print_breadcrumbs,
    print_json,
    print_table,
    truncate_text,
)


@click.command()
@pass_output_options
@click.pass_context
def status(ctx: click.Context) -> None:
    """Show an overview of the entire knowledge base.

    Lists all programs, recent experiments, active findings, and open questions
    across the whole organization. No --program flag needed.

    \b
    Examples:
      sonde status
      sonde status --json
    """
    programs = prog_db.list_programs()
    all_experiments = exp_db.list_summary()
    directions = dir_db.list_active()
    findings = find_db.list_active(limit=10)
    questions = q_db.list_questions(limit=10)

    # Aggregate experiment stats per program
    program_stats: dict[str, dict[str, int]] = {}
    for exp in all_experiments:
        prog = exp["program"]
        if prog not in program_stats:
            program_stats[prog] = {"total": 0, "open": 0, "running": 0, "complete": 0, "failed": 0}
        program_stats[prog]["total"] += 1
        st = exp["status"]
        if st in program_stats[prog]:
            program_stats[prog][st] += 1

    if ctx.obj.get("json"):
        print_json(
            {
                "programs": [
                    {
                        "id": p["id"],
                        "description": p.get("description", ""),
                        "stats": program_stats.get(p["id"], {}),
                    }
                    for p in programs
                ],
                "directions": [d.model_dump(mode="json") for d in directions],
                "findings": [f.model_dump(mode="json") for f in findings],
                "questions": [q.model_dump(mode="json") for q in questions],
                "total_experiments": len(all_experiments),
            }
        )
        return

    # --- Human-readable output ---

    err.print("\n[sonde.heading]Knowledge Base Overview[/]\n")

    if programs:
        prog_rows = []
        for p in programs:
            pid = p["id"]
            stats = program_stats.get(pid, {})
            prog_rows.append(
                {
                    "program": pid,
                    "experiments": str(stats.get("total", 0)),
                    "complete": str(stats.get("complete", 0)),
                    "running": str(stats.get("running", 0)),
                    "open": str(stats.get("open", 0)),
                    "description": truncate_text(p.get("description"), 40),
                }
            )
        print_table(
            ["program", "experiments", "complete", "running", "open", "description"],
            prog_rows,
            title="Programs",
        )
    else:
        err.print("[dim]No programs found.[/dim]")

    if directions:
        dir_rows = []
        for d in directions:
            dir_exps = [e for e in all_experiments if e.get("direction_id") == d.id]
            dir_rows.append(
                {
                    "id": d.id,
                    "status": d.status,
                    "program": d.program,
                    "title": truncate_text(d.title, 35),
                    "experiments": str(len(dir_exps)),
                }
            )
        print_table(
            ["id", "status", "program", "title", "experiments"],
            dir_rows,
            title="Research Directions",
        )

    if findings:
        print_table(
            ["id", "program", "finding", "confidence"],
            [
                {
                    "id": f.id,
                    "program": f.program,
                    "finding": truncate_text(f.finding, 45),
                    "confidence": f.confidence,
                }
                for f in findings
            ],
            title="Active Findings",
        )

    if questions:
        print_table(
            ["id", "program", "question", "status"],
            [
                {
                    "id": q.id,
                    "program": q.program,
                    "question": truncate_text(q.question, 50),
                    "status": q.status,
                }
                for q in questions
            ],
            title="Open Questions",
        )

    total = len(all_experiments)
    err.print(
        f"\n[sonde.muted]{total} experiment(s) across {len(programs)} program(s), "
        f"{len(findings)} active finding(s), {len(questions)} open question(s)[/]"
    )

    print_breadcrumbs(
        [
            "Drill down:  sonde brief -p <program>",
            "Experiments: sonde list -p <program>",
            "Activity:    sonde recent",
        ]
    )
