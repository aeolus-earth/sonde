"""Findings command — list current research findings."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import rows
from sonde.db.client import get_client
from sonde.output import (
    _truncate_text,
    err,
    print_breadcrumbs,
    print_json,
    print_table,
)


@click.command("findings")
@click.option("--program", "-p", help="Filter by program")
@click.option(
    "--confidence",
    type=click.Choice(["low", "medium", "high"]),
    help="Filter by confidence",
)
@click.option("--topic", help="Filter by topic (case-insensitive substring match)")
@click.option("--all", "show_all", is_flag=True, help="Include superseded findings")
@click.option("--chain", is_flag=True, help="Show supersession chain for findings")
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=50, type=int, help="Max results (default: 50)")
@pass_output_options
@click.pass_context
def findings_cmd(
    ctx: click.Context,
    program: str | None,
    confidence: str | None,
    topic: str | None,
    show_all: bool,
    chain: bool,
    show_count: bool,
    limit: int,
) -> None:
    """List current research findings.

    Shows active findings by default. Use --all to include superseded ones.

    \b
    Examples:
      sonde findings -p weather-intervention
      sonde findings --confidence high
      sonde findings --topic "CCN saturation"
      sonde findings --topic "CCN" --chain
      sonde findings --all
      sonde findings --count
    """
    settings = get_settings()
    resolved = program or settings.program or None

    client = get_client()
    # When --chain is used, fetch all (including superseded) for chain assembly
    fetch_all = show_all or chain
    query = client.table("findings").select("*").order("created_at", desc=True).limit(limit)

    if resolved:
        query = query.eq("program", resolved)
    if not fetch_all:
        query = query.is_("valid_until", "null")
    if confidence:
        query = query.eq("confidence", confidence)
    if topic:
        query = query.ilike("topic", f"%{topic}%")

    result = query.execute()
    findings_list = rows(result.data)

    if show_count:
        if ctx.obj.get("json"):
            print_json({"count": len(findings_list)})
        else:
            click.echo(len(findings_list))
        return

    if chain and findings_list:
        # Build supersession chains
        _render_chain(ctx, findings_list)
        return

    if ctx.obj.get("json"):
        print_json(findings_list)
    elif not findings_list:
        err.print("[dim]No findings found.[/dim]")
        print_breadcrumbs([
            "Create: sonde finding create -p <program> --topic '...' --finding '...'",
            "Experiment findings: sonde list --complete",
        ])
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


def _render_chain(ctx: click.Context, findings_list: list[dict]) -> None:
    """Render findings as supersession chains."""
    # Index by ID
    by_id = {f["id"]: f for f in findings_list}

    # Find chain roots (findings that are not superseded by anything in our set)
    roots = [
        f for f in findings_list if f.get("supersedes") is None or f.get("supersedes") not in by_id
    ]

    # Build chains from roots
    chains: list[list[dict]] = []
    visited: set[str] = set()
    for root in roots:
        if root["id"] in visited:
            continue
        chain_items = []
        current = root
        while current:
            chain_items.append(current)
            visited.add(current["id"])
            next_id = current.get("superseded_by")
            current = by_id.get(next_id) if next_id else None
        if chain_items:
            chains.append(chain_items)

    # Add orphans (not in any chain)
    for f in findings_list:
        if f["id"] not in visited:
            chains.append([f])
            visited.add(f["id"])

    if ctx.obj.get("json"):
        print_json(
            [
                {
                    "chain": [
                        {
                            "id": f["id"],
                            "finding": f.get("finding"),
                            "confidence": f.get("confidence"),
                            "topic": f.get("topic"),
                            "evidence": f.get("evidence", []),
                            "valid_from": f.get("valid_from"),
                            "valid_until": f.get("valid_until"),
                            "superseded_by": f.get("superseded_by"),
                        }
                        for f in chain_items
                    ],
                    "revisions": len(chain_items),
                }
                for chain_items in chains
            ]
        )
        return

    for chain_items in chains:
        topic_label = chain_items[0].get("topic") or "Untitled"
        err.print(f"\n[sonde.heading]Finding Chain — {topic_label}[/]\n")
        for f in chain_items:
            created = f.get("created_at", "")[:10]
            confidence = f.get("confidence", "medium")
            finding_text = f.get("finding", "")
            evidence = ", ".join(f.get("evidence", []))
            is_current = f.get("valid_until") is None

            marker = "[green]●[/] current" if is_current else ""
            err.print(f"  [sonde.brand]{f['id']}[/]  {created}  [{confidence}]  {finding_text}")
            if evidence:
                err.print(f"        Evidence: {evidence}")
            if f.get("superseded_by"):
                err.print(f"        [dim]↓ superseded by {f['superseded_by']}[/]")
            elif is_current:
                err.print(f"        {marker}")
            err.print()

        if len(chain_items) > 1:
            first_conf = chain_items[0].get("confidence", "?")
            last_conf = chain_items[-1].get("confidence", "?")
            err.print(
                f"  [dim]{len(chain_items)} revision(s). Confidence: {first_conf} → {last_conf}[/]"
            )
