"""Status command — cross-program overview of the knowledge base."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.db import rows
from sonde.db.client import get_client
from sonde.output import (
    _truncate_text,
    err,
    print_breadcrumbs,
    print_json,
    print_table,
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
    client = get_client()

    # Fetch programs
    programs = rows(client.table("programs").select("*").order("id").execute().data)

    # Fetch experiment counts per program
    all_experiments = rows(client.table("experiments").select("id,program,status").execute().data)

    # Fetch active directions
    directions = rows(
        client.table("directions")
        .select("*")
        .in_("status", ["active", "proposed"])
        .order("created_at", desc=True)
        .execute()
        .data
    )

    # Fetch active findings (all programs)
    findings = rows(
        client.table("findings")
        .select("id,program,finding,confidence,topic")
        .is_("valid_until", "null")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )

    # Fetch open questions (all programs)
    questions = rows(
        client.table("questions")
        .select("id,program,question,status")
        .in_("status", ["open", "investigating"])
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )

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
                "directions": directions,
                "findings": findings,
                "questions": questions,
                "total_experiments": len(all_experiments),
            }
        )
        return

    # --- Human-readable output ---

    err.print("\n[sonde.heading]Knowledge Base Overview[/]\n")

    # Programs table
    if programs:
        prog_rows = []
        for p in programs:
            pid = p["id"]
            stats = program_stats.get(pid, {})
            total = stats.get("total", 0)
            complete = stats.get("complete", 0)
            running = stats.get("running", 0)
            open_count = stats.get("open", 0)
            desc = _truncate_text(p.get("description"), 40)
            prog_rows.append(
                {
                    "program": pid,
                    "experiments": str(total),
                    "complete": str(complete),
                    "running": str(running),
                    "open": str(open_count),
                    "description": desc,
                }
            )
        print_table(
            ["program", "experiments", "complete", "running", "open", "description"],
            prog_rows,
            title="Programs",
        )
    else:
        err.print("[dim]No programs found.[/dim]")

    # Active directions
    if directions:
        dir_rows = []
        for d in directions:
            # Count experiments in this direction
            dir_exps = [e for e in all_experiments if e.get("direction_id") == d["id"]]
            dir_rows.append(
                {
                    "id": d["id"],
                    "status": d.get("status", ""),
                    "program": d.get("program", ""),
                    "title": _truncate_text(d.get("title"), 35),
                    "experiments": str(len(dir_exps)),
                }
            )
        print_table(
            ["id", "status", "program", "title", "experiments"],
            dir_rows,
            title="Research Directions",
        )

    # Recent findings
    if findings:
        find_rows = []
        for f in findings:
            find_rows.append(
                {
                    "id": f["id"],
                    "program": f.get("program", ""),
                    "finding": _truncate_text(f.get("finding"), 45),
                    "confidence": f.get("confidence", ""),
                }
            )
        print_table(
            ["id", "program", "finding", "confidence"],
            find_rows,
            title="Active Findings",
        )

    # Open questions
    if questions:
        q_rows = []
        for q in questions:
            q_rows.append(
                {
                    "id": q["id"],
                    "program": q.get("program", ""),
                    "question": _truncate_text(q.get("question"), 50),
                    "status": q.get("status", ""),
                }
            )
        print_table(
            ["id", "program", "question", "status"],
            q_rows,
            title="Open Questions",
        )

    # Summary line
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
