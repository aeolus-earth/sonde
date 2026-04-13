"""Findings command — list current research findings."""

from __future__ import annotations

import click

from sonde.cli_options import pass_output_options
from sonde.config import get_settings
from sonde.db import findings as db
from sonde.finding_utils import is_operational_finding, sort_operational_first
from sonde.models.finding import FINDING_CONFIDENCE_VALUES, FINDING_IMPORTANCE_VALUES
from sonde.output import (
    err,
    print_breadcrumbs,
    print_json,
    print_table,
    truncate_text,
)


@click.command("findings")
@click.option("--program", "-p", help="Filter by program")
@click.option(
    "--confidence",
    type=click.Choice(list(FINDING_CONFIDENCE_VALUES)),
    help="Filter by confidence",
)
@click.option(
    "--importance",
    type=click.Choice(list(FINDING_IMPORTANCE_VALUES)),
    help="Filter by importance",
)
@click.option("--topic", help="Filter by topic (case-insensitive substring match)")
@click.option("--operational", is_flag=True, help="Only show Gotcha:/Checklist: findings")
@click.option("--all", "show_all", is_flag=True, help="Include superseded findings")
@click.option("--chain", is_flag=True, help="Show supersession chain for findings")
@click.option("--count", "show_count", is_flag=True, help="Show only the count")
@click.option("--limit", "-n", default=50, type=int, help="Max results (default: 50)")
@click.option("--offset", default=0, type=int, help="Skip first N results")
@pass_output_options
@click.pass_context
def findings_cmd(
    ctx: click.Context,
    program: str | None,
    confidence: str | None,
    importance: str | None,
    topic: str | None,
    operational: bool,
    show_all: bool,
    chain: bool,
    show_count: bool,
    limit: int,
    offset: int,
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
    # When --chain is used, fetch all (including superseded) for chain assembly
    fetch_all = show_all or chain

    if show_count:
        if operational:
            total = len(
                [
                    f
                    for f in db.list_findings(
                        program=resolved,
                        confidence=confidence,
                        importance=importance,
                        topic=topic,
                        include_superseded=fetch_all,
                        limit=10000,
                    )
                    if is_operational_finding(f)
                ]
            )
        else:
            total = db.count_findings(
                program=resolved,
                confidence=confidence,
                importance=importance,
                topic=topic,
                include_superseded=fetch_all,
            )
        if ctx.obj.get("json"):
            print_json({"count": total})
        else:
            click.echo(total)
        return

    findings_list = db.list_findings(
        program=resolved,
        confidence=confidence,
        importance=importance,
        topic=topic,
        include_superseded=fetch_all,
        limit=limit,
        offset=offset,
    )
    findings_list = sort_operational_first(findings_list)
    if operational:
        findings_list = [f for f in findings_list if is_operational_finding(f)]

    if chain and findings_list:
        _render_chain(ctx, findings_list)
        return

    if ctx.obj.get("json"):
        print_json([f.model_dump(mode="json") for f in findings_list])
    elif not findings_list:
        err.print("[dim]No findings found.[/dim]")
        print_breadcrumbs(
            [
                "Create: sonde finding create -p <program> --topic '...' --finding '...'",
                "Experiment findings: sonde list --complete",
            ]
        )
    else:
        table_rows = []
        for f in findings_list:
            table_rows.append(
                {
                    "id": f.id,
                    "finding": truncate_text(f.finding, 45),
                    "confidence": f.confidence,
                    "importance": f.importance,
                    "evidence": ", ".join(f.evidence)[:30] if f.evidence else "—",
                    "topic": truncate_text(f.topic, 20),
                }
            )
        print_table(
            ["id", "finding", "confidence", "importance", "evidence", "topic"],
            table_rows,
        )
        err.print(f"\n[dim]{len(findings_list)} finding(s)[/dim]")

        first_evidence = (findings_list[0].evidence or [None])[0]
        if first_evidence:
            print_breadcrumbs([f"Show evidence: sonde show {first_evidence}"])


def _render_chain(ctx: click.Context, findings_list: list) -> None:
    """Render findings as supersession chains."""
    from sonde.models.finding import Finding

    by_id = {f.id: f for f in findings_list}

    roots = [f for f in findings_list if f.supersedes is None or f.supersedes not in by_id]

    chains: list[list[Finding]] = []
    visited: set[str] = set()
    for root in roots:
        if root.id in visited:
            continue
        chain_items: list[Finding] = []
        current: Finding | None = root
        while current:
            chain_items.append(current)
            visited.add(current.id)
            current = by_id.get(current.superseded_by) if current.superseded_by else None
        if chain_items:
            chains.append(chain_items)

    for f in findings_list:
        if f.id not in visited:
            chains.append([f])
            visited.add(f.id)

    if ctx.obj.get("json"):
        print_json(
            [
                {
                    "chain": [
                        {
                            "id": f.id,
                            "finding": f.finding,
                            "confidence": f.confidence,
                            "importance": f.importance,
                            "topic": f.topic,
                            "evidence": f.evidence,
                            "valid_from": f.valid_from.isoformat() if f.valid_from else None,
                            "valid_until": f.valid_until.isoformat() if f.valid_until else None,
                            "superseded_by": f.superseded_by,
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
        topic_label = chain_items[0].topic or "Untitled"
        err.print(f"\n[sonde.heading]Finding Chain — {topic_label}[/]\n")
        for f in chain_items:
            created = f.created_at.strftime("%Y-%m-%d") if f.created_at else ""
            evidence = ", ".join(f.evidence)
            is_current = f.valid_until is None

            marker = "[green]●[/] current" if is_current else ""
            err.print(
                f"  [sonde.brand]{f.id}[/]  {created}  [{f.confidence}/{f.importance}]  {f.finding}"
            )
            if evidence:
                err.print(f"        Evidence: {evidence}")
            if f.superseded_by:
                err.print(f"        [dim]↓ superseded by {f.superseded_by}[/]")
            elif is_current:
                err.print(f"        {marker}")
            err.print()

        if len(chain_items) > 1:
            first_conf = chain_items[0].confidence
            last_conf = chain_items[-1].confidence
            err.print(
                f"  [dim]{len(chain_items)} revision(s). Confidence: {first_conf} → {last_conf}[/]"
            )
