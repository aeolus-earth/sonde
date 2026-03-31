"""Show command — display full experiment details."""

from __future__ import annotations

from typing import Any

import click

from sonde.cli_options import pass_output_options
from sonde.db import experiments as db
from sonde.models.experiment import Experiment
from sonde.output import (
    err,
    print_breadcrumbs,
    print_error,
    print_json,
    print_nudge,
    print_table,
    record_summary,
    styled_status,
    truncate_text,
)


@click.command("show")
@click.argument("experiment_id")
@click.option("--graph", "-g", is_flag=True, help="Show all connected entities")
@pass_output_options
@click.pass_context
def show(ctx: click.Context, experiment_id: str, graph: bool) -> None:
    """Show full details for an experiment.

    \b
    Examples:
      sonde experiment show EXP-0001
      sonde show EXP-0001 --json
      sonde show EXP-0001 --graph
    """
    from sonde.db import findings as find_db
    from sonde.db.activity import get_history
    from sonde.db.artifacts import list_artifacts

    exp = db.get(experiment_id.upper())

    if not exp:
        print_error(
            f"Experiment {experiment_id} not found",
            "No experiment with this ID exists in the database.",
            'List experiments: sonde list\n  Search: sonde search --text "your query"',
        )
        raise SystemExit(1)

    # Fetch related context via db layer
    related_findings = find_db.find_by_evidence(exp.id)
    artifacts = list_artifacts(exp.id)
    activity = get_history(exp.id)[-5:]  # last 5 entries
    parent = db.get(exp.parent_id) if exp.parent_id else None
    children = db.get_children(exp.id)
    siblings = db.get_siblings(exp.id) if exp.parent_id else []
    from sonde.commands.lifecycle import _suggest_next

    suggestions = _suggest_next(exp, children, siblings)

    if ctx.obj.get("json"):
        data = exp.model_dump(mode="json")
        data["_findings"] = [f.model_dump(mode="json") for f in related_findings]
        data["_artifacts"] = artifacts
        data["_activity"] = activity
        data["_parent"] = parent.model_dump(mode="json") if parent else None
        data["_children"] = [c.model_dump(mode="json") for c in children]
        data["_siblings"] = [s.model_dump(mode="json") for s in siblings]
        data["_suggested_next"] = suggestions
        if graph:
            graph_data = db.get_graph_neighborhood(exp)
            data["_graph"] = _serialize_graph(graph_data)
        print_json(data)
    else:
        from rich.markdown import Markdown
        from rich.panel import Panel

        from sonde.output import out

        # Metadata header
        header = []
        header.append(f"[sonde.heading]{exp.id}[/]  {styled_status(exp.status)}  {exp.program}")
        header.append(
            f"[sonde.muted]Source: {exp.source}  Created: {exp.created_at:%Y-%m-%d %H:%M}[/]"
        )
        if exp.tags:
            header.append(f"[sonde.muted]Tags: {', '.join(exp.tags)}[/]")
        if exp.git_commit or exp.git_close_commit:
            parts = []
            if exp.git_commit:
                parts.append(exp.git_commit[:12])
            if exp.git_close_commit and exp.git_close_commit != exp.git_commit:
                parts.append(f"→ {exp.git_close_commit[:12]}")
            git_info = " ".join(parts)
            if exp.git_branch or exp.git_close_branch:
                branch = exp.git_close_branch or exp.git_branch
                git_info += f" ({branch}"
                if exp.git_dirty is True:
                    git_info += ", dirty"
                elif exp.git_dirty is False:
                    git_info += ", clean"
                git_info += ")"
            elif exp.git_dirty is not None:
                git_info += " (dirty)" if exp.git_dirty else " (clean)"
            header.append(f"[sonde.muted]Git: {git_info}[/]")
        if exp.related:
            header.append(f"[sonde.muted]Related: {', '.join(exp.related)}[/]")
        if exp.parent_id:
            parent_label = f"Parent: {exp.parent_id}"
            if parent:
                parent_label += f" [{parent.status}]"
            header.append(f"[sonde.muted]{parent_label}[/]")
        if exp.branch_type:
            header.append(f"[sonde.muted]Branch: {exp.branch_type}[/]")
        if exp.claimed_by:
            header.append(f"[sonde.muted]Claimed by: {exp.claimed_by}[/]")
        if siblings:
            sib_parts = [f"{s.id} [{s.status}]" for s in siblings[:5]]
            header.append(f"[sonde.muted]Siblings: {', '.join(sib_parts)}[/]")

        if exp.content:
            header.append("")
            out.print(
                Panel(
                    "\n".join(header),
                    title=f"[sonde.brand]{exp.id}[/]",
                    border_style="sonde.brand.dim",
                )
            )
            out.print(Markdown(exp.content))
        else:
            if exp.hypothesis:
                header.append(f"\n[sonde.heading]Hypothesis:[/sonde.heading]\n  {exp.hypothesis}")
            if exp.all_params:
                param_str = "\n".join(f"  {k}: {v}" for k, v in exp.all_params.items())
                header.append(f"\n[sonde.heading]Parameters:[/sonde.heading]\n{param_str}")
            if exp.results:
                result_str = "\n".join(f"  {k}: {v}" for k, v in exp.results.items())
                header.append(f"\n[sonde.heading]Results:[/sonde.heading]\n{result_str}")
            if exp.finding:
                header.append(f"\n[sonde.heading]Finding:[/sonde.heading]\n  {exp.finding}")
            if exp.git_commit:
                header.append("\n[sonde.heading]Provenance:[/sonde.heading]")
                header.append(f"  Commit: {exp.git_commit[:12]}")
                if exp.git_repo:
                    header.append(f"  Repo: {exp.git_repo}")
                if exp.git_branch:
                    header.append(f"  Branch: {exp.git_branch}")
            out.print(
                Panel(
                    "\n".join(header),
                    title=f"[sonde.brand]{exp.id}[/]",
                    border_style="sonde.brand.dim",
                )
            )

        # Related findings
        if related_findings:
            print_table(
                ["id", "finding", "confidence"],
                [
                    {
                        "id": f.id,
                        "finding": truncate_text(f.finding, 55),
                        "confidence": f.confidence,
                    }
                    for f in related_findings
                ],
                title="Findings from this experiment",
            )

        # Structured metadata (repro, evidence, env, blocker)
        from sonde.commands._helpers import META_BLOCKER, META_ENV, META_EVIDENCE, META_REPRO

        meta = exp.metadata or {}
        structured_keys = (META_REPRO, META_EVIDENCE, META_ENV, META_BLOCKER)
        has_structured = any(meta.get(k) for k in structured_keys)
        if has_structured:
            err.print("\n[sonde.heading]Research context[/]")
            if meta.get(META_REPRO):
                err.print(f"  [sonde.muted]Repro:[/]  {meta[META_REPRO]}")
            if meta.get(META_EVIDENCE):
                for path in meta[META_EVIDENCE]:
                    err.print(f"  [sonde.muted]Evidence:[/]  {path}")
            if meta.get(META_ENV):
                for k, v in meta[META_ENV].items():
                    err.print(f"  [sonde.muted]Env:[/]  {k}={v}")
            if meta.get(META_BLOCKER):
                err.print(f"  [sonde.warning]Blocker:[/]  {meta[META_BLOCKER]}")

        # Artifacts
        if artifacts:
            err.print("\n[sonde.heading]Artifacts[/]")
            for a in artifacts:
                size = a.get("size_bytes")
                size_str = f" ({_format_size(size)})" if size else ""
                aid = a.get("id", "")
                err.print(
                    f"  [sonde.brand]{aid}[/]  [sonde.muted]{a.get('type', 'file')}[/]"
                    f"  {a['filename']}{size_str}"
                )

        # Children
        if children:
            print_table(
                ["id", "status", "type", "summary"],
                [
                    {
                        "id": c.id,
                        "status": c.status,
                        "type": c.branch_type or "—",
                        "summary": record_summary(c, 45),
                    }
                    for c in children
                ],
                title="Child Experiments",
            )

        if suggestions:
            err.print("\n[sonde.heading]Suggested next[/]")
            for suggestion in suggestions[:4]:
                err.print(f"  {suggestion['command']}")
                err.print(f"    [sonde.muted]{suggestion['reason']}[/]")

        # Recent activity
        if activity:
            err.print("\n[sonde.heading]Activity[/]")
            for entry in activity[:5]:
                ts = entry["created_at"][:16].replace("T", " ")
                actor = entry.get("actor", "")
                if "/" in actor:
                    actor = actor.split("/")[-1]
                err.print(f"  [sonde.muted]{ts}[/]  {actor}  {entry['action']}")

        # Graph traversal (--graph)
        if graph:
            _render_graph(exp)

        breadcrumbs = [
            f"History: sonde history {exp.id}",
            f'Note:    sonde note {exp.id} "observation"',
        ]
        if children or parent:
            breadcrumbs.append(f"Tree:    sonde tree {exp.id}")
        print_breadcrumbs(breadcrumbs)

        # Research hygiene nudge (max 1, only for non-JSON)
        if exp.status in ("complete", "failed") and not exp.finding:
            print_nudge(
                "No finding recorded — state the result with numbers and conditions:",
                f"sonde update {exp.id} --finding"
                f' "32x32 tiling: 12.4 GFLOPS (3x naive), L2 miss 0.08"',
            )
        elif exp.status in ("open", "running") and not artifacts:
            print_nudge(
                f"Put files anywhere under .sonde/experiments/{exp.id}/, then sync them.",
                f"sonde push experiment {exp.id}",
            )
        elif exp.status in ("open", "running") and not exp.direction_id:
            print_nudge(
                "This experiment isn't linked to a research direction.",
                f"sonde update {exp.id} --direction DIR-XXX",
            )


