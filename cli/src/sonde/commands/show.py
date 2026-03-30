"""Polymorphic show command — works with any entity type.

Detects entity type from ID prefix (EXP-, FIND-, Q-, DIR-) and dispatches
to the appropriate display logic. This is the top-level `sonde show <ID>`
that replaces the experiment-only version.
"""

from __future__ import annotations

import click
from rich.panel import Panel

from sonde.db import rows as to_rows
from sonde.db.client import get_client
from sonde.output import (
    _truncate_text,
    err,
    out,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
    record_summary,
    styled_confidence,
    styled_status,
)


def _show_finding(ctx: click.Context, finding_id: str) -> None:
    """Display a finding with its evidence and supersession chain."""
    client = get_client()
    result = client.table("findings").select("*").eq("id", finding_id).execute()
    data = to_rows(result.data)

    if not data:
        print_error(f"Finding {finding_id} not found", "No finding with this ID.", "")
        raise SystemExit(1)

    f = data[0]

    # Fetch evidence experiments
    evidence_exps = []
    evidence_ids = f.get("evidence", [])
    if evidence_ids:
        evidence_exps = to_rows(
            client.table("experiments")
            .select("id,status,program,content,finding")
            .in_("id", evidence_ids)
            .execute()
            .data
        )

    # Fetch supersession chain
    chain = []
    if f.get("supersedes"):
        prev = to_rows(
            client.table("findings")
            .select("id,finding,confidence,valid_from,valid_until")
            .eq("id", f["supersedes"])
            .execute()
            .data
        )
        if prev:
            chain.append(("supersedes", prev[0]))
    if f.get("superseded_by"):
        nxt = to_rows(
            client.table("findings")
            .select("id,finding,confidence,valid_from,valid_until")
            .eq("id", f["superseded_by"])
            .execute()
            .data
        )
        if nxt:
            chain.append(("superseded_by", nxt[0]))

    if ctx.obj.get("json"):
        f["_evidence_experiments"] = evidence_exps
        f["_chain"] = chain
        print_json(f)
        return

    # Header
    is_active = f.get("valid_until") is None
    active_str = "[sonde.success]● active[/]" if is_active else "[sonde.muted]○ superseded[/]"
    confidence = f.get("confidence", "medium")

    created = str(f.get("created_at", ""))[:10]
    header = [
        f"[sonde.heading]{f['id']}[/]  {active_str}  {f.get('program', '')}",
        (
            f"[sonde.muted]Topic: {f.get('topic', '—')}  "
            f"Confidence: {styled_confidence(confidence)}[/]"
        ),
        f"[sonde.muted]Source: {f.get('source', '—')}  Created: {created}[/]",
    ]
    if f.get("valid_from"):
        valid_str = f"Valid from: {str(f['valid_from'])[:10]}"
        if f.get("valid_until"):
            valid_str += f" → {str(f['valid_until'])[:10]}"
        else:
            valid_str += " → present"
        header.append(f"[sonde.muted]{valid_str}[/]")

    header.append(f"\n{f.get('finding', '')}")

    out.print(
        Panel(
            "\n".join(header),
            title=f"[sonde.brand]{f['id']}[/]",
            border_style="sonde.brand.dim",
        )
    )

    # Evidence experiments
    if evidence_exps:
        print_table(
            ["id", "status", "summary"],
            [
                {
                    "id": e["id"],
                    "status": e.get("status", ""),
                    "summary": record_summary(e, 55),
                }
                for e in evidence_exps
            ],
            title="Evidence",
        )

    # Supersession chain
    if chain:
        err.print("\n[sonde.heading]Supersession[/]")
        for rel, item in chain:
            direction = "← supersedes" if rel == "supersedes" else "→ superseded by"
            err.print(
                f"  {direction} {item['id']}  [{item.get('confidence', '')}]  "
                f"{_truncate_text(item.get('finding'), 50)}"
            )

    print_breadcrumbs(
        [
            f"Evidence:  sonde show {evidence_ids[0]}" if evidence_ids else "",
            f"All:       sonde findings -p {f.get('program', '')}",
        ]
    )


