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
    ui_url,
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
            f"\U0001f517 {ui_url(f.id)}",
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

    breadcrumbs = [f"\U0001f517 {ui_url(q.id)}"]
    if q.promoted_to_id:
        breadcrumbs.append(f"Promoted to: sonde show {q.promoted_to_id}")
    breadcrumbs.append(f"All: sonde questions -p {q.program}")
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

    # Fetch hierarchy info
    children = dir_db.get_children(direction_id)
    parent_dir = None
    if d.parent_direction_id:
        parent_dir = dir_db.get(d.parent_direction_id)
    spawned_exp = None
    if d.spawned_from_experiment_id:
        spawned_exp = exp_db.get(d.spawned_from_experiment_id)

    if ctx.obj.get("json"):
        data = d.model_dump(mode="json")
        data["_experiments"] = [e.model_dump(mode="json") for e in experiments]
        data["_findings"] = [f.model_dump(mode="json") for f in findings]
        if parent_dir:
            data["_parent_direction"] = parent_dir.model_dump(mode="json")
        if spawned_exp:
            data["_spawned_from"] = spawned_exp.model_dump(mode="json")
        if children:
            data["_child_directions"] = [c.model_dump(mode="json") for c in children]
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
    ]
    if parent_dir:
        header.append(f"[sonde.muted]Parent: {parent_dir.id} ({parent_dir.title})[/]")
    if spawned_exp:
        summary = record_summary(spawned_exp, 40)
        header.append(f"[sonde.muted]Spawned from: {spawned_exp.id}  {summary}[/]")
    header += [
        f"\n[sonde.heading]{d.title}[/]",
        f"{d.question}",
    ]
    if getattr(d, "context", None):
        header.append(f"\n[sonde.heading]Context[/]\n{d.context}")

    out.print(
        Panel("\n".join(header), title=f"[sonde.brand]{d.id}[/]", border_style="sonde.brand.dim")
    )

    # Show direction notes if any
    try:
        from sonde.db import notes as notes_db

        dir_notes = notes_db.list_by_record("direction", direction_id)
        if dir_notes:
            note_rows = [
                {
                    "id": n["id"],
                    "source": n.get("source", ""),
                    "content": truncate_text(n["content"], 60),
                }
                for n in dir_notes[:10]
            ]
            print_table(["id", "source", "content"], note_rows, title="Notes")
    except Exception:
        pass  # Direction notes are optional — no "(unavailable)" needed

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

    if children:
        child_rows = [
            {
                "id": c.id,
                "status": c.status,
                "title": c.title,
                "experiments": str(len(exp_db.list_by_direction(c.id))),
            }
            for c in children
        ]
        print_table(
            ["id", "status", "title", "experiments"],
            child_rows,
            title="Sub-directions",
        )

    if findings:
        print_table(
            ["id", "finding", "confidence"],
            [
                {"id": f.id, "finding": truncate_text(f.finding, 50), "confidence": f.confidence}
                for f in findings
            ],
            title="Findings from this direction",
        )

    breadcrumbs = [
        f"\U0001f517 {ui_url(d.id)}",
        f"List:  sonde list --direction {d.id}",
        f"Brief: sonde brief -p {d.program}",
    ]
    if not d.parent_direction_id:
        breadcrumbs.append(f"Fork:  sonde direction fork {d.id} --title <title> <question>")
    print_breadcrumbs(breadcrumbs)


def _show_artifact(ctx: click.Context, artifact_id: str) -> None:
    """Display artifact metadata."""
    from sonde.db import artifacts as art_db

    a = art_db.get(artifact_id)
    if not a:
        print_error(
            f"Artifact {artifact_id} not found",
            "No artifact with this ID.",
            "List artifacts: sonde show <EXP-ID>",
        )
        raise SystemExit(1)

    if ctx.obj.get("json"):
        print_json(a)
        return

    from sonde.commands.experiment_show import _format_size

    size = a.get("size_bytes")
    size_str = f" ({_format_size(size)})" if size else ""

    lines = [
        f"[sonde.heading]{a['id']}[/]  {a.get('type', 'file')}",
        f"[sonde.muted]Filename: {a['filename']}{size_str}[/]",
        f"[sonde.muted]Experiment: {a.get('experiment_id', '—')}[/]",
    ]
    if a.get("mime_type"):
        lines.append(f"[sonde.muted]MIME: {a['mime_type']}[/]")
    if a.get("storage_path"):
        lines.append(f"[sonde.muted]Path: {a['storage_path']}[/]")
    if a.get("checksum_sha256"):
        lines.append(f"[sonde.muted]SHA-256: {a['checksum_sha256']}[/]")
    if a.get("source"):
        lines.append(f"[sonde.muted]Source: {a['source']}[/]")
    if a.get("created_at"):
        lines.append(f"[sonde.muted]Created: {a['created_at'][:19].replace('T', ' ')}[/]")

    err.print(
        Panel(
            "\n".join(lines),
            title=f"[sonde.brand]{a['id']}[/]",
            border_style="sonde.brand.dim",
        )
    )

    parent_id = a.get("experiment_id") or a.get("direction_id") or a.get("project_id")
    breadcrumbs = []
    if parent_id:
        breadcrumbs.append(f"\U0001f517 {ui_url(parent_id)}")
        breadcrumbs.append(f"Parent: sonde show {parent_id}")
    print_breadcrumbs(breadcrumbs)


