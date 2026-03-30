"""Polymorphic show command — works with any entity type.

Detects entity type from ID prefix (EXP-, FIND-, Q-, DIR-) and dispatches
to the appropriate display logic. This is the top-level `sonde show <ID>`
that replaces the experiment-only version.
"""

from __future__ import annotations

import click
from rich.panel import Panel

from sonde.output import (
    err,
    out,
    print_breadcrumbs,
    print_error,
    print_json,
    print_table,
    record_summary,
    styled_confidence,
    styled_status,
    truncate_text,
)


def _show_finding(ctx: click.Context, finding_id: str) -> None:
    """Display a finding with its evidence and supersession chain."""
    from sonde.db import experiments as exp_db
    from sonde.db import findings as db

    f = db.get(finding_id)
    if not f:
        print_error(
            f"Finding {finding_id} not found",
            "No finding with this ID.",
            "List findings: sonde findings",
        )
        raise SystemExit(1)

    # Fetch evidence experiments
    evidence_exps = exp_db.get_by_ids(f.evidence) if f.evidence else []

    # Fetch supersession chain
    from sonde.models.finding import Finding

    chain: list[tuple[str, Finding]] = []
    if f.supersedes:
        prev = db.get(f.supersedes)
        if prev:
            chain.append(("supersedes", prev))
    if f.superseded_by:
        nxt = db.get(f.superseded_by)
        if nxt:
            chain.append(("superseded_by", nxt))

    if ctx.obj.get("json"):
        data = f.model_dump(mode="json")
        data["_evidence_experiments"] = [e.model_dump(mode="json") for e in evidence_exps]
        data["_chain"] = [{"relation": rel, **item.model_dump(mode="json")} for rel, item in chain]
        print_json(data)
        return

    # Header
    is_active = f.valid_until is None
    active_str = "[sonde.success]● active[/]" if is_active else "[sonde.muted]○ superseded[/]"

    created = f.created_at.strftime("%Y-%m-%d") if f.created_at else ""
    header = [
        f"[sonde.heading]{f.id}[/]  {active_str}  {f.program}",
        f"[sonde.muted]Topic: {f.topic or '—'}  Confidence: {styled_confidence(f.confidence)}[/]",
        f"[sonde.muted]Source: {f.source or '—'}  Created: {created}[/]",
    ]
    if f.valid_from:
        valid_str = f"Valid from: {f.valid_from.strftime('%Y-%m-%d')}"
        valid_str += f" → {f.valid_until.strftime('%Y-%m-%d')}" if f.valid_until else " → present"
        header.append(f"[sonde.muted]{valid_str}[/]")

    header.append(f"\n{f.finding}")

    out.print(
        Panel("\n".join(header), title=f"[sonde.brand]{f.id}[/]", border_style="sonde.brand.dim")
    )

    if evidence_exps:
        print_table(
            ["id", "status", "summary"],
            [
                {"id": e.id, "status": e.status, "summary": record_summary(e, 55)}
                for e in evidence_exps
            ],
            title="Evidence",
        )

    if chain:
        err.print("\n[sonde.heading]Supersession[/]")
        for rel, item in chain:
            direction = "← supersedes" if rel == "supersedes" else "→ superseded by"
            err.print(
                f"  {direction} {item.id}  [{item.confidence}]  {truncate_text(item.finding, 50)}"
            )

    print_breadcrumbs(
        [
            f"Evidence:  sonde show {f.evidence[0]}" if f.evidence else "",
            f"All:       sonde findings -p {f.program}",
        ]
    )