def _serialize_graph(graph: dict[str, Any]) -> dict[str, Any]:
    """Serialize graph neighborhood data for JSON output."""
    return {
        "related_experiments": [e.model_dump(mode="json") for e in graph["related_experiments"]],
        "reverse_related": [e.model_dump(mode="json") for e in graph["reverse_related"]],
        "questions_answered": [q.model_dump(mode="json") for q in graph["questions_answered"]],
        "findings": [f.model_dump(mode="json") for f in graph["findings"]],
        "direction": graph["direction"].model_dump(mode="json") if graph["direction"] else None,
        "direction_siblings": [e.model_dump(mode="json") for e in graph["direction_siblings"]],
    }


def _render_graph(exp: Experiment) -> None:
    """Render graph neighborhood for an experiment."""
    graph = db.get_graph_neighborhood(exp)

    has_content = False

    # Related experiments (forward)
    if graph["related_experiments"]:
        has_content = True
        print_table(
            ["id", "status", "rel", "summary"],
            [
                {"id": e.id, "status": e.status, "rel": "related", "summary": record_summary(e, 45)}
                for e in graph["related_experiments"]
            ],
            title="Related Experiments",
        )

    # Reverse related
    if graph["reverse_related"]:
        has_content = True
        print_table(
            ["id", "status", "rel", "summary"],
            [
                {
                    "id": e.id,
                    "status": e.status,
                    "rel": "references this",
                    "summary": record_summary(e, 45),
                }
                for e in graph["reverse_related"]
            ],
            title="Referenced By",
        )

    # Questions answered
    if graph["questions_answered"]:
        has_content = True
        print_table(
            ["id", "status", "question"],
            [
                {"id": q.id, "status": q.status, "question": truncate_text(q.question, 55)}
                for q in graph["questions_answered"]
            ],
            title="Questions Answered",
        )

    # Findings
    if graph["findings"]:
        has_content = True
        print_table(
            ["id", "finding", "confidence"],
            [
                {"id": f.id, "finding": truncate_text(f.finding, 50), "confidence": f.confidence}
                for f in graph["findings"]
            ],
            title="Findings",
        )

    # Direction
    if graph["direction"]:
        has_content = True
        d = graph["direction"]
        err.print("\n[sonde.heading]Direction[/]")
        err.print(f"  {d.id}  {d.title}  [{d.status}]")
        err.print(f"  [sonde.muted]{d.question}[/]")
        if graph["direction_siblings"]:
            err.print("\n  [sonde.heading]Siblings in this direction:[/]")
            for s in graph["direction_siblings"]:
                err.print(f"    {s.id}  [{s.status}]  {record_summary(s, 50)}")

    if not has_content:
        err.print("\n[dim]No graph connections found for this experiment.[/dim]")


def _format_size(size_bytes: int | None) -> str:
    """Format bytes as human-readable size."""
    if size_bytes is None or size_bytes == 0:
        return ""
    n = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"