def _show_question(ctx: click.Context, question_id: str) -> None:
    """Display a question with promotion context."""
    client = get_client()
    result = client.table("questions").select("*").eq("id", question_id).execute()
    data = to_rows(result.data)

    if not data:
        print_error(f"Question {question_id} not found", "No question with this ID.", "")
        raise SystemExit(1)

    q = data[0]

    if ctx.obj.get("json"):
        print_json(q)
        return

    q_created = str(q.get("created_at", ""))[:10]
    header = [
        (
            f"[sonde.heading]{q['id']}[/]  "
            f"{styled_status(q.get('status', 'open'))}  {q.get('program', '')}"
        ),
        f"[sonde.muted]Raised by: {q.get('source', '—')}  Created: {q_created}[/]",
    ]
    if q.get("tags"):
        header.append(f"[sonde.muted]Tags: {', '.join(q['tags'])}[/]")

    header.append(f"\n{q.get('question', '')}")

    if q.get("context"):
        header.append(f"\n[sonde.heading]Context[/]\n{q['context']}")

    if q.get("promoted_to_id"):
        header.append(
            f"\n[sonde.success]Promoted to {q.get('promoted_to_type', 'experiment')}: "
            f"{q['promoted_to_id']}[/]"
        )

    out.print(
        Panel(
            "\n".join(header),
            title=f"[sonde.brand]{q['id']}[/]",
            border_style="sonde.brand.dim",
        )
    )

    breadcrumbs = [f"All: sonde questions -p {q.get('program', '')}"]
    if q.get("promoted_to_id"):
        breadcrumbs.insert(0, f"Promoted to: sonde show {q['promoted_to_id']}")
    print_breadcrumbs(breadcrumbs)


def _show_direction(ctx: click.Context, direction_id: str) -> None:
    """Display a direction with its experiments and findings."""
    client = get_client()
    result = client.table("directions").select("*").eq("id", direction_id).execute()
    data = to_rows(result.data)

    if not data:
        print_error(f"Direction {direction_id} not found", "No direction with this ID.", "")
        raise SystemExit(1)

    d = data[0]

    # Fetch experiments in this direction
    experiments = to_rows(
        client.table("experiments")
        .select("id,status,program,content,finding,source,tags,created_at")
        .eq("direction_id", direction_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    # Fetch findings from these experiments
    exp_ids = [e["id"] for e in experiments]
    findings = []
    if exp_ids:
        all_findings = to_rows(
            client.table("findings")
            .select("id,finding,confidence,evidence")
            .eq("program", d.get("program", ""))
            .is_("valid_until", "null")
            .execute()
            .data
        )
        findings = [
            f for f in all_findings if any(eid in (f.get("evidence") or []) for eid in exp_ids)
        ]

    if ctx.obj.get("json"):
        d["_experiments"] = experiments
        d["_findings"] = findings
        print_json(d)
        return

    # Stats
    complete = sum(1 for e in experiments if e["status"] == "complete")
    running = sum(1 for e in experiments if e["status"] == "running")
    open_count = sum(1 for e in experiments if e["status"] == "open")

    d_created = str(d.get("created_at", ""))[:10]
    header = [
        (
            f"[sonde.heading]{d['id']}[/]  "
            f"{styled_status(d.get('status', 'active'))}  {d.get('program', '')}"
        ),
        f"[sonde.muted]Source: {d.get('source', '—')}  Created: {d_created}[/]",
        f"[sonde.muted]{complete} complete, {running} running, {open_count} open[/]",
        f"\n[sonde.heading]{d.get('title', '')}[/]",
        f"{d.get('question', '')}",
    ]

    out.print(
        Panel(
            "\n".join(header),
            title=f"[sonde.brand]{d['id']}[/]",
            border_style="sonde.brand.dim",
        )
    )

    # Experiments table
    if experiments:
        exp_rows = []
        for e in experiments:
            source = e.get("source", "")
            if "/" in source:
                source = source.split("/")[-1]
            exp_rows.append(
                {
                    "id": e["id"],
                    "status": e.get("status", ""),
                    "source": source,
                    "summary": record_summary(e, 45),
                }
            )
        print_table(["id", "status", "source", "summary"], exp_rows, title="Experiments")

    # Findings
    if findings:
        print_table(
            ["id", "finding", "confidence"],
            [
                {
                    "id": f["id"],
                    "finding": _truncate_text(f.get("finding"), 50),
                    "confidence": f.get("confidence", ""),
                }
                for f in findings
            ],
            title="Findings from this direction",
        )

    print_breadcrumbs(
        [
            f"List:  sonde list --direction {d['id']}",
            f"Brief: sonde brief -p {d.get('program', '')}",
        ]
    )


def show_dispatch(ctx: click.Context, record_id: str, graph: bool) -> None:
    """Route show to the appropriate handler based on ID prefix."""
    rid = record_id.upper()

    if rid.startswith("FIND-") or rid.startswith("FIN-"):
        _show_finding(ctx, rid)
    elif rid.startswith("Q-") or rid.startswith("QUES-"):
        _show_question(ctx, rid)
    elif rid.startswith("DIR-"):
        _show_direction(ctx, rid)
    elif rid.startswith("EXP-") or rid[0].isdigit():
        # Delegate to experiment show (the original)
        # We import here to avoid circular imports
        ctx.invoke(
            _get_experiment_show(),
            experiment_id=rid,
            graph=graph,
        )
    else:
        # Try as experiment ID anyway
        ctx.invoke(
            _get_experiment_show(),
            experiment_id=rid,
            graph=graph,
        )


def _get_experiment_show():
    """Lazy import to avoid circular dependency."""
    from sonde.commands.experiment import show

    return show