def _show_question(ctx: click.Context, question_id: str) -> None:
    """Display a question with promotion context."""
    from sonde.db import questions as db

    q = db.get(question_id)
    if not q:
        print_error(
            f"Question {question_id} not found",
            "No question with this ID.",
            "List questions: sonde questions",
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(q.model_dump(mode="json"))
        return

    q_created = q.created_at.strftime("%Y-%m-%d") if q.created_at else ""
    header = [
        f"[sonde.heading]{q.id}[/]  {styled_status(q.status)}  {q.program}",
        f"[sonde.muted]Raised by: {q.source or '—'}  Created: {q_created}[/]",
    ]
    if q.tags:
        header.append(f"[sonde.muted]Tags: {', '.join(q.tags)}[/]")

    header.append(f"\n{q.question}")

    if q.context:
        header.append(f"\n[sonde.heading]Context[/]\n{q.context}")

    if q.promoted_to_id:
        header.append(
            f"\n[sonde.success]Promoted to {q.promoted_to_type or 'experiment'}: "
            f"{q.promoted_to_id}[/]"
        )

    out.print(
        Panel("\n".join(header), title=f"[sonde.brand]{q.id}[/]", border_style="sonde.brand.dim")
    )

    breadcrumbs = [f"All: sonde questions -p {q.program}"]
    if q.promoted_to_id:
        breadcrumbs.insert(0, f"Promoted to: sonde show {q.promoted_to_id}")
    print_breadcrumbs(breadcrumbs)


def _show_direction(ctx: click.Context, direction_id: str) -> None:
    """Display a direction with its experiments and findings."""
    from sonde.db import directions as dir_db
    from sonde.db import experiments as exp_db
    from sonde.db import findings as find_db

    d = dir_db.get(direction_id)
    if not d:
        print_error(
            f"Direction {direction_id} not found",
            "No direction with this ID.",
            "View status: sonde status",
        )
        raise SystemExit(1)

    experiments = exp_db.list_by_direction(direction_id)

    # Find active findings whose evidence overlaps with this direction's experiments
    exp_ids = {e.id for e in experiments}
    all_findings = find_db.list_active(program=d.program)
    findings = [f for f in all_findings if exp_ids & set(f.evidence)]

    if ctx.obj.get("json"):
        data = d.model_dump(mode="json")
        data["_experiments"] = [e.model_dump(mode="json") for e in experiments]
        data["_findings"] = [f.model_dump(mode="json") for f in findings]
        print_json(data)
        return

    complete = sum(1 for e in experiments if e.status == "complete")
    running = sum(1 for e in experiments if e.status == "running")
    open_count = sum(1 for e in experiments if e.status == "open")

    d_created = d.created_at.strftime("%Y-%m-%d") if d.created_at else ""
    header = [
        f"[sonde.heading]{d.id}[/]  {styled_status(d.status)}  {d.program}",
        f"[sonde.muted]Source: {d.source or '—'}  Created: {d_created}[/]",
        f"[sonde.muted]{complete} complete, {running} running, {open_count} open[/]",
        f"\n[sonde.heading]{d.title}[/]",
        f"{d.question}",
    ]

    out.print(
        Panel("\n".join(header), title=f"[sonde.brand]{d.id}[/]", border_style="sonde.brand.dim")
    )

    if experiments:
        exp_rows = []
        for e in experiments:
            source = e.source or "—"
            if "/" in source:
                source = source.split("/")[-1]
            exp_rows.append(
                {"id": e.id, "status": e.status, "source": source, "summary": record_summary(e, 45)}
            )
        print_table(["id", "status", "source", "summary"], exp_rows, title="Experiments")

    if findings:
        print_table(
            ["id", "finding", "confidence"],
            [
                {"id": f.id, "finding": truncate_text(f.finding, 50), "confidence": f.confidence}
                for f in findings
            ],
            title="Findings from this direction",
        )

    print_breadcrumbs(
        [f"List:  sonde list --direction {d.id}", f"Brief: sonde brief -p {d.program}"]
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
        ctx.invoke(_get_experiment_show(), experiment_id=rid, graph=graph)
    else:
        if "-" in rid:
            prefix = rid.split("-")[0]
            print_error(
                f"Unknown record type: {prefix}",
                "Recognized prefixes: EXP, FIND, Q, DIR.",
                f"Try: sonde show EXP-{rid.split('-', 1)[1]}",
            )
            raise SystemExit(1)
        ctx.invoke(_get_experiment_show(), experiment_id=rid, graph=graph)


def _get_experiment_show():
    """Lazy import to avoid circular dependency."""
    from sonde.commands.experiment_show import show

    return show
