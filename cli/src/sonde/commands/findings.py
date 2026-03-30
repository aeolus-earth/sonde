"""Findings command — list current research findings."""

from __future__ import annotations

import click

from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.output import (
    _truncate_text,
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
)


@click.command("findings")
@click.option("--program", "-p", help="Filter by program")
@click.option("--confidence", type=click.Choice(["low", "medium", "high"]), help="Filter by confidence")
@click.option("--all", "show_all", is_flag=True, help="Include superseded findings")
@click.option("--limit", "-n", default=50, type=int, help="Max results (default: 50)")
@click.pass_context
def findings_cmd(
    ctx: click.Context,
    program: str | None,
    confidence: str | None,
    show_all: bool,
    limit: int,
) -> None:
    """List current research findings.

    Shows active findings by default. Use --all to include superseded ones.

    \b
    Examples:
      sonde findings -p weather-intervention
      sonde findings --confidence high
      sonde findings --all
      sonde findings --json
    """
    settings = get_settings()
    resolved = program or settings.program or None

    client = get_client()
    query = client.table("findings").select("*").order("created_at", desc=True).limit(limit)

    if resolved:
        query = query.eq("program", resolved)
    if not show_all:
        query = query.is_("valid_until", "null")
    if confidence:
        query = query.eq("confidence", confidence)

    result = query.execute()
    findings_list = rows(result.data)

    if ctx.obj.get("json"):
        print_json(findings_list)
    elif not findings_list:
        err.print("[dim]No findings found.[/dim]")
    else:
        table_rows = []
        for f in findings_list:
            evidence = f.get("evidence", [])
            table_rows.append(
                {
                    "id": f["id"],
                    "finding": _truncate_text(f.get("finding"), 45),
                    "confidence": f.get("confidence", "medium"),
                    "evidence": ", ".join(evidence)[:30] if evidence else "—",
                    "topic": _truncate_text(f.get("topic"), 20),
                }
            )
        print_table(["id", "finding", "confidence", "evidence", "topic"], table_rows)
        err.print(f"\n[dim]{len(findings_list)} finding(s)[/dim]")

        if findings_list:
            first_evidence = (findings_list[0].get("evidence") or [None])[0]
            if first_evidence:
                print_breadcrumbs([f"Show evidence: sonde show {first_evidence}"])