def _show_project(ctx: click.Context, project_id: str) -> None:
    """Display a project with its directions and experiments."""
    from sonde.db import projects as db

    p = db.get(project_id)
    if not p:
        print_error(
            f"Project {project_id} not found",
            "No project with this ID.",
            "sonde project list",
        )
        raise SystemExit(1)

    # Fetch directions and experiments under this project
    client = __import__("sonde.db.client", fromlist=["get_client"]).get_client()
    dirs_result = (
        client.table("directions").select("id,title,status").eq("project_id", project_id).execute()
    )
    exps_result = (
        client.table("experiments")
        .select("id,status,hypothesis,finding")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )

    if ctx.obj.get("json"):
        data = p.model_dump(mode="json")
        data["_directions"] = dirs_result.data or []
        data["_experiments"] = exps_result.data or []
        print_json(data)
        return

    header = [
        f"[sonde.heading]{p.id}[/]  {styled_status(p.status)}  {p.program}",
        f"[sonde.muted]Name: {p.name}[/]",
    ]
    if p.objective:
        header.append(f"\n{p.objective}")
    if getattr(p, "description", None):
        header.append(f"\n[sonde.heading]Description[/]\n{p.description}")
    header.append(
        f"\n[sonde.muted]Source: {p.source}  Created: {p.created_at.strftime('%Y-%m-%d')}[/]"
    )
    err.print(
        Panel(
            "\n".join(header),
            title=f"[sonde.brand]{p.id}[/]",
            border_style="sonde.brand.dim",
        )
    )

    # Show project takeaways if any
    try:
        from sonde.db import project_takeaways as ptw_db

        ptw = ptw_db.get(project_id)
        if ptw and ptw.body.strip():
            err.print(f"\n[sonde.heading]Takeaways[/]\n{ptw.body}")
    except Exception:
        err.print("  [sonde.muted](takeaways unavailable)[/]")

    # Show project notes if any
    try:
        from sonde.db import notes as notes_db

        project_notes = notes_db.list_by_record("project", project_id)
        if project_notes:
            note_rows = [
                {
                    "id": n["id"],
                    "source": n.get("source", ""),
                    "content": truncate_text(n["content"], 60),
                }
                for n in project_notes[:10]
            ]
            print_table(["id", "source", "content"], note_rows, title="Notes")
    except Exception:
        err.print("  [sonde.muted](notes unavailable)[/]")

    dirs = dirs_result.data or []
    if dirs:
        print_table(
            ["id", "status", "title"],
            [{"id": d["id"], "status": d["status"], "title": d["title"]} for d in dirs],
            title=f"Directions ({len(dirs)})",
        )

    exps = exps_result.data or []
    if exps:
        print_table(
            ["id", "status", "hypothesis", "finding"],
            [
                {
                    "id": e["id"],
                    "status": e["status"],
                    "hypothesis": truncate_text(e.get("hypothesis") or "", 50),
                    "finding": truncate_text(e.get("finding") or "", 50),
                }
                for e in exps
            ],
            title=f"Experiments ({len(exps)})",
        )

    # Show project artifacts if any
    try:
        from sonde.db.artifacts import list_for_project

        project_artifacts = list_for_project(project_id)
        if project_artifacts:
            art_rows = [
                {
                    "id": a["id"],
                    "type": a.get("type", ""),
                    "filename": a["filename"],
                }
                for a in project_artifacts[:10]
            ]
            print_table(["id", "type", "filename"], art_rows, title="Artifacts")
    except Exception:
        err.print("  [sonde.muted](artifacts unavailable)[/]")

    print_breadcrumbs(
        [
            f"\U0001f517 {ui_url(project_id)}",
            f"Brief: sonde project brief {project_id}",
            "Directions: sonde direction list --all",
            "Experiments: sonde list --all",
        ]
    )


def show_dispatch(ctx: click.Context, record_id: str, graph: bool) -> None:
    """Route show to the appropriate handler based on ID prefix."""
    rid = record_id.upper()

    if rid.startswith("FIND-") or rid.startswith("FIN-"):
        _show_finding(ctx, rid)
    elif rid.startswith("Q-") or rid.startswith("QUES-"):
        _show_question(ctx, rid)
    elif rid.startswith("ART-"):
        _show_artifact(ctx, rid)
    elif rid.startswith("PROJ-"):
        _show_project(ctx, rid)
    elif rid.startswith("DIR-"):
        _show_direction(ctx, rid)
    elif rid.startswith("EXP-") or rid[0].isdigit():
        ctx.invoke(_get_experiment_show(), experiment_id=rid, graph=graph)
    else:
        if "-" in rid:
            prefix = rid.split("-")[0]
            print_error(
                f"Unknown record type: {prefix}",
                "Recognized prefixes: EXP, FIND, Q, DIR, PROJ, ART.",
                f"Try: sonde show EXP-{rid.split('-', 1)[1]}",
            )
            raise SystemExit(1)
        ctx.invoke(_get_experiment_show(), experiment_id=rid, graph=graph)


def _get_experiment_show():
    """Lazy import to avoid circular dependency."""
    from sonde.commands.experiment_show import show

    return show
